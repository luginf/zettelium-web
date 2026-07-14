'use strict';
// File System Access API helpers.
//
// This is the central storage mechanism for zettelium-web (see PLAN.md
// section 2) — unlike writhdeck-web, where the equivalent API only backs an
// optional secondary "watched folder" feature on top of a flat IndexedDB
// document store. Chromium-only (Chrome/Edge/Brave); assumed, no fallback
// for Firefox/Safari (see PLAN.md section 2, "Support navigateur").
const FSA = (() => {
  function supported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  // Must be called directly from a user gesture (click handler) — awaiting
  // anything else first can make the browser reject the picker call.
  async function pickDirectory() {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  }

  // Silent check only (no prompt) — a directory handle persisted in
  // IndexedDB is never guaranteed to still be usable across sessions/browser
  // restarts (PLAN.md section 9). Returns 'granted' | 'denied' | 'prompt'.
  async function queryPermission(handle, mode = 'readwrite') {
    if (!handle.queryPermission) return 'granted';
    return await handle.queryPermission({ mode });
  }

  // Prompts the user — must be called from a user gesture, used to
  // re-authorize a repository whose queryPermission() came back non-granted.
  async function requestPermission(handle, mode = 'readwrite') {
    if (!handle.requestPermission) return 'granted';
    return await handle.requestPermission({ mode });
  }

  function isNoteFileName(name, extensions, filterDisabled) {
    if (filterDisabled) return true;
    const lower = name.toLowerCase();
    return extensions.some(ext => lower.endsWith(ext));
  }

  // Directory name excluded from browsing and indexing — timestamped copies
  // (backup.js) would otherwise show up as ordinary notes. Matches
  // zettelium-android's `SafRepositoryAccess.BACKUPS_DIR_NAME`.
  const BACKUPS_DIR_NAME = 'backups';

  // Lists the note files AND subfolders directly inside `dirHandle` — one
  // level, no recursion (phase 6: subfolder navigation in the browser, see
  // browser.js's `State.dirStack`). `path` is repo-relative (`prefix + name`,
  // `prefix` being the path of `dirHandle` itself, e.g. `"sub/"` — `""` at
  // the repo root) — same `path`-keyed identity as `listNoteFilesRecursive`
  // below, so a file looks the same to `index.js`/`editor.js` whether it
  // came from browsing or from a recursive scan.
  async function listChildren(dirHandle, extensions, filterDisabled, prefix = '') {
    const files = [];
    const subdirs = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        if (name === BACKUPS_DIR_NAME) continue;
        subdirs.push({ path: prefix + name + '/', name, handle });
        continue;
      }
      if (handle.kind !== 'file') continue;
      if (!isNoteFileName(name, extensions, filterDisabled)) continue;
      const file = await handle.getFile();
      files.push({ path: prefix + name, name, fileHandle: handle, lastModified: file.lastModified, size: file.size });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    subdirs.sort((a, b) => a.name.localeCompare(b.name));
    return { files, subdirs };
  }

  // Full recursive listing (subfolders included) — for the phase 4 indexer,
  // which must cover the whole repository tree for search/tags/backlinks
  // even though the browser UI itself stays flat until phase 6 (mirrors
  // zettelium-android: `Indexer` got `listAllNoteFilesRecursive` in round
  // 11bis, ahead of the browser's own subfolder navigation). `path` is the
  // repo-relative path (POSIX-style, e.g. "sub/note.txt"), `name` is the
  // bare filename — distinct because two files in different subfolders can
  // share the same `name`.
  async function listNoteFilesRecursive(dirHandle, extensions, filterDisabled, prefix = '') {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        if (name === BACKUPS_DIR_NAME) continue;
        const nested = await listNoteFilesRecursive(handle, extensions, filterDisabled, `${prefix}${name}/`);
        files.push(...nested);
        continue;
      }
      if (handle.kind !== 'file') continue;
      if (!isNoteFileName(name, extensions, filterDisabled)) continue;
      const file = await handle.getFile();
      files.push({ path: prefix + name, name, fileHandle: handle, lastModified: file.lastModified, size: file.size });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  }

  async function readFileText(fileHandle) {
    const file = await fileHandle.getFile();
    return await file.text();
  }

  // Walks down from `rootHandle` following `path` (e.g. "sub/sub2/note.txt"
  // or "sub/sub2/", trailing filename or slash both fine — only the
  // directory segments are used) to the directory that contains it.
  async function getParentDirHandle(rootHandle, path) {
    const parts = path.split('/').filter(Boolean);
    parts.pop(); // drop the filename (or the trailing empty segment for a folder path)
    let dir = rootHandle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    return dir;
  }

  // Renames a note file. `FileSystemHandle.move(newName)` (stable in recent
  // Chromium) renames in place — same handle, same identity, no content
  // read/rewrite needed, mirroring the true rename `SafRepositoryAccess`
  // gets from `DocumentsContract.renameDocument` on Android. Falls back to
  // copy+delete (new handle) for older Chromium without `move()` support.
  // Returns the (possibly new) FileSystemFileHandle for the renamed file.
  async function renameFile(fileHandle, parentDirHandle, newName) {
    if (typeof fileHandle.move === 'function') {
      await fileHandle.move(newName);
      return fileHandle;
    }
    const content = await readFileText(fileHandle);
    const newHandle = await parentDirHandle.getFileHandle(newName, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(content);
    await writable.close();
    await parentDirHandle.removeEntry(fileHandle.name);
    return newHandle;
  }

  // Writes `content` into a brand new file named `name` inside `dirHandle`
  // (creates it). Used both by note creation and by "move" (write to
  // destination before deleting the source, mirroring Android's
  // copy-then-delete `moveNote` — never `DocumentsContract.moveDocument`,
  // not reliably supported across two independent SAF trees there, and
  // FSA has no equivalent cross-handle move either).
  async function writeNewFile(dirHandle, name, content) {
    const handle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return handle;
  }

  // Creates an empty note file, appending the first configured extension if
  // `name` doesn't already end in a recognised one — same rule as Android's
  // `SafRepositoryAccess.createNoteFile`/`renameNoteFile` ("conserve
  // l'extension de note si le nouveau nom n'en porte pas déjà une reconnue").
  // Returns `{handle, name}` since the final name can differ from the input.
  async function createNoteFile(dirHandle, name, extensions) {
    const hasRecognisedExt = extensions.some(ext => name.toLowerCase().endsWith(ext));
    const finalName = hasRecognisedExt ? name : name + (extensions[0] || '');
    const handle = await dirHandle.getFileHandle(finalName, { create: true });
    return { handle, name: finalName };
  }

  async function deleteFile(dirHandle, name) {
    await dirHandle.removeEntry(name);
  }

  return {
    supported, pickDirectory, queryPermission, requestPermission,
    isNoteFileName, listChildren, listNoteFilesRecursive, readFileText,
    getParentDirHandle, renameFile, writeNewFile, createNoteFile, deleteFile,
    BACKUPS_DIR_NAME
  };
})();
