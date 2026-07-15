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
  let _baselineMtime = null; // mtime last seen/written on disk — see checkExternalChange()
  let _checkingExternal = false; // reentrancy guard (focus + save can race)
  let _autosaveTimer = null; // pending debounced autosave, if any — see scheduleAutosave()

  // Sauvegarde automatique (round 10) — porté d'`EditorViewModel
  // .scheduleAutosave`/`AUTOSAVE_DELAY_MS` : vrai debounce (2s d'inactivité
  // de frappe, pas un intervalle fixe — chaque frappe repousse le
  // déclenchement), appelé à chaque frappe (onInput), et qui appelle
  // exactement le même `save()` que le bouton manuel (donc soumis aux mêmes
  // vérifications de modification externe) — pas de chemin simplifié.
  const AUTOSAVE_DELAY_MS = 2000;

  function scheduleAutosave() {
    if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
    if (!State.settings.autosaveEnabled) return;
    _autosaveTimer = setTimeout(() => { _autosaveTimer = null; save(); }, AUTOSAVE_DELAY_MS);
  }

  function cancelAutosave() {
    if (_autosaveTimer) { clearTimeout(_autosaveTimer); _autosaveTimer = null; }
  }

  // Clé de stockage du curseur — équivalent de NoteCursorStore.kt (offset de
  // caractère par identité de document ; ici `${repositoryId}::${path}` fait
  // office d'identité stable, pas besoin d'un URI).
  function cursorKey(repo, file) {
    return `${repo.id}::${file.path}`;
  }

  // Sauvegarde la position du curseur de la note ACTUELLEMENT affichée avant
  // de la quitter (fermeture, ou changement de note via openOther) — même
  // déclenchement qu'Android (`onDispose`), best-effort.
  async function saveCursorPosition() {
    if (!_repo || !_file) return;
    try {
      await Storage.setCursor(cursorKey(_repo, _file), ta().selectionStart);
    } catch (e) {
      console.error('Échec de la sauvegarde de la position du curseur', e);
    }
  }

  async function open(file) {
    await saveCursorPosition(); // de la note précédente, si l'éditeur était déjà ouvert sur une autre

    let content;
    try {
      content = await FSA.readFileText(file.fileHandle);
    } catch (e) {
      alert(I18n.t('editor.openFailed', { name: file.name, error: e.message }));
      return;
    }

    _repo = activeRepository();
    _file = file;
    _dirty = false;
    _previewMode = false;
    _zkId = detectZkId(file, content);
    try {
      _baselineMtime = (await file.fileHandle.getFile()).lastModified;
    } catch (e) {
      _baselineMtime = file.lastModified;
    }

    el('browser-screen').hidden = true;
    el('editor-screen').hidden = false;
    el('ed-wrap').hidden = false;
    el('ed-preview').hidden = true;
    el('editor-preview-btn').innerHTML = Icons.eye();
    el('editor-preview-btn').title = I18n.t('editor.previewTooltip');

    const input = ta();
    input.value = content;
    rehighlight();
    updateTitle();
    updateBacklinksBadge();
    input.focus();

    // Si le panneau TOC latéral était déjà affiché (note précédente dans la
    // même session éditeur), le rafraîchir pour la note nouvellement
    // ouverte plutôt que de laisser des titres périmés visibles.
    if (!el('toc-panel').hidden) openTocSidebar();

    // Restaure la position du curseur sauvegardée, sinon retombe sur la fin
    // du contenu (comportement historique conservé, même repli qu'Android :
    // "retombe sur la fin du contenu si aucune position connue").
    let offset = content.length;
    if (_repo) {
      try {
        const stored = await Storage.getCursor(cursorKey(_repo, file));
        if (stored !== undefined && stored >= 0 && stored <= content.length) offset = stored;
      } catch (e) {
        console.error('Échec de la lecture de la position du curseur', e);
      }
    }
    input.setSelectionRange(offset, offset);
    const top = pixelTopForOffset(offset);
    input.scrollTop = Math.max(0, top - input.clientHeight / 3);

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
    updateSelectionHighlight();
  }

  // Trouve le (nœud texte, offset local) du pre #ed-highlight correspondant
  // à un offset de caractère dans le texte BRUT (celui de ta().value). Les
  // nœuds texte du pre, parcourus dans l'ordre du document, reconstruisent
  // exactement ce texte brut caractère pour caractère (Highlight.highlight()
  // enveloppe des sous-chaînes dans des <span>, il n'ajoute/ne retire jamais
  // de caractère à l'intérieur d'une ligne — le seul surplus est un '\n'
  // final artificiel après la dernière ligne, hors de portée des offsets de
  // sélection réels puisque toujours <= ta().value.length).
  function domPositionForOffset(offset) {
    const walker = document.createTreeWalker(pre(), NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node, last = null;
    while ((node = walker.nextNode())) {
      last = node;
      const len = node.textContent.length;
      if (remaining <= len) return { node, offset: remaining };
      remaining -= len;
    }
    return last ? { node: last, offset: last.textContent.length } : null;
  }

  // Peint la sélection comme un `Highlight` (CSS Custom Highlight API) sur
  // le texte du pre plutôt que de compter sur `::selection` du vrai
  // textarea — voir le commentaire de `#ed-input::selection` dans
  // style.css pour le pourquoi (alignement + contraste du texte
  // sélectionné). Sur un navigateur sans l'API, ne fait rien : le repli CSS
  // (fond de sélection natif translucide) prend le relais tout seul.
  function updateSelectionHighlight() {
    if (!window.CSS || !CSS.highlights) return;
    const input = ta();
    const { selectionStart: start, selectionEnd: end } = input;
    if (start === end) { CSS.highlights.delete('ed-selection'); return; }
    const from = domPositionForOffset(start);
    const to = domPositionForOffset(end);
    if (!from || !to) { CSS.highlights.delete('ed-selection'); return; }
    const range = new Range();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    // `window.Highlight` explicitement : le module de coloration syntaxique
    // de ce fichier déclare déjà un `const Highlight` de plus haut niveau
    // (voir highlight.js) qui masque, dans ce scope global partagé (pas de
    // modules ES — voir build.py), le constructeur natif `Highlight` de la
    // CSS Custom Highlight API — `new Highlight(...)` résoudrait sur l'objet
    // module (pas une classe) et lèverait "Highlight is not a constructor".
    CSS.highlights.set('ed-selection', new window.Highlight(range));
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
    scheduleAutosave();
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
    cancelAutosave(); // toute sauvegarde (manuelle ou auto) invalide un debounce déjà en vol
    if (!_file || !_dirty) return;
    const outcome = await checkExternalChange();
    if (outcome === 'cancel' || outcome === 'reloaded') return; // 'reloaded' : plus rien de local à enregistrer

    const content = ta().value;
    try {
      const writable = await _file.fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch (e) {
      alert(I18n.t('editor.saveFailed', { error: e.message }));
      return;
    }
    _dirty = false;
    updateTitle();
    try {
      _baselineMtime = (await _file.fileHandle.getFile()).lastModified;
    } catch (e) {
      // best-effort — une divergence ici ne fait qu'un futur faux-positif
    }
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

  // --- Détection de modification externe --------------------------------------
  // Porté d'Android (`EditorState.Loaded.baselineMtime` /
  // `EditorViewModel.checkForExternalChanges`, round 5) : avant, aucune
  // sauvegarde ne vérifiait si le fichier avait changé sur le disque depuis
  // l'ouverture — un autre outil/processus pouvait voir son travail écrasé
  // silencieusement. Sans modification locale non enregistrée, un
  // changement externe est rechargé silencieusement (rien à perdre) ; avec
  // des modifications en cours, un dialogue à trois choix laisse la main à
  // l'utilisateur (Écraser / Recharger / Annuler).

  async function reloadFromDisk(file) {
    const content = await file.text();
    ta().value = content;
    _baselineMtime = file.lastModified;
    _dirty = false;
    updateTitle();
    rehighlight();
    if (_repo) {
      try {
        await Index.indexNote(_repo.id, _file, content);
        updateBacklinksBadge();
      } catch (e) {
        console.error('Échec de la réindexation après rechargement externe', e);
      }
    }
  }

  // Retourne 'unchanged' | 'reloaded' | 'overwrite' | 'cancel'.
  async function checkExternalChange() {
    if (!_file) return 'unchanged';
    let file;
    try {
      file = await _file.fileHandle.getFile();
    } catch (e) {
      return 'unchanged'; // ne bloque jamais sur un échec de lecture du mtime
    }
    if (file.lastModified === _baselineMtime) return 'unchanged';

    if (!_dirty) {
      await reloadFromDisk(file);
      return 'reloaded';
    }
    const choice = await confirmExternalConflict();
    if (choice === 'reload') {
      await reloadFromDisk(file);
      return 'reloaded';
    }
    if (choice === 'overwrite') return 'overwrite';
    return 'cancel';
  }

  let _externalConflictResolve = null;
  function confirmExternalConflict() {
    el('external-conflict-msg').textContent = I18n.t('editor.conflictMsg', { name: _file.name });
    el('external-conflict-dlg').showModal();
    return new Promise(resolve => { _externalConflictResolve = resolve; });
  }

  // Vérifie au retour sur l'onglet/la fenêtre (équivalent de
  // `LifecycleEventEffect(ON_RESUME)` côté Android) — protégé par
  // `_checkingExternal` contre un double déclenchement (focus + save
  // pourraient sinon se chevaucher).
  async function checkExternalChangeOnResume() {
    if (_checkingExternal || !_file || el('editor-screen').hidden) return;
    _checkingExternal = true;
    try {
      await checkExternalChange();
    } finally {
      _checkingExternal = false;
    }
  }

  // Yes/No/Cancel confirmation (Yes = save & close, No = discard & close,
  // Cancel = stay open) via the #close-confirm-dlg <dialog> — a native
  // confirm() only offers two buttons, which would force "Cancel" to mean
  // "discard", with no way to abort closing altogether (same reasoning as
  // writhdeck-web's confirmSaveBeforeClose, ported here in simplified form).
  let _closeConfirmResolve = null;
  function confirmSaveBeforeClose(name) {
    el('close-confirm-msg').textContent = I18n.t('editor.saveConfirmMsg', { name });
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
    await close();
  }

  // Ouvre une autre note depuis l'éditeur (backlink, ZkLink cliqué en
  // aperçu) — remplace la note affichée sans repasser par le navigateur.
  async function openOther(file) {
    if (!(await requestLeave())) return;
    await open(file); // open() sauvegarde lui-même la position du curseur de la note quittée
  }

  async function close() {
    cancelAutosave();
    await saveCursorPosition();
    _repo = null;
    _file = null;
    _zkId = null;
    _dirty = false;
    _previewMode = false;
    _baselineMtime = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete('ed-selection');
    hideTocSidebar();
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
      el('editor-preview-btn').innerHTML = Icons.eyeOff();
      el('editor-preview-btn').title = I18n.t('editor.editTooltip');
    } else {
      el('ed-wrap').hidden = false;
      el('ed-preview').hidden = true;
      el('editor-preview-btn').innerHTML = Icons.eye();
      el('editor-preview-btn').title = I18n.t('editor.previewTooltip');
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
  // Deux présentations possibles (réglage `State.settings.tocSidebarMode`,
  // round 11, sur le modèle de writhdeck-web's `toc.js`) : la fenêtre modale
  // `<dialog>` historique, ou un panneau latéral fixe qui rétrécit
  // réellement la colonne de l'éditeur (jamais une surimpression). Le
  // contenu (liste des titres) est construit une seule fois par
  // `renderTocList`, partagé entre les deux présentations.

  function openToc() {
    if (State.settings.tocSidebarMode) {
      toggleTocSidebar();
      return;
    }
    openTocDialog();
  }

  // Construit les lignes de titres dans `container` ; `onNavigate(entry,
  // index)` est appelé au clic — chaque présentation décide elle-même ce
  // qui doit se passer ensuite (fermer la modale, ou refermer le panneau
  // seulement si non épinglé). Retourne le nombre d'entrées.
  function renderTocList(container, onNavigate) {
    const entries = Txt2TagsToc.build(ta().value);
    container.innerHTML = '';
    entries.forEach((entry, index) => {
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.style.paddingLeft = `${12 + (entry.level - 1) * 16}px`;
      item.textContent = entry.title || I18n.t('editor.tocUntitled');
      item.addEventListener('click', () => onNavigate(entry, index));
      container.appendChild(item);
    });
    return entries.length;
  }

  function openTocDialog() {
    const count = renderTocList(el('toc-list'), (entry, index) => {
      el('toc-dlg').close();
      navigateToToc(entry, index);
    });
    el('toc-empty-hint').hidden = count > 0;
    el('toc-dlg').showModal();
  }

  // --- Panneau TOC latéral -----------------------------------------------
  // Reste ouvert par défaut après un clic sur un titre (persistant tant
  // qu'on ne le referme pas explicitement) — pas de mode "épingle" séparé :
  // retiré à la demande de l'utilisateur ("ne sert à rien, on peut retirer
  // facilement en cliquant sur l'icône"), le bouton "✕"/la ré-bascule de
  // l'icône TOC de la barre d'outils suffisent à le fermer.

  function toggleTocSidebar() {
    if (el('toc-panel').hidden) openTocSidebar();
    else hideTocSidebar();
  }

  function openTocSidebar() {
    const count = renderTocList(el('toc-panel-list'), (entry, index) => {
      navigateToToc(entry, index);
    });
    el('toc-panel-empty-hint').hidden = count > 0;
    el('toc-panel').hidden = false;
  }

  function hideTocSidebar() {
    el('toc-panel').hidden = true;
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

    // Annule un éventuel autosave en attente avant de renommer — sinon il
    // pourrait se déclencher pendant le renommage/reindex et écrire sur un
    // baselineMtime/chemin déjà périmé (même précaution qu'Android
    // `EditorViewModel.renameNote`).
    cancelAutosave();
    if (_dirty) await save();

    let newHandle;
    try {
      const parentDir = await FSA.getParentDirHandle(_repo.dirHandle, _file.path);
      newHandle = await FSA.renameFile(_file.fileHandle, parentDir, newName);
    } catch (e) {
      alert(I18n.t('common.renameFailed', { error: e.message }));
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
    alert(name ? I18n.t('editor.backupCreated', { name }) : I18n.t('editor.backupFailed'));
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
      date.textContent = new Date(backup.lastModified).toLocaleString(I18n.locale());
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

  // Libellés construits avec une icône — pas couverts par le sweep
  // `data-i18n` générique (statique) ; rappelés à l'init et sur
  // l'évènement `i18n:apply` (changement de langue en direct, voir i18n.js).
  function refreshI18nLabels() {
    el('editor-menu-insert-id').innerHTML = `${Icons.hash()} ${I18n.t('editor.insertId')}`;
    el('editor-menu-insert-link').innerHTML = `${Icons.link()} ${I18n.t('editor.insertLink')}`;
    el('editor-menu-rename').innerHTML = `${Icons.edit()} ${I18n.t('common.rename')}`;
    el('editor-menu-backup-create').innerHTML = `${Icons.clock()} ${I18n.t('editor.createBackup')}`;
    el('editor-menu-backup-restore').innerHTML = `${Icons.restore()} ${I18n.t('editor.restoreBackup')}`;
    el('editor-menu-settings').innerHTML = `${Icons.gear()} ${I18n.t('common.settings')}`;
    el('rename-note-confirm').innerHTML = `${Icons.save()} ${I18n.t('common.rename')}`;
    // Le titre de la bascule aperçu/édition dépend du mode courant, pas
    // seulement de la langue — resynchronisé depuis l'état actuel.
    el('editor-preview-btn').title = _previewMode ? I18n.t('editor.editTooltip') : I18n.t('editor.previewTooltip');
  }

  function init() {
    el('editor-toc-btn').innerHTML = Icons.toc();
    el('editor-backlinks-icon').innerHTML = Icons.link();
    el('editor-preview-btn').innerHTML = Icons.eye();
    el('editor-save-btn').innerHTML = Icons.save();
    refreshI18nLabels();
    document.addEventListener('i18n:apply', refreshI18nLabels);

    el('editor-back-btn').addEventListener('click', requestClose);
    el('editor-save-btn').addEventListener('click', save);
    el('editor-preview-btn').addEventListener('click', togglePreview);
    el('editor-backlinks-btn').addEventListener('click', openBacklinks);
    el('editor-toc-btn').addEventListener('click', openToc);
    el('toc-panel-close-btn').addEventListener('click', hideTocSidebar);

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
    // `selectionchange` couvre tous les cas (glisser-déposer, clavier avec
    // Maj, sélectionner tout, ...) en un seul listener — filtré à quand le
    // textarea a le focus pour ne pas répondre aux sélections ailleurs dans
    // l'appli (ex. un champ de recherche).
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === ta()) updateSelectionHighlight();
    });
    ta().addEventListener('blur', () => {
      if (window.CSS && CSS.highlights) CSS.highlights.delete('ed-selection');
    });
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

    const respondExternal = val => {
      const resolve = _externalConflictResolve;
      _externalConflictResolve = null;
      el('external-conflict-dlg').close();
      if (resolve) resolve(val);
    };
    el('external-conflict-overwrite').addEventListener('click', () => respondExternal('overwrite'));
    el('external-conflict-reload').addEventListener('click', () => respondExternal('reload'));
    el('external-conflict-cancel').addEventListener('click', () => respondExternal('cancel'));
    el('external-conflict-dlg').addEventListener('cancel', e => { e.preventDefault(); respondExternal('cancel'); }); // Esc

    // Équivalent web de `LifecycleEventEffect(ON_RESUME)` — pas de notion de
    // "reprise d'app" dans un navigateur, le signal le plus proche est le
    // retour au focus de l'onglet/fenêtre.
    window.addEventListener('focus', checkExternalChangeOnResume);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkExternalChangeOnResume();
    });
  }

  return { init, open };
})();
