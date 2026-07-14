'use strict';
// File browser for the active repository — subfolder navigation (phase 6,
// generalizes writhdeck-web's dirStack/scanDir pattern) plus an inline
// search bar (phase 4, folded in here rather than a separate screen —
// desktop web has the room Android's smaller screen doesn't) which also
// hosts the note-sort toggle (name / last modified, like Android's
// AppSettings.noteSortOrder). Clicking a file opens it in the real editor
// (editor.js); clicking a folder row descends into it; search always
// searches the whole repository regardless of the folder being browsed
// (same as Android — never scoped to the current subfolder).
const Browser = (() => {
  function el(id) { return document.getElementById(id); }

  const SEARCH_PLACEHOLDERS = {
    name: 'Rechercher par nom…',
    content: 'Rechercher dans le contenu…',
    tag: 'Rechercher un tag (sans #)…'
  };

  let _searchMode = 'name'; // 'name' | 'content' | 'tag'
  let _searchDebounce = null;

  function sortFiles(files) {
    const sorted = [...files];
    if (State.settings.noteSortOrder === 'modified') {
      sorted.sort((a, b) => b.lastModified - a.lastModified); // most recent first
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }

  function matchesQuery(entry, q) {
    if (_searchMode === 'name') return entry.name.toLowerCase().includes(q) || entry.title.toLowerCase().includes(q);
    if (_searchMode === 'content') return entry.content.toLowerCase().includes(q);
    if (_searchMode === 'tag') return [...entry.tags].some(t => t.toLowerCase().includes(q));
    return false;
  }

  function updateBreadcrumb() {
    el('browser-title').textContent = State.dirStack.map(s => s.name).join(' / ');
  }

  function renderFileRow(file) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const name = document.createElement('span');
    name.className = 'file-item-name';
    name.textContent = file.name;
    item.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'file-item-meta';
    const dateStr = new Date(file.lastModified).toLocaleString();
    // Search results can come from a subfolder (path !== name) — show it,
    // since two notes in different folders can share the same bare name.
    meta.textContent = (file.path && file.path !== file.name) ? `${file.path} — ${dateStr}` : dateStr;
    item.appendChild(meta);

    item.addEventListener('click', () => Editor.open(file));
    return item;
  }

  // Plain browse mode (no search query) — ".." row (unless at the repo
  // root), then subfolders, then files, à la classic file manager.
  function renderBrowseRows(list) {
    let anyRow = false;

    if (State.dirStack.length > 1) {
      const up = document.createElement('div');
      up.className = 'file-item folder-item';
      up.textContent = '⬆ ..';
      up.addEventListener('click', async () => { await dirUp(); render(); });
      list.appendChild(up);
      anyRow = true;
    }

    for (const subdir of State.dirSubdirs) {
      const item = document.createElement('div');
      item.className = 'file-item folder-item';
      item.textContent = `📁 ${subdir.name}`;
      item.addEventListener('click', async () => { await dirEnter(subdir); render(); });
      list.appendChild(item);
      anyRow = true;
    }

    for (const file of sortFiles(State.repoFiles)) {
      list.appendChild(renderFileRow(file));
      anyRow = true;
    }

    el('browser-empty-hint').hidden = anyRow;
    el('browser-empty-hint').textContent = 'Aucun fichier ni sous-dossier ici.';
  }

  function render() {
    const repo = activeRepository();
    updateBreadcrumb();
    syncRepoOptionsUI();
    updateSortButton();

    const list = el('browser-list');
    list.innerHTML = '';

    const query = el('browser-search-input').value.trim();
    if (!query) {
      renderBrowseRows(list);
      return;
    }

    // Searching reaches into the recursive index (Index.entries), so it
    // surfaces notes from every subfolder regardless of which one is
    // currently being browsed — same as Android's search screen, never
    // scoped to the current folder.
    const results = repo
      ? sortFiles(Index.entries(repo.id).filter(e => matchesQuery(e, query.toLowerCase())))
      : [];
    el('browser-empty-hint').hidden = results.length > 0;
    el('browser-empty-hint').textContent = 'Aucun résultat.';
    results.forEach(file => list.appendChild(renderFileRow(file)));
  }

  function scheduleRender() {
    if (_searchDebounce) clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(render, 150);
  }

  async function rescan() {
    await scanActiveRepo();
    render();
  }

  // Search and link repair (phase 4/5) both need the repo's index built —
  // kicked off whenever the browser opens/refreshes, in the background: the
  // flat file list (fast, root-only) renders immediately, indexing (which
  // walks the whole tree, see fsa.js) can take longer on a big repo — same
  // tradeoff Android hit (~20s on 360 files the first time, then cached by
  // lastModified). Only the repair button is disabled meanwhile — a search
  // typed while indexing is still running just returns partial results that
  // complete themselves once it's done, rewriting files against a stale
  // index would be the actually risky one.
  async function reindexActive() {
    const repo = activeRepository();
    if (!repo) return;
    el('browser-repair-btn').disabled = true;
    try {
      await Index.indexRepository(repo);
      render(); // refresh in case a search was already active
    } finally {
      el('browser-repair-btn').disabled = false;
    }
  }

  async function openActive() {
    await rescan();
    reindexActive(); // not awaited — see reindexActive() comment
  }

  async function repairAllLinks() {
    const repo = activeRepository();
    if (!repo) return;
    el('browser-repair-btn').disabled = true;
    try {
      const count = await Index.repairAllLinks(repo.id, repo);
      alert(count > 0 ? `${count} note(s) mise(s) à jour.` : 'Aucun lien à réparer.');
    } finally {
      el('browser-repair-btn').disabled = false;
    }
  }

  function updateSortButton() {
    const btn = el('browser-sort-btn');
    if (State.settings.noteSortOrder === 'modified') {
      btn.textContent = '🕒';
      btn.title = 'Trier par nom (actuellement : dernière modification)';
    } else {
      btn.textContent = '🔤';
      btn.title = 'Trier par dernière modification (actuellement : nom)';
    }
  }

  async function toggleSort() {
    await setNoteSortOrder(State.settings.noteSortOrder === 'modified' ? 'name' : 'modified');
    render();
  }

  function syncRepoOptionsUI() {
    const repo = activeRepository();
    el('repo-options-include-extension').checked = !!(repo && repo.includeExtensionInLinks);
  }

  function openRepoOptions() {
    if (!activeRepository()) return;
    syncRepoOptionsUI();
    el('repo-options-dlg').showModal();
  }

  // Back button goes up one folder first, like a normal file manager —
  // only leaves the repository entirely once already at its root (mirrors
  // Android's BrowserScreen: "navigateUp() renvoie false à la racine, seul
  // cas où l'écran se quitte réellement").
  async function backOrUp() {
    if (await dirUp()) { render(); return; }
    Repositories.showList();
  }

  function init() {
    el('browser-back-btn').addEventListener('click', backOrUp);
    el('browser-refresh-btn').addEventListener('click', async () => { await rescan(); reindexActive(); });
    el('browser-repair-btn').addEventListener('click', repairAllLinks);
    el('browser-sort-btn').addEventListener('click', toggleSort);

    el('browser-search-input').addEventListener('input', scheduleRender);
    for (const btn of document.querySelectorAll('#browser-search-mode button')) {
      btn.addEventListener('click', () => {
        _searchMode = btn.dataset.mode;
        for (const b of document.querySelectorAll('#browser-search-mode button')) b.classList.toggle('active', b === btn);
        el('browser-search-input').placeholder = SEARCH_PLACEHOLDERS[_searchMode];
        render();
      });
    }

    el('browser-options-btn').addEventListener('click', openRepoOptions);
    el('repo-options-close').addEventListener('click', () => el('repo-options-dlg').close());
    el('repo-options-include-extension').addEventListener('change', async e => {
      const repo = activeRepository();
      if (!repo) return;
      await setIncludeExtensionInLinks(repo, e.target.checked);
    });
  }

  return { init, render, rescan, openActive };
})();
