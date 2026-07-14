'use strict';
// Editor screen — phase 2 (textarea+overlay technique from writhdeck-web,
// read/write via FileSystemFileHandle) + phase 3 (preview toggle rendering
// the real txt2tags AST to HTML) + phase 5 (Zettelkasten: insert ID/link,
// backlinks panel, clickable resolved ZkLinks in preview, link repair on
// open) + phase 6 (TOC, settings). Top bar and "⋮" overflow menu are a
// faithful port of zettelium-android's `EditorScreen.kt` top app bar: TOC,
// backlinks (badge count), preview/edit toggle, save always visible;
// insert ID/insert link (hidden while previewing), rename, create/restore
// backup, and settings live in the overflow menu — same order, same
// reasoning ("actions moins fréquentes que naviguer/prévisualiser/
// enregistrer").
const Editor = (() => {
  const ta  = () => document.getElementById('ed-input');
  const pre = () => document.getElementById('ed-highlight');
  const el  = id => document.getElementById(id);

  let _repo = null;   // active Repository at the time this note was opened
  let _file = null;   // NoteFile currently open (path, name, fileHandle, ...)
  let _zkId = null;    // this note's own Zettelkasten ID, if any (from the index or freshly detected)
  let _dirty = false;
  let _previewMode = false;

  async function open(file) {
    let content;
    try {
      content = await FSA.readFileText(file.fileHandle);
    } catch (e) {
      alert(`Impossible d'ouvrir "${file.name}" : ${e.message}`);
      return;
    }

    _repo = activeRepository();
    _file = file;
    _dirty = false;
    _previewMode = false;
    _zkId = detectZkId(file, content);

    el('browser-screen').hidden = true;
    el('editor-screen').hidden = false;
    el('ed-wrap').hidden = false;
    el('ed-preview').hidden = true;
    el('editor-preview-btn').textContent = '👁';
    el('editor-preview-btn').title = 'Aperçu';

    const input = ta();
    input.value = content;
    rehighlight();
    updateTitle();
    updateBacklinksBadge();
    input.focus();

    // Rattrape un renommage fait hors de l'app depuis la dernière fois
    // (round 5 Android, "garantie de résistance au renommage") — best-effort,
    // ne bloque jamais l'ouverture si ça échoue.
    if (_repo && _zkId) {
      const target = ZettelkastenLinks.linkTarget(file.name, _repo.includeExtensionInLinks, noteExtensionsList());
      Index.repairBacklinksFor(_repo.id, _zkId, target, file.path).catch(e =>
        console.error('Échec de la réparation des liens à l\'ouverture', e));
    }
  }

  // Préfère l'entrée déjà indexée (évite de reparser) ; retombe sur une
  // détection directe si l'index n'a pas encore fini de tourner en arrière-
  // plan (Browser.reindexActive() n'est pas attendu avant que l'utilisateur
  // puisse cliquer un fichier).
  function detectZkId(file, content) {
    const indexed = _repo ? Index.findByPath(_repo.id, file.path) : undefined;
    if (indexed) return indexed.zkId;
    const idRegex = ZettelkastenLinks.compileIdRegex(State.settings.idPattern);
    return ZettelkastenLinks.extractId(file.name, content, idRegex);
  }

  function updateTitle() {
    el('editor-title').textContent = _file ? (_file.name + (_dirty ? ' •' : '')) : '';
    el('editor-save-btn').disabled = !_dirty;
  }

  function updateBacklinksBadge() {
    const badge = el('editor-backlinks-badge');
    const count = (_repo && _zkId) ? Index.backlinksFor(_repo.id, _zkId, _file.path).length : 0;
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  function markDirty() {
    if (_dirty) return;
    _dirty = true;
    updateTitle();
  }

  function rehighlight() {
    pre().innerHTML = Highlight.highlight(ta().value);
    syncGutter();
  }

  // Compensates for the textarea's scrollbar width so both elements wrap
  // text at the same width — ported from writhdeck-web's syncGutter().
  function syncGutter() {
    const input = ta();
    const hl = pre();
    const gutter = input.offsetWidth - input.clientWidth;
    const baseRight = parseFloat(getComputedStyle(input).paddingRight) || 0;
    hl.style.paddingRight = (baseRight + gutter) + 'px';
  }

  function syncScroll() {
    pre().scrollTop = ta().scrollTop;
    pre().scrollLeft = ta().scrollLeft;
  }

  function onInput() {
    rehighlight();
    markDirty();
  }

  // Directly assigning `input.value` (as this used to do) clears the
  // browser's native undo history for the textarea — reported bug: Ctrl+Z
  // stopped working after using "Insérer un ID"/"Insérer un lien", because
  // that reset the undo stack on every insertion. `execCommand('insertText')`
  // instead makes the browser treat the insertion like real typing (proper
  // `beforeinput`/`input` events, integrated into undo/redo) — refocusing
  // the textarea first is required (the button that was clicked stole
  // focus), but that alone doesn't touch `selectionStart`/`selectionEnd`,
  // so the insertion still lands at the right spot.
  function insertAtCursor(text) {
    const input = ta();
    input.focus();
    const usedNativeInsert = !!(document.execCommand && document.execCommand('insertText', false, text));
    if (!usedNativeInsert) {
      // Fallback for a browser without execCommand('insertText') support —
      // functionally correct, just loses undo history for this one edit.
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const value = input.value;
      input.value = value.slice(0, start) + text + value.slice(end);
      const caret = start + text.length;
      input.setSelectionRange(caret, caret);
      onInput(); // the execCommand path already triggers our 'input' listener natively
    }
  }

  // Même technique que insertAtCursor (undo-safe) mais remplace tout le
  // contenu — utilisée par la restauration de sauvegarde : sélectionne tout
  // puis "tape" le nouveau texte par-dessus.
  function replaceAllContent(text) {
    const input = ta();
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const used = !!(document.execCommand && document.execCommand('insertText', false, text));
    if (!used) {
      input.value = text;
      onInput();
    }
  }

  function insertId() {
    insertAtCursor(ZettelkastenLinks.generateId(new Date(), State.settings.idGenerationFormat));
  }

  async function save() {
    if (!_file || !_dirty) return;
    const content = ta().value;
    try {
      const writable = await _file.fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (e) {
      alert(`Échec de l'enregistrement : ${e.message}`);
      return;
    }
    _dirty = false;
    updateTitle();
    if (_repo) {
      try {
        await Index.indexNote(_repo.id, _file, content);
        const reindexed = Index.findByPath(_repo.id, _file.path);
        _zkId = reindexed ? reindexed.zkId : _zkId;
        updateBacklinksBadge();
      } catch (e) {
        console.error('Échec de la réindexation après enregistrement', e);
      }
    }
  }

  // Yes/No/Cancel confirmation (Yes = save & close, No = discard & close,
  // Cancel = stay open) via the #close-confirm-dlg <dialog> — a native
  // confirm() only offers two buttons, which would force "Cancel" to mean
  // "discard", with no way to abort closing altogether (same reasoning as
  // writhdeck-web's confirmSaveBeforeClose, ported here in simplified form).
  let _closeConfirmResolve = null;
  function confirmSaveBeforeClose(name) {
    el('close-confirm-msg').textContent = `Enregistrer les modifications de "${name}" avant de fermer ?`;
    el('close-confirm-dlg').showModal();
    return new Promise(resolve => { _closeConfirmResolve = resolve; });
  }

  // Vrai si on peut effectivement quitter la note (enregistrée si besoin, ou
  // abandon explicite) — faux si l'utilisateur annule. Généralisé à TOUTE
  // sortie de la note (fermeture, suivre un lien/backlink), pas seulement au
  // bouton retour : Android avait initialement ce garde-fou seulement sur le
  // retour, et perdait silencieusement les modifications en suivant un lien
  // (round 19) — corrigé dès le départ ici plutôt que redécouvert plus tard.
  async function requestLeave() {
    if (_dirty) {
      const choice = await confirmSaveBeforeClose(_file.name);
      if (choice === 'cancel') return false;
      if (choice === 'yes') await save();
    }
    return true;
  }

  async function requestClose() {
    if (!(await requestLeave())) return;
    close();
  }

  // Ouvre une autre note depuis l'éditeur (backlink, ZkLink cliqué en
  // aperçu) — remplace la note affichée sans repasser par le navigateur.
  async function openOther(file) {
    if (!(await requestLeave())) return;
    await open(file);
  }

  function close() {
    _repo = null;
    _file = null;
    _zkId = null;
    _dirty = false;
    _previewMode = false;
    el('editor-screen').hidden = true;
    el('browser-screen').hidden = false;
    Browser.rescan();
  }

  function togglePreview() {
    _previewMode = !_previewMode;
    if (_previewMode) {
      const ast = Txt2TagsParser.parse(ta().value);
      const resolveZkLink = _repo ? (zkId => Index.findByZkId(_repo.id, zkId)) : undefined;
      el('ed-preview').innerHTML = Txt2TagsRender.renderAstToHtml(ast, { resolveZkLink });
      el('ed-wrap').hidden = true;
      el('ed-preview').hidden = false;
      el('editor-preview-btn').textContent = '✏️';
      el('editor-preview-btn').title = 'Édition';
    } else {
      el('ed-wrap').hidden = false;
      el('ed-preview').hidden = true;
      el('editor-preview-btn').textContent = '👁';
      el('editor-preview-btn').title = 'Aperçu';
      rehighlight();
    }
    updateEditorMenuVisibility();
  }

  // Clic sur un ZkLink résolu (<a data-zk-path>) dans l'aperçu — délégation
  // d'événement sur #ed-preview, posée une seule fois à l'init (le contenu
  // de #ed-preview est réécrit à chaque bascule aperçu/édition).
  function onPreviewClick(e) {
    const link = e.target.closest('.zk-link[data-zk-path]');
    if (!link || !_repo) return;
    e.preventDefault();
    const entry = Index.findByPath(_repo.id, link.dataset.zkPath);
    if (!entry) return;
    openOther({ path: entry.path, name: entry.name, fileHandle: entry.fileHandle, lastModified: entry.lastModified });
  }

  // --- Menu "⋮" (overflow) ----------------------------------------------------

  function openEditorMenu() {
    updateEditorMenuVisibility();
    el('editor-menu').hidden = false;
  }

  function closeEditorMenu() {
    el('editor-menu').hidden = true;
  }

  function toggleEditorMenu() {
    el('editor-menu').hidden ? openEditorMenu() : closeEditorMenu();
  }

  // Insertion d'ID/lien masquée en mode aperçu (rien à éditer) — même
  // condition qu'Android (`if (!previewMode) { ... }` dans le DropdownMenu).
  function updateEditorMenuVisibility() {
    el('editor-menu-insert-id').hidden = _previewMode;
    el('editor-menu-insert-link').hidden = _previewMode;
  }

  function runMenuAction(fn) {
    return () => { closeEditorMenu(); fn(); };
  }

  // --- Insertion de lien Zettelkasten (sélecteur filtrable) -----------------

  function openLinkPicker() {
    if (!_repo) return;
    el('zklink-filter').value = '';
    renderLinkPicker('');
    el('zklink-picker-dlg').showModal();
    el('zklink-filter').focus();
  }

  // Élément de liste à deux lignes utilisé par le sélecteur de lien et le
  // panneau de backlinks : nom du fichier d'abord (identifiant stable et
  // toujours présent), puis le premier titre *détecté* dans la note s'il y
  // en a un — pas de repli sur le nom de fichier ou un paragraphe comme le
  // ferait `entry.title` (utilisé pour l'indexation/recherche, pas ici) :
  // demande explicite de l'utilisateur, pour ne jamais afficher deux fois
  // la même information.
  function renderNoteItem(entry) {
    const item = document.createElement('div');
    item.title = entry.zkId; // toujours utile en info-bulle, même sans l'afficher en clair

    const name = document.createElement('span');
    name.className = 'note-item-name';
    name.textContent = entry.name;
    item.appendChild(name);

    if (entry.heading) {
      const heading = document.createElement('span');
      heading.className = 'note-item-heading';
      heading.textContent = entry.heading;
      item.appendChild(heading);
    }
    return item;
  }

  function renderLinkPicker(query) {
    const q = query.trim().toLowerCase();
    const list = el('zklink-list');
    list.innerHTML = '';
    const candidates = Index.entries(_repo.id)
      .filter(e => e.zkId && (e.path !== (_file && _file.path)))
      .filter(e => !q || e.name.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.zkId.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of candidates) {
      const item = renderNoteItem(entry);
      item.className = 'zklink-item';
      item.addEventListener('click', () => {
        const target = ZettelkastenLinks.linkTarget(entry.name, _repo.includeExtensionInLinks, noteExtensionsList());
        insertAtCursor(ZettelkastenLinks.formatLink(target, entry.zkId));
        el('zklink-picker-dlg').close();
      });
      list.appendChild(item);
    }
    el('zklink-empty-hint').hidden = candidates.length > 0;
  }

  // --- Panneau de backlinks --------------------------------------------------

  function openBacklinks() {
    if (!_repo || !_zkId) return;
    const list = el('backlinks-list');
    list.innerHTML = '';
    const backlinks = Index.backlinksFor(_repo.id, _zkId, _file.path)
      .sort((a, b) => a.name.localeCompare(b.name));

    el('backlinks-empty-hint').hidden = backlinks.length > 0;
    for (const entry of backlinks) {
      const item = renderNoteItem(entry);
      item.className = 'backlinks-item';
      item.addEventListener('click', () => {
        el('backlinks-dlg').close();
        openOther({ path: entry.path, name: entry.name, fileHandle: entry.fileHandle, lastModified: entry.lastModified });
      });
      list.appendChild(item);
    }
    el('backlinks-dlg').showModal();
  }

  // --- Table des matières ----------------------------------------------------

  function openToc() {
    const entries = Txt2TagsToc.build(ta().value);
    const list = el('toc-list');
    list.innerHTML = '';
    el('toc-empty-hint').hidden = entries.length > 0;

    entries.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.style.paddingLeft = `${12 + (entry.level - 1) * 16}px`;
      item.textContent = entry.title || '(sans titre)';
      item.addEventListener('click', () => {
        el('toc-dlg').close();
        navigateToToc(entry, index);
      });
      list.appendChild(item);
    });
    el('toc-dlg').showModal();
  }

  // En édition : place le curseur et fait défiler jusqu'à la ligne de titre
  // (technique du "mirror div" de writhdeck-web — mesure la position pixel
  // réelle en tenant compte du retour à la ligne automatique). En aperçu :
  // les entrées de TOC correspondent 1 pour 1, dans l'ordre, aux titres
  // rendus (même détection que le parseur, voir toc.js) — on peut donc
  // simplement prendre le Nième titre du DOM.
  function navigateToToc(entry, index) {
    if (_previewMode) {
      const headings = el('ed-preview').querySelectorAll('h1, h2, h3, h4, h5, h6');
      const target = headings[index];
      if (target) target.scrollIntoView({ block: 'start' });
      return;
    }
    const input = ta();
    input.focus();
    input.setSelectionRange(entry.charOffset, entry.charOffset);
    const top = pixelTopForOffset(entry.charOffset);
    input.scrollTop = Math.max(0, top - input.clientHeight / 3);
  }

  // Mesure la position pixel verticale du caractère à `offset` dans le
  // textarea, en tenant compte du retour à la ligne automatique — un div
  // caché recevant exactement le même style calculé (police, padding,
  // largeur...) que le textarea, rempli du texte jusqu'à `offset`, donne
  // cette hauteur via `offsetHeight`. Même technique que `linePixelTop()`
  // dans writhdeck-web/src/editor.js (PLAN.md section 4 : "technique DOM de
  // writhdeck-web, s'applique directement, pas de portage nécessaire").
  function pixelTopForOffset(offset) {
    const input = ta();
    const style = getComputedStyle(input);
    const mirror = document.createElement('div');
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.height = 'auto';
    mirror.style.width = input.clientWidth + 'px';
    for (const prop of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize']) {
      mirror.style[prop] = style[prop];
    }
    mirror.textContent = input.value.slice(0, offset);
    document.body.appendChild(mirror);
    const top = mirror.offsetHeight;
    document.body.removeChild(mirror);
    return top;
  }

  // --- Renommer (menu ⋮) -------------------------------------------------------

  function openRenameDialog() {
    if (!_file) return;
    el('rename-note-input').value = _file.name;
    el('rename-note-dlg').showModal();
    el('rename-note-input').focus();
    el('rename-note-input').select();
  }

  // Écrit d'abord les modifications en cours (le renommage conserve le
  // contenu sur disque mais pas les édits en mémoire — même précaution
  // qu'Android : `EditorViewModel.renameNote`), renomme via FSA, réindexe
  // le dépôt en entier (`forceFull`, comme Android : l'ancien chemin doit
  // disparaître de l'index, pas seulement le nouveau apparaître) puis
  // rouvre l'éditeur sur le fichier renommé.
  async function confirmRename() {
    const raw = el('rename-note-input').value.trim();
    el('rename-note-dlg').close();
    if (!raw || !_repo || !_file || raw === _file.name) return;

    const extensions = noteExtensionsList();
    const hasRecognisedExt = extensions.some(ext => raw.toLowerCase().endsWith(ext));
    const newName = hasRecognisedExt ? raw : raw + (extensions[0] || '');

    if (_dirty) await save();

    let newHandle;
    try {
      const parentDir = await FSA.getParentDirHandle(_repo.dirHandle, _file.path);
      newHandle = await FSA.renameFile(_file.fileHandle, parentDir, newName);
    } catch (e) {
      alert(`Échec du renommage : ${e.message}`);
      return;
    }

    const slash = _file.path.lastIndexOf('/');
    const folderPrefix = slash >= 0 ? _file.path.slice(0, slash + 1) : '';
    const newFile = { path: folderPrefix + newName, name: newName, fileHandle: newHandle, lastModified: Date.now() };

    try {
      await Index.indexRepository(_repo, { forceFull: true });
    } catch (e) {
      console.error('Échec de la réindexation après renommage', e);
    }
    await open(newFile);
  }

  // --- Sauvegardes (créer / restaurer) ----------------------------------------

  async function createBackupNow() {
    if (!_repo || !_file) return;
    const name = await Backup.create(_repo, _file.name, ta().value);
    alert(name ? `Sauvegarde créée : ${name}` : 'Échec de la sauvegarde.');
  }

  async function openBackupRestore() {
    if (!_repo || !_file) return;
    const backups = await Backup.list(_repo, _file.name);
    const list = el('backup-restore-list');
    list.innerHTML = '';
    el('backup-restore-empty-hint').hidden = backups.length > 0;

    for (const backup of backups) {
      const item = document.createElement('div');
      item.className = 'backup-restore-item';

      const date = document.createElement('span');
      date.className = 'backup-restore-date';
      date.textContent = new Date(backup.lastModified).toLocaleString();
      item.appendChild(date);

      const name = document.createElement('span');
      name.className = 'backup-restore-name';
      name.textContent = backup.name;
      item.appendChild(name);

      // Charge le contenu choisi comme une frappe normale (marque `dirty`,
      // ne sauvegarde pas directement) — l'utilisateur garde la main via
      // "Enregistrer" et les garde-fous existants, même choix qu'Android
      // ("pas un remplacement irréversible en un tap").
      item.addEventListener('click', async () => {
        el('backup-restore-dlg').close();
        const content = await FSA.readFileText(backup.fileHandle);
        replaceAllContent(content);
      });
      list.appendChild(item);
    }
    el('backup-restore-dlg').showModal();
  }

  function init() {
    el('editor-back-btn').addEventListener('click', requestClose);
    el('editor-save-btn').addEventListener('click', save);
    el('editor-preview-btn').addEventListener('click', togglePreview);
    el('editor-backlinks-btn').addEventListener('click', openBacklinks);
    el('editor-toc-btn').addEventListener('click', openToc);

    el('editor-menu-btn').addEventListener('click', toggleEditorMenu);
    el('editor-menu-insert-id').addEventListener('click', runMenuAction(insertId));
    el('editor-menu-insert-link').addEventListener('click', runMenuAction(openLinkPicker));
    el('editor-menu-rename').addEventListener('click', runMenuAction(openRenameDialog));
    el('editor-menu-backup-create').addEventListener('click', runMenuAction(createBackupNow));
    el('editor-menu-backup-restore').addEventListener('click', runMenuAction(openBackupRestore));
    el('editor-menu-settings').addEventListener('click', runMenuAction(() => Settings.open('editor-screen')));

    document.addEventListener('click', e => {
      if (el('editor-menu').hidden) return;
      if (e.target === el('editor-menu-btn') || el('editor-menu').contains(e.target)) return;
      closeEditorMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !el('editor-menu').hidden) closeEditorMenu();
    });

    ta().addEventListener('input', onInput);
    ta().addEventListener('scroll', syncScroll);
    ta().addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
    window.addEventListener('resize', syncGutter);
    el('ed-preview').addEventListener('click', onPreviewClick);

    el('zklink-filter').addEventListener('input', e => renderLinkPicker(e.target.value));
    el('zklink-picker-close').addEventListener('click', () => el('zklink-picker-dlg').close());
    el('backlinks-close').addEventListener('click', () => el('backlinks-dlg').close());
    el('toc-close').addEventListener('click', () => el('toc-dlg').close());

    el('rename-note-cancel').addEventListener('click', () => el('rename-note-dlg').close());
    el('rename-note-confirm').addEventListener('click', confirmRename);
    el('backup-restore-close').addEventListener('click', () => el('backup-restore-dlg').close());

    const respond = val => {
      const resolve = _closeConfirmResolve;
      _closeConfirmResolve = null;
      el('close-confirm-dlg').close();
      if (resolve) resolve(val);
    };
    el('close-confirm-yes').addEventListener('click', () => respond('yes'));
    el('close-confirm-no').addEventListener('click', () => respond('no'));
    el('close-confirm-cancel').addEventListener('click', () => respond('cancel'));
    el('close-confirm-dlg').addEventListener('cancel', e => { e.preventDefault(); respond('cancel'); }); // Esc
  }

  return { init, open };
})();
