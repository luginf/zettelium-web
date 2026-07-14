'use strict';
// Manual note backups — ported from zettelium-android's
// `data/storage/BackupManager.kt` (+ `listBackupsFor`/`BackupRestoreSheet`).
// A timestamped copy in `<repo>/backups/`, named `<base>_<timestamp><ext>` —
// that directory is excluded from browsing/indexing (see fsa.js,
// `FSA.BACKUPS_DIR_NAME`) so copies never show up as ordinary notes.
const Backup = (() => {
  function splitExt(fileName) {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ''];
  }

  // yyyy-MM-ddTHHhmmmss — same shape as Android's
  // `SimpleDateFormat("yyyy-MM-dd'T'HH'h'mm'm'ss")`.
  function timestamp(now = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `T${p(now.getHours())}h${p(now.getMinutes())}m${p(now.getSeconds())}s`;
  }

  /** Crée une copie horodatée de `content` et retourne son nom, ou `null` en cas d'échec. */
  async function create(repo, fileName, content) {
    try {
      const backupsDir = await repo.dirHandle.getDirectoryHandle(FSA.BACKUPS_DIR_NAME, { create: true });
      const [base, ext] = splitExt(fileName);
      const backupName = `${base}_${timestamp()}${ext}`;
      const handle = await backupsDir.getFileHandle(backupName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return backupName;
    } catch (e) {
      console.error(`Échec de la sauvegarde de "${fileName}"`, e);
      return null;
    }
  }

  /** Sauvegardes existantes de `fileName` (préfixe `<base>_`), triées de la plus récente à la plus ancienne. */
  async function list(repo, fileName) {
    let backupsDir;
    try {
      backupsDir = await repo.dirHandle.getDirectoryHandle(FSA.BACKUPS_DIR_NAME);
    } catch (_) {
      return []; // pas encore de dossier de sauvegardes
    }
    const [base] = splitExt(fileName);
    const prefix = `${base}_`;
    const backups = [];
    for await (const [name, handle] of backupsDir.entries()) {
      if (handle.kind !== 'file' || !name.startsWith(prefix)) continue;
      const file = await handle.getFile();
      backups.push({ name, fileHandle: handle, lastModified: file.lastModified });
    }
    backups.sort((a, b) => b.lastModified - a.lastModified);
    return backups;
  }

  return { create, list };
})();
