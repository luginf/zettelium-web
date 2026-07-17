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

  function searchPlaceholder(mode) {
    if (mode === 'content') return I18n.t('browser.searchPlaceholderContent');
    if (mode === 'tag') return I18n.t('browser.searchPlaceholderTag');
    return I18n.t('browser.searchPlaceholderName');
  }

  let _searchMode = 'name'; // 'name' | 'content' | 'tag'
  let _searchDebounce = null;

  // NoteFile ciblé par le menu d'actions (Renommer/Déplacer/Supprimer) —
  // équivalent web du clic long d'Android (`fileForActions`/`fileToRename`/
  // `fileToMove`/`fileToDelete`, BrowserScreen.kt) : pas de geste long-press
  // naturel à la souris, un petit bouton "⋮" par ligne ouvre le même menu.
  let _actionsFile = null;

  // État de navigation du dialogue "Déplacer" — indépendant de
  // `State.dirStack` (qui reste celui du navigateur principal) : Android
  // (`MoveNoteDialog.kt`) démarre toujours à la RACINE du dépôt sélectionné,
  // pas au dossier actuellement parcouru, et navigue dans sa propre pile.
  let _moveFile = null;
  let _moveTargetRepo = null;
  let _movePath = []; // [{name, handle, path}] racine..courant, dans _moveTargetRepo

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
    if (_searchMode === 'tag') {
      // "#voiture" et "voiture" doivent matcher pareil — un tag est toujours
      // stocké sans le `#` (voir tags.js), on retire juste un `#` de tête
      // sur la requête si l'utilisateur l'a tapé (même règle qu'Android :
      // `raw.removePrefix("#")`, pas un retrait de tous les `#`).
      const cleaned = q.startsWith('#') ? q.slice(1) : q;
      return [...entry.tags].some(t => t.toLowerCase().includes(cleaned));
    }
    return false;
  }

  // Tags distincts de tout le dépôt (pas juste le dossier navigué, comme la
  // recherche elle-même) avec leur nombre d'occurrences, du plus fréquent
  // au moins fréquent puis par ordre alphabétique — porté de
  // `SearchViewModel.loadTagCounts`/`TagBrowserPanel` (Android round 17).
  // Pas de table dédiée : chaque `Index` entry porte déjà son `Set` de tags
  // (voir index.js), l'agrégation se fait ici en mémoire au moment de
  // l'ouverture du panneau, pas dans une base — voir CLAUDE.md pour le
  // détail de ce choix ("index en mémoire, pas de SQL/FTS").
  function computeTagCounts(repositoryId) {
    const counts = new Map();
    for (const entry of Index.entries(repositoryId)) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function openTagBrowser() {
    const repo = activeRepository();
    if (!repo) return;
    const list = el('tag-browser-list');
    list.innerHTML = '';
    const counts = computeTagCounts(repo.id);
    el('tag-browser-empty-hint').hidden = counts.length > 0;

    for (const [tag, count] of counts) {
      const item = document.createElement('div');
      item.className = 'tag-browser-item';

      const label = document.createElement('span');
      label.className = 'tag-browser-tag';
      label.textContent = `#${tag}`;
      item.appendChild(label);

      const countSpan = document.createElement('span');
      countSpan.className = 'tag-browser-count';
      countSpan.textContent = String(count);
      item.appendChild(countSpan);

      // Tap remplit le champ de recherche avec ce tag et relance la
      // recherche — même comportement qu'Android (`updateQuery(tag)`).
      item.addEventListener('click', () => {
        el('tag-browser-dlg').close();
        el('browser-search-input').value = tag;
        render();
      });
      list.appendChild(item);
    }
    el('tag-browser-dlg').showModal();
  }

  function updateBreadcrumb() {
    el('browser-title').textContent = State.dirStack.map(s => s.name).join(' / ');
  }

  // `searchTerm` : passé seulement pour un résultat de recherche de CONTENU
  // (voir render() plus bas) — au clic, la note s'ouvre directement sur la
  // première occurrence du terme trouvé plutôt que de laisser l'utilisateur
  // la rechercher à la main dans le texte.
  function renderFileRow(file, searchTerm) {
    const item = document.createElement('div');
    item.className = 'file-item';
    // Surligne la note actuellement ouverte dans le panneau épinglé
    // (round 19) — sans effet hors de ce mode (Editor.currentPath() est
    // toujours `null` tant qu'aucune note n'est ouverte à côté du
    // navigateur, ce qui n'arrive jamais hors mode épinglé).
    if (State.settings.fileListSidebarMode && Editor.currentPath() === file.path) {
      item.classList.add('file-item-active');
    }

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

    const actionsBtn = document.createElement('button');
    actionsBtn.className = 'icon-btn file-item-actions-btn';
    actionsBtn.title = I18n.t('browser.actionsTooltip');
    actionsBtn.textContent = '⋮';
    actionsBtn.addEventListener('click', e => {
      e.stopPropagation(); // ne pas déclencher l'ouverture de la note
      openNoteActions(file);
    });
    item.appendChild(actionsBtn);

    // `openOther` (pas `open` direct) : avec le panneau épinglé (round 19),
    // cette ligne peut rester cliquable pendant qu'une AUTRE note, déjà
    // ouverte dans le panneau, a des modifications non enregistrées.
    item.addEventListener('click', () => Editor.openOther(file, searchTerm ? { searchTerm } : undefined));
    return item;
  }

  // --- Menu d'actions par note (Renommer / Déplacer / Dupliquer / Nouvelle
  // note / Supprimer) -----------------------------------------------------
  // Porté de BrowserScreen.kt : `fileForActions` (menu) -> `fileToRename`/
  // `fileToMove`/`fileToDelete` (dialogues dédiés), même ordre. "Dupliquer"
  // et "Nouvelle note" n'ont pas d'équivalent à cet endroit côté Android —
  // ajoutés ici sur demande explicite, juste avant "Supprimer" (qui reste
  // en dernier, seule action destructrice du menu).

  function openNoteActions(file) {
    _actionsFile = file;
    el('note-actions-title').textContent = file.name;
    el('note-actions-dlg').showModal();
  }

  function closeNoteActions() {
    el('note-actions-dlg').close();
  }

  function openRenameFromActions() {
    const file = _actionsFile;
    closeNoteActions();
    if (!file) return;
    el('note-rename-input').value = file.name;
    el('note-rename-dlg').showModal();
    el('note-rename-input').focus();
    el('note-rename-input').select();
  }

  // Renomme depuis le navigateur (pas depuis l'éditeur — editor.js a son
  // propre `confirmRename`, distinct : renommer la note actuellement
  // ouverte n'a pas besoin d'écrire d'abord le contenu en attente d'une
  // AUTRE note). Même règle d'extension que partout ailleurs (conserve
  // l'extension reconnue existante, sinon ajoute la première configurée).
  async function confirmNoteRenameFromBrowser() {
    const raw = el('note-rename-input').value.trim();
    el('note-rename-dlg').close();
    const file = _actionsFile;
    const repo = activeRepository();
    if (!raw || !file || !repo || raw === file.name) return;

    const extensions = noteExtensionsList();
    const hasRecognisedExt = extensions.some(ext => raw.toLowerCase().endsWith(ext));
    const newName = hasRecognisedExt ? raw : raw + (extensions[0] || '');

    try {
      const parentDir = await FSA.getParentDirHandle(repo.dirHandle, file.path);
      await FSA.renameFile(file.fileHandle, parentDir, newName);
    } catch (e) {
      alert(I18n.t('common.renameFailed', { error: e.message }));
      return;
    }
    try {
      await Index.indexRepository(repo, { forceFull: true });
    } catch (e) {
      console.error('Échec de la réindexation après renommage', e);
    }
    await rescan();
  }

  // Duplique une note dans son dossier d'origine, suffixe `_copy` inséré
  // juste avant l'extension (ex. "note.txt" -> "note_copy.txt"). Bloque
  // (plutôt que d'écraser silencieusement, `getFileHandle(create:true)`
  // de FSA ne suffixe pas automatiquement en cas de collision comme SAF
  // côté Android) si ce nom existe déjà — l'utilisateur peut alors
  // renommer la copie existante avant de réessayer.
  async function duplicateFromActions() {
    const file = _actionsFile;
    closeNoteActions();
    if (!file) return;
    const repo = activeRepository();
    if (!repo) return;

    const dotIndex = file.name.lastIndexOf('.');
    const base = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
    const ext = dotIndex > 0 ? file.name.slice(dotIndex) : '';
    const newName = `${base}_copy${ext}`;

    try {
      const parentDir = await FSA.getParentDirHandle(repo.dirHandle, file.path);
      let exists = true;
      try {
        await parentDir.getFileHandle(newName);
      } catch (e) {
        exists = false;
      }
      if (exists) {
        alert(I18n.t('browser.duplicateAlreadyExists', { name: newName }));
        return;
      }
      const content = await FSA.readFileText(file.fileHandle);
      await FSA.writeNewFile(parentDir, newName, content);
    } catch (e) {
      alert(I18n.t('browser.duplicateFailed', { error: e.message }));
      return;
    }
    try {
      await Index.indexRepository(repo, { forceFull: true });
    } catch (e) {
      console.error('Échec de la réindexation après duplication', e);
    }
    await rescan();
  }

  async function deleteFromActions() {
    const file = _actionsFile;
    closeNoteActions();
    if (!file) return;
    if (!confirm(I18n.t('browser.deleteConfirm', { name: file.name }))) return;
    const repo = activeRepository();
    if (!repo) return;
    try {
      const parentDir = await FSA.getParentDirHandle(repo.dirHandle, file.path);
      await FSA.deleteFile(parentDir, file.name);
    } catch (e) {
      alert(I18n.t('browser.deleteFailed', { error: e.message }));
      return;
    }
    // Room = projection reconstructible : purge la note (et ses backlinks)
    // par une réindexation complète, pas une suppression ciblée par chemin
    // dans chaque structure — même raisonnement qu'Android (round 10).
    try {
      await Index.indexRepository(repo, { forceFull: true });
    } catch (e) {
      console.error('Échec de la réindexation après suppression', e);
    }
    await rescan();
  }

  // --- Déplacer une note (sous-dossier ou autre dépôt) ------------------------
  // Porté de MoveNoteDialog.kt : sélecteur de dépôt destination (si plusieurs
  // dépôts) + navigation dans son arborescence + "Déplacer ici", désactivé
  // sur l'emplacement actuel. Démarre toujours à la RACINE du dépôt
  // sélectionné (comportement Android exact, pas le dossier navigué).

  function moveIsCurrentLocation() {
    if (!_moveTargetRepo || !_movePath.length) return false;
    const repo = activeRepository();
    if (!repo || _moveTargetRepo.id !== repo.id) return false;
    return _movePath[_movePath.length - 1].path === currentDirPath();
  }

  function openMoveDialog(file) {
    const repo = activeRepository();
    if (!repo) return;
    _moveFile = file;
    _moveTargetRepo = repo;
    _movePath = [{ name: repo.name, handle: repo.dirHandle, path: '' }];
    renderMoveRepoSelect();
    renderMoveBreadcrumbAndList();
    el('note-move-file').textContent = I18n.t('browser.moveNoteFileLabel', { name: file.name });
    el('note-move-dlg').showModal();
  }

  function renderMoveRepoSelect() {
    const select = el('note-move-repo-select');
    select.innerHTML = '';
    for (const repo of State.repositories) {
      const opt = document.createElement('option');
      opt.value = repo.id;
      opt.textContent = repo.name;
      select.appendChild(opt);
    }
    select.value = _moveTargetRepo.id;
    el('note-move-repo-row').hidden = State.repositories.length <= 1;
  }

  async function renderMoveBreadcrumbAndList() {
    el('note-move-breadcrumb').textContent =
      [_moveTargetRepo.name, ...(_movePath.slice(1).map(s => s.name))].join(' / ');

    const list = el('note-move-list');
    list.innerHTML = '';
    const current = _movePath[_movePath.length - 1];

    if (_movePath.length > 1) {
      const up = document.createElement('div');
      up.className = 'file-item folder-item';
      up.textContent = '⬆ ..';
      up.addEventListener('click', () => {
        _movePath.pop();
        renderMoveBreadcrumbAndList();
        updateMoveConfirmState();
      });
      list.appendChild(up);
    }

    let subdirs = [];
    try {
      ({ subdirs } = await FSA.listChildren(current.handle, [], true));
    } catch (e) {
      console.error('Échec de la lecture des sous-dossiers', e);
    }
    for (const subdir of subdirs) {
      const item = document.createElement('div');
      item.className = 'file-item folder-item';
      item.innerHTML = Icons.folder();
      const label = document.createElement('span');
      label.textContent = subdir.name;
      item.appendChild(label);
      item.addEventListener('click', () => {
        _movePath.push({ name: subdir.name, handle: subdir.handle, path: current.path + subdir.name + '/' });
        renderMoveBreadcrumbAndList();
        updateMoveConfirmState();
      });
      list.appendChild(item);
    }
    if (!subdirs.length && _movePath.length === 1) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = I18n.t('browser.moveNoSubfolderHint');
      list.appendChild(hint);
    }
    updateMoveConfirmState();
  }

  function updateMoveConfirmState() {
    el('note-move-confirm').disabled = moveIsCurrentLocation();
  }

  // Copie le contenu vers la destination, PUIS supprime la source — jamais
  // l'inverse (perte possible sinon) — même précaution qu'Android
  // (`moveNote`/`MoveOutcome`, pas `DocumentsContract.moveDocument`, non
  // fiable entre deux arbres SAF/FSA distincts).
  async function performMove() {
    const file = _moveFile;
    const sourceRepo = activeRepository();
    const destRepo = _moveTargetRepo;
    const destEntry = _movePath[_movePath.length - 1];
    el('note-move-dlg').close();
    if (!file || !sourceRepo || !destRepo) return;

    let content;
    try {
      content = await FSA.readFileText(file.fileHandle);
    } catch (e) {
      alert(I18n.t('browser.moveFailed', { error: e.message }));
      return;
    }

    try {
      await FSA.writeNewFile(destEntry.handle, file.name, content);
    } catch (e) {
      alert(I18n.t('browser.moveWriteFailed', { error: e.message }));
      return;
    }

    try {
      const parentDir = await FSA.getParentDirHandle(sourceRepo.dirHandle, file.path);
      await FSA.deleteFile(parentDir, file.name);
    } catch (e) {
      alert(I18n.t('browser.movePartialFailure', { error: e.message }));
    }

    try { await Index.indexRepository(sourceRepo, { forceFull: true }); } catch (e) { console.error(e); }
    if (destRepo.id !== sourceRepo.id) {
      try { await Index.indexRepository(destRepo, { forceFull: true }); } catch (e) { console.error(e); }
    }
    await rescan();
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
      // Pas d'icône de dossier : déjà distingué des fichiers par
      // `.folder-item` (couleur d'accent + gras) sans avoir besoin d'un
      // glyphe supplémentaire.
      item.className = 'file-item folder-item';
      item.textContent = subdir.name;
      item.addEventListener('click', async () => { await dirEnter(subdir); render(); });
      list.appendChild(item);
      anyRow = true;
    }

    for (const file of sortFiles(State.repoFiles)) {
      list.appendChild(renderFileRow(file));
      anyRow = true;
    }

    el('browser-empty-hint').hidden = anyRow;
    el('browser-empty-hint').textContent = I18n.t('browser.emptyHintNoFolder');
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
    el('browser-empty-hint').textContent = I18n.t('browser.emptyHintNoResults');
    const jumpTerm = _searchMode === 'content' ? query : undefined;
    results.forEach(file => list.appendChild(renderFileRow(file, jumpTerm)));
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
    el('repo-options-repair').disabled = true;
    try {
      await Index.indexRepository(repo);
      render(); // refresh in case a search was already active
    } finally {
      el('repo-options-repair').disabled = false;
      updateRepairButtonLabel();
    }
  }

  async function openActive() {
    await rescan();
    reindexActive(); // not awaited — see reindexActive() comment
  }

  // --- Créer une nouvelle note -------------------------------------------------
  // Porté de BrowserScreen.kt (round 10 Android) : bouton "+" -> dialogue de
  // nom -> création dans le dossier actuellement affiché -> ouverture directe
  // dans l'éditeur (contrairement à writhdeck-android, qui se contente de
  // rafraîchir la liste). Round 16 (retour utilisateur) : la même action est
  // aussi accessible depuis le menu ⋮ d'une note existante, pour créer dans
  // SON dossier sans remonter à la racine si on navigue dans un sous-dossier
  // — `_newNoteTarget` porte donc le dossier cible explicitement plutôt que
  // de toujours supposer "le dossier actuellement affiché".

  let _newNoteTarget = null; // {handle, path} — dossier où la nouvelle note sera créée

  function openNewNoteDialog() {
    _newNoteTarget = { handle: currentDirHandle(), path: currentDirPath() };
    el('new-note-input').value = '';
    el('new-note-dlg').showModal();
    el('new-note-input').focus();
  }

  // `_actionsFile` peut venir d'un résultat de recherche (portée récursive),
  // pas forcément du dossier actuellement affiché — on vise donc TOUJOURS le
  // dossier réel de la note ciblée, jamais `currentDirHandle()`.
  async function openNewNoteDialogFromActions() {
    const file = _actionsFile;
    closeNoteActions();
    if (!file) return;
    const repo = activeRepository();
    if (!repo) return;
    const parts = file.path.split('/').filter(Boolean);
    parts.pop();
    const dirPath = parts.length ? parts.join('/') + '/' : '';
    let handle;
    try {
      handle = await FSA.getParentDirHandle(repo.dirHandle, file.path);
    } catch (e) {
      alert(I18n.t('browser.newNoteFailed', { error: e.message }));
      return;
    }
    _newNoteTarget = { handle, path: dirPath };
    el('new-note-input').value = '';
    el('new-note-dlg').showModal();
    el('new-note-input').focus();
  }

  async function confirmNewNote() {
    const raw = el('new-note-input').value.trim();
    el('new-note-dlg').close();
    const target = _newNoteTarget;
    if (!raw || !target) return;
    const repo = activeRepository();
    if (!repo) return;

    const extensions = noteExtensionsList();
    const hasRecognisedExt = extensions.some(ext => raw.toLowerCase().endsWith(ext));
    const finalName = hasRecognisedExt ? raw : raw + (extensions[0] || '');
    // Liste réelle du dossier CIBLE (pas `State.repoFiles`, qui ne reflète
    // que le dossier actuellement affiché — peut différer de la cible
    // quand on vient du menu ⋮ d'une note d'un autre dossier), tous
    // fichiers confondus (pas seulement les notes reconnues) pour ne
    // jamais silencieusement réutiliser/écraser un fichier existant.
    let siblings;
    try {
      ({ files: siblings } = await FSA.listChildren(target.handle, [], true));
    } catch (e) {
      alert(I18n.t('browser.newNoteFailed', { error: e.message }));
      return;
    }
    if (siblings.some(f => f.name.toLowerCase() === finalName.toLowerCase())) {
      alert(I18n.t('browser.newNoteAlreadyExists', { name: finalName }));
      return;
    }

    let created;
    try {
      created = await FSA.createNoteFile(target.handle, raw, extensions);
    } catch (e) {
      alert(I18n.t('browser.newNoteFailed', { error: e.message }));
      return;
    }
    const file = {
      path: target.path + created.name, name: created.name,
      fileHandle: created.handle, lastModified: Date.now()
    };
    try {
      await Index.indexNote(repo.id, file, '');
    } catch (e) {
      console.error('Échec de l\'indexation de la nouvelle note', e);
    }
    // `openOther` : voir le commentaire de renderFileRow — même risque en
    // panneau épinglé si une AUTRE note dirty était déjà ouverte.
    Editor.openOther(file);
  }

  // Ligne de texte cliquable dans "Options du dépôt" (jamais une icône
  // isolée dans la barre — demande explicite : rien de potentiellement
  // destructif en accès direct sans contexte). Reste désactivée + relabellisée
  // pendant l'exécution (même retour visuel qu'Android : `isRepairingLinks`),
  // le dialogue reste ouvert derrière l'alerte de résultat.
  function updateRepairButtonLabel() {
    const btn = el('repo-options-repair');
    btn.innerHTML = `${Icons.wrench()} ${I18n.t(btn.disabled ? 'browser.repairingLabel' : 'browser.repairLinksLabel')}`;
  }

  async function repairAllLinks() {
    const repo = activeRepository();
    if (!repo) return;
    el('repo-options-repair').disabled = true;
    updateRepairButtonLabel();
    try {
      const count = await Index.repairAllLinks(repo.id, repo);
      alert(count > 0 ? I18n.t('browser.repairDone', { count }) : I18n.t('browser.repairNothing'));
    } finally {
      el('repo-options-repair').disabled = false;
      updateRepairButtonLabel();
    }
  }

  // Un seul glyphe pour les deux états (le tri par nom/date n'a pas
  // d'équivalent monochrome simple et distinct) — le libellé de l'infobulle
  // dit quel ordre est actif.
  function updateSortButton() {
    const btn = el('browser-sort-btn');
    if (!btn.firstChild) btn.innerHTML = Icons.sort();
    btn.title = State.settings.noteSortOrder === 'modified'
      ? I18n.t('browser.sortByNameTooltip')
      : I18n.t('browser.sortByModifiedTooltip');
  }

  async function toggleSort() {
    await setNoteSortOrder(State.settings.noteSortOrder === 'modified' ? 'name' : 'modified');
    render();
  }

  function syncRepoOptionsUI() {
    const repo = activeRepository();
    el('repo-options-include-extension').checked = !!(repo && repo.includeExtensionInLinks);
    el('repo-options-name-input').value = repo ? repo.name : '';
    updateRepairButtonLabel();
  }

  function openRepoOptions() {
    if (!activeRepository()) return;
    syncRepoOptionsUI();
    el('repo-options-dlg').showModal();
  }

  async function confirmRenameRepositoryFromOptions() {
    const repo = activeRepository();
    if (!repo) return;
    await renameRepository(repo, el('repo-options-name-input').value);
    el('repo-options-name-input').value = repo.name;
    render(); // le titre du navigateur (fil d'Ariane) reflète le nouveau nom
  }

  // --- Menu "⋮" du navigateur (Options du dépôt / Nouvelle note / Réglages) -
  // Consolide trois points d'entrée auparavant en icônes séparées dans la
  // barre — demande explicite : ne rien laisser en accès direct sans
  // libellé explicite, en particulier "Réparer les liens" (potentiellement
  // long/perturbateur), désormais une ligne texte DANS le dialogue "Options
  // du dépôt", jamais une icône cliquable isolée. Même mécanisme
  // ouvrir/fermer/clic-extérieur/Échap que `editor.js`'s `#editor-menu`.

  function openBrowserMenu() {
    el('browser-menu').hidden = false;
  }

  function closeBrowserMenu() {
    el('browser-menu').hidden = true;
  }

  function toggleBrowserMenu() {
    el('browser-menu').hidden ? openBrowserMenu() : closeBrowserMenu();
  }

  function runBrowserMenuAction(fn) {
    return () => { closeBrowserMenu(); fn(); };
  }

  // Back button goes up one folder first, like a normal file manager —
  // only leaves the repository entirely once already at its root (mirrors
  // Android's BrowserScreen: "navigateUp() renvoie false à la racine, seul
  // cas où l'écran se quitte réellement").
  async function backOrUp() {
    if (await dirUp()) { render(); return; }
    // Liste de fichiers épinglée (round 19) : une note ouverte (et non
    // enregistrée) dans le panneau peut encore être là au moment où on
    // quitte le dépôt depuis la racine — même garde-fou "enregistrer avant
    // de quitter" que partout ailleurs. No-op sûr hors mode épinglé (aucune
    // note n'est jamais ouverte à cet instant dans le mode historique).
    if (!(await Editor.requestClose())) return;
    Repositories.showList();
  }

  // Libellés construits avec une icône (pas couverts par le sweep
  // `data-i18n` générique, statique) — regroupés ici pour être rappelés à
  // la fois à l'init et sur l'évènement `i18n:apply` (changement de langue
  // en direct, voir i18n.js).
  function refreshI18nLabels() {
    el('note-actions-rename').innerHTML = `${Icons.edit()} ${I18n.t('common.rename')}`;
    el('note-actions-move').innerHTML = `${Icons.folder()} ${I18n.t('browser.moveTitle')}`;
    el('note-actions-duplicate').innerHTML = `${Icons.copy()} ${I18n.t('common.duplicate')}`;
    el('note-actions-new').innerHTML = `${Icons.filePlus()} ${I18n.t('browser.newNoteTitle')}`;
    el('note-actions-delete').innerHTML = `${Icons.trash()} ${I18n.t('common.delete')}`;
    el('note-rename-confirm').innerHTML = `${Icons.save()} ${I18n.t('common.rename')}`;
    el('browser-menu-repo-options').innerHTML = `${Icons.gear()} ${I18n.t('browser.repoOptionsTitle')}`;
    el('browser-menu-new-note').innerHTML = `${Icons.filePlus()} ${I18n.t('browser.newNoteTitle')}`;
    el('browser-menu-settings').innerHTML = `${Icons.gear()} ${I18n.t('common.settings')}`;
    el('repo-options-rename-save').innerHTML = Icons.save();
    updateRepairButtonLabel();
    updateSortButton();
    el('browser-search-input').placeholder = searchPlaceholder(_searchMode);
  }

  // --- Redimensionnement du panneau de fichiers épinglé (round 19bis) ------
  // Pas de plancher lié au contenu (demande explicite : "même si c'est plus
  // petit que la longueur du titre de la plus longue note") — seules ces
  // bornes fixes s'appliquent. Live pendant le glisser (variable CSS mise à
  // jour à chaque `mousemove`, pas de re-render coûteux) ; persisté une
  // seule fois au relâchement (`setFileListSidebarWidth`), pas à chaque
  // pixel glissé.
  const FILE_LIST_SIDEBAR_MIN = 160;
  const FILE_LIST_SIDEBAR_MAX = 640;

  function wireSidebarResizer() {
    const handle = el('file-list-sidebar-resizer');
    let dragWidth = null;

    function clamp(px) {
      return Math.min(FILE_LIST_SIDEBAR_MAX, Math.max(FILE_LIST_SIDEBAR_MIN, px));
    }

    handle.addEventListener('mousedown', e => {
      dragWidth = State.settings.fileListSidebarWidth;
      handle.classList.add('resizing');
      document.body.style.userSelect = 'none'; // évite de sélectionner le texte en dessous pendant le glisser
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (dragWidth === null) return;
      const rect = el('browser-screen').getBoundingClientRect();
      dragWidth = clamp(e.clientX - rect.left);
      document.documentElement.style.setProperty('--file-list-sidebar-width', dragWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (dragWidth === null) return;
      handle.classList.remove('resizing');
      document.body.style.userSelect = '';
      setFileListSidebarWidth(dragWidth);
      dragWidth = null;
    });
  }

  function init() {
    el('browser-tags-btn').innerHTML = Icons.tag();
    wireSidebarResizer();
    refreshI18nLabels();
    document.addEventListener('i18n:apply', refreshI18nLabels);

    el('browser-back-btn').addEventListener('click', backOrUp);
    el('browser-refresh-btn').addEventListener('click', async () => { await rescan(); reindexActive(); });
    el('browser-sort-btn').addEventListener('click', toggleSort);

    el('browser-menu-btn').addEventListener('click', toggleBrowserMenu);
    el('browser-menu-repo-options').addEventListener('click', runBrowserMenuAction(openRepoOptions));
    el('browser-menu-new-note').addEventListener('click', runBrowserMenuAction(openNewNoteDialog));
    el('browser-menu-settings').addEventListener('click', runBrowserMenuAction(() => Settings.open('browser-screen')));
    document.addEventListener('click', e => {
      if (el('browser-menu').hidden) return;
      if (e.target === el('browser-menu-btn') || el('browser-menu').contains(e.target)) return;
      closeBrowserMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !el('browser-menu').hidden) closeBrowserMenu();
    });

    el('new-note-cancel').addEventListener('click', () => el('new-note-dlg').close());
    el('new-note-create').addEventListener('click', confirmNewNote);
    el('new-note-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmNewNote(); });

    el('note-actions-close').addEventListener('click', closeNoteActions);
    el('note-actions-rename').addEventListener('click', openRenameFromActions);
    el('note-actions-move').addEventListener('click', () => { const f = _actionsFile; closeNoteActions(); if (f) openMoveDialog(f); });
    el('note-actions-duplicate').addEventListener('click', duplicateFromActions);
    el('note-actions-new').addEventListener('click', openNewNoteDialogFromActions);
    el('note-actions-delete').addEventListener('click', deleteFromActions);

    el('note-rename-cancel').addEventListener('click', () => el('note-rename-dlg').close());
    el('note-rename-confirm').addEventListener('click', confirmNoteRenameFromBrowser);

    el('note-move-close').addEventListener('click', () => el('note-move-dlg').close());
    el('note-move-cancel').addEventListener('click', () => el('note-move-dlg').close());
    el('note-move-confirm').addEventListener('click', performMove);
    el('note-move-repo-select').addEventListener('change', e => {
      _moveTargetRepo = State.repositories.find(r => r.id === e.target.value) || _moveTargetRepo;
      _movePath = [{ name: _moveTargetRepo.name, handle: _moveTargetRepo.dirHandle, path: '' }];
      renderMoveBreadcrumbAndList();
    });

    el('browser-search-input').addEventListener('input', scheduleRender);
    for (const btn of document.querySelectorAll('#browser-search-mode button')) {
      btn.addEventListener('click', () => {
        _searchMode = btn.dataset.mode;
        for (const b of document.querySelectorAll('#browser-search-mode button')) b.classList.toggle('active', b === btn);
        el('browser-search-input').placeholder = searchPlaceholder(_searchMode);
        // Le bouton "parcourir les tags" n'a de sens qu'en mode #Tag — même
        // condition qu'Android (`if (viewModel.mode == SearchMode.TAG)`).
        el('browser-tags-btn').hidden = _searchMode !== 'tag';
        render();
      });
    }
    el('browser-tags-btn').addEventListener('click', openTagBrowser);
    el('tag-browser-close').addEventListener('click', () => el('tag-browser-dlg').close());

    el('repo-options-close').addEventListener('click', () => el('repo-options-dlg').close());
    el('repo-options-rename-save').addEventListener('click', confirmRenameRepositoryFromOptions);
    el('repo-options-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmRenameRepositoryFromOptions(); });
    el('repo-options-repair').addEventListener('click', repairAllLinks);
    el('repo-options-include-extension').addEventListener('change', async e => {
      const repo = activeRepository();
      if (!repo) return;
      await setIncludeExtensionInLinks(repo, e.target.checked);
    });
  }

  return { init, render, rescan, openActive };
})();

