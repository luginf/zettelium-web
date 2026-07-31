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
  // Mode sans distraction (round 24) — variable de session pure, comme
  // `_previewMode`/`_tocPinned` (retiré au round 12) : jamais persistée,
  // retombe à false à chaque fermeture de note (voir close()).
  let _distractionFree = false;
  let _baselineMtime = null; // mtime last seen/written on disk — see checkExternalChange()
  let _checkingExternal = false; // reentrancy guard (focus + save can race)
  let _autosaveTimer = null; // pending debounced autosave, if any — see scheduleAutosave()

  // Point de départ d'un glisser-sélection réel (mousedown -> mousemove ->
  // mouseup), round 27 — voir le listener 'mousedown'/'mousemove' plus bas
  // et le commentaire de `correctedOffsetAt` : round 20bis n'avait corrigé
  // que le clic simple, laissant explicitement le glisser à la résolution
  // native (même cause racine, jamais traitée pour ce cas précis).
  //
  // Round 29 (retour utilisateur : décalage croissant avec un texte long) —
  // `_dragAnchorOffset` (pas `_dragAnchorClientX/Y`) : un OFFSET DE TEXTE
  // résolu immédiatement au `mousedown`, pas des coordonnées écran
  // mémorisées pour être réinterprétées plus tard au `mouseup`. Nécessaire
  // parce qu'un glisser assez long pour approcher le bord de la zone
  // visible déclenche l'auto-scroll natif du textarea PENDANT le glisser —
  // si on avait stocké de simples coordonnées client (comme avant ce
  // round), les réinterpréter à la fin (après que le contenu a défilé
  // sous ce point fixe de l'écran) désignerait un tout autre texte que
  // celui qui s'y trouvait au moment du clic. Résoudre l'ancre tout de
  // suite (avant tout défilement) élimine le problème à la racine ; seul le
  // point de RELÂCHEMENT (`mouseup`) a besoin d'être résolu "en direct",
  // puisqu'il reflète déjà l'état actuel (post-défilement) du contenu.
  let _dragAnchorOffset = null;
  let _didDragSelect = false;

  // Liste de fichiers épinglée masquée par l'utilisateur (round 32, "x" tout
  // à droite de la liste — même principe que `#toc-panel-close-btn`) —
  // variable de session pure, comme `_tocPinned` (retiré round 12) : jamais
  // persistée, ne modifie PAS `State.settings.fileListSidebarMode` lui-même
  // (qui reste actif), juste "cachée pour l'instant". `open()` la respecte
  // en changeant de note (ne réaffiche pas la liste tant qu'elle est
  // masquée), `close()` la réinitialise (rouvrir la liste quand plus aucune
  // note n'est affichée, pour ne pas coincer l'utilisateur sans aucun moyen
  // de choisir une autre note).
  let _fileListSidebarHiddenByUser = false;

  // Throttle de l'aperçu visuel du glisser (round 31) — voir le listener
  // 'mousemove' plus bas.
  let _lastDragPreviewTime = 0;

  // Recherche dans le texte en cours d'édition (Ctrl+F / menu ⋮) — voir la
  // section "Find in note" plus bas.
  let _searchTerm = '';
  let _matches    = [];
  let _matchIdx   = -1;

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

  async function open(file, options = {}) {
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

    // Liste de fichiers épinglée (round 19) : ne cache pas le navigateur,
    // et une fois entré dans ce mode, `sticky-workspace-active` reste posée
    // même après fermeture de la note (voir `close()`) — seule la sortie du
    // dépôt (`Repositories.showList()`) ou l'ouverture des réglages
    // (`Settings.open`) la retire.
    const sticky = State.settings.fileListSidebarMode;
    document.body.classList.toggle('sticky-workspace-active', sticky);
    // Round 32 : si l'utilisateur a masqué la liste via le "x" pendant
    // cette session, elle reste masquée en changeant de note — même
    // principe que le panneau TOC, qui ne se rouvre jamais tout seul non
    // plus une fois fermé explicitement.
    el('browser-screen').hidden = sticky ? _fileListSidebarHiddenByUser : true;
    el('editor-screen').hidden = false;
    el('editor-note-view').hidden = false;
    el('editor-empty-state').hidden = true;
    el('ed-wrap').hidden = false;
    el('ed-preview').hidden = true;
    el('editor-preview-btn').innerHTML = Icons.eye();
    el('editor-preview-btn').title = I18n.t('editor.previewTooltip');

    // Recherche de la note précédente (le cas échéant) : fermée sans
    // animation avant de charger le nouveau texte — ses `_matches` sont des
    // offsets dans l'ancien contenu, invalides ici. Rouverte plus bas si
    // `options.searchTerm` est fourni (clic sur un résultat de recherche de
    // contenu depuis le navigateur).
    el('ed-search-bar').hidden = true;
    _searchTerm = ''; _matches = []; _matchIdx = -1;
    el('ed-search-count').textContent = '';

    const input = ta();
    input.value = content;
    // Remet le pre au même défilement (0) que le textarea, tout juste
    // réinitialisé par l'assignation de `.value` ci-dessus — sinon `pre()`
    // peut garder le `scrollTop` de la note PRÉCÉDENTE un court instant, ce
    // qui fausserait `pixelTopForOffset` (mesuré sur le rendu réel de
    // l'overlay, voir plus bas) juste après.
    syncScroll();
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
    // Synchronise `pre()` immédiatement plutôt que d'attendre l'évènement
    // 'scroll' (asynchrone) — sinon une mesure faite juste après (ex. le
    // clic corrigé, `correctedOffsetAt`) verrait encore l'ancien défilement.
    syncScroll();

    // Recherche de contenu depuis le navigateur (browser.js) : on saute
    // directement à la première occurrence du terme cherché, en écrasant le
    // positionnement du curseur ci-dessus (l'intention explicite ici, c'est
    // de retrouver ce passage-là, pas de reprendre où on s'était arrêté).
    if (options.searchTerm) searchOpenWithTerm(options.searchTerm);

    // Rattrape un renommage fait hors de l'app depuis la dernière fois
    // (round 5 Android, "garantie de résistance au renommage") — best-effort,
    // ne bloque jamais l'ouverture si ça échoue.
    if (_repo && _zkId) {
      const target = ZettelkastenLinks.linkTarget(file.name, _repo.includeExtensionInLinks, noteExtensionsList());
      Index.repairBacklinksFor(_repo.id, _zkId, target, file.path).catch(e =>
        console.error('Échec de la réparation des liens à l\'ouverture', e));
    }

    // Rafraîchit le surlignage de la note active dans le panneau épinglé
    // (`Browser.render()` redessine la liste, `renderFileRow` compare
    // `Editor.currentPath()` à chaque ligne) — inutile hors mode épinglé.
    if (sticky) Browser.render();
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
    const searchVisible = !el('ed-search-bar').hidden;
    pre().innerHTML = Highlight.highlight(ta().value, searchVisible ? _searchTerm : '');
    syncGutter();
    updateSelectionHighlight();
    updateCaretIndicator();
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
    return domPositionWithin(pre(), offset);
  }

  // Comme ci-dessus, mais cherche seulement dans `root` (un sous-arbre du
  // pre, ex. le `<span class="hl-line">` d'une seule ligne) — utilisé pour
  // localiser le caret DANS sa ligne (voir `lineElementForOffset` plus bas).
  function domPositionWithin(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

  // Localise le `<span class="hl-line">` correspondant à un offset de
  // caractère global, plus l'offset LOCAL à l'intérieur de cette ligne —
  // en comptant les '\n' comme `Highlight.highlight()` (une ligne par
  // `\n`, y compris vide). Nécessaire pour le caret sur une ligne VIDE :
  // `Highlight.highlight()` rend une ligne vide comme `<span
  // class="hl-line"></span>` SANS aucun nœud texte à l'intérieur — la
  // position s'y trouvant n'existe qu'au travers du '\n' séparateur
  // partagé avec la ligne précédente, une position AMBIGÜE pour un `Range`
  // collé dessus (juste avant vs juste après le retour à la ligne, deux
  // rendus visuels différents) que certains navigateurs résolvent en un
  // rect vide — d'où le caret qui disparaissait sur une ligne vide.
  // Localiser la LIGNE d'abord élimine l'ambiguïté : chaque `.hl-line` a
  // sa propre géométrie (`min-height: 1lh` en CSS), même vide.
  function lineElementForOffset(offset) {
    const text = ta().value;
    let lineStart = 0;
    let lineIndex = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === '\n') { lineStart = i + 1; lineIndex++; }
    }
    const lines = pre().querySelectorAll(':scope > span.hl-line');
    const span = lines[lineIndex];
    return span ? { span, localOffset: offset - lineStart } : null;
  }

  // Range (ou, à défaut, l'élément lui-même) collé sur le texte réel d'UNE
  // ligne, jamais sur le '\n' séparateur ambigu entre deux lignes — utilisé
  // par `updateCaretIndicator`. Renvoie soit un `Range` collé sur un vrai
  // nœud texte, soit directement le `<span class="hl-line">` pour une
  // ligne VIDE (aucun nœud texte à l'intérieur) : **vérifié empiriquement**
  // qu'un `Range` construit via `selectNodeContents(élément); collapse()`
  // renvoie un rect systématiquement VIDE dans Chromium (`getClientRects()`
  // longueur 0 ET `getBoundingClientRect()` tout à zéro) dès que le
  // conteneur est un ÉLÉMENT sans nœud texte — y compris pour une ligne
  // NON vide, d'où l'usage de `domPositionWithin` même pour un
  // `localOffset` de 0. `Element.getClientRects()`/
  // `getBoundingClientRect()` existent aussi et ont la même signature que
  // `Range` : l'appelant peut traiter les deux valeurs de retour de façon
  // uniforme sans distinguer leur type.
  function lineRangeForOffset(offset) {
    const lineInfo = lineElementForOffset(offset);
    if (!lineInfo) return null;
    const pos = domPositionWithin(lineInfo.span, lineInfo.localOffset);
    if (!pos) return lineInfo.span; // ligne vide — géométrie de l'élément lui-même (son bord gauche = début de ligne)
    const range = new Range();
    range.setStart(pos.node, pos.offset);
    range.collapse(true);
    return range;
  }

  // Inverse de `domPositionForOffset` : (nœud texte, offset local) du pre -> offset dans le texte brut.
  function offsetForDomPosition(node, nodeOffset) {
    const walker = document.createTreeWalker(pre(), NodeFilter.SHOW_TEXT);
    let total = 0;
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return total + nodeOffset;
      total += n.textContent.length;
    }
    return total;
  }

  // Inverse de `lineElementForOffset` : offset GLOBAL de texte brut du
  // DÉBUT d'un `<span class="hl-line">` donné (round 30) — compte les '\n'
  // de `ta().value` jusqu'à atteindre l'index de cette ligne parmi ses
  // sœurs, même logique de comptage que `lineElementForOffset` mais dans
  // l'autre sens (élément -> offset plutôt qu'offset -> élément).
  function globalOffsetOfLineStart(lineSpan) {
    const lines = pre().querySelectorAll(':scope > span.hl-line');
    let lineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === lineSpan) { lineIndex = i; break; }
    }
    if (lineIndex < 0) return null;
    const text = ta().value;
    let offset = 0, currentLine = 0;
    for (let i = 0; i < text.length && currentLine < lineIndex; i++) {
      if (text[i] === '\n') { currentLine++; offset = i + 1; }
    }
    return currentLine === lineIndex ? offset : text.length;
  }

  // Un clic natif sur le vrai textarea résout sa position selon SES PROPRES
  // métriques UNIFORMES (une seule taille de police pour toutes les lignes)
  // — alors que l'overlay, lui, agrandit les lignes de titre
  // (`.hl-h1`..`.hl-h4`), donc pousse tout ce qui suit plus bas. Sur une
  // note avec plusieurs titres, ce décalage s'accumule au point qu'un clic
  // visuellement posé sur une ligne donnée de l'overlay peut atterrir,
  // selon la résolution native (uniforme) du textarea, sur une AUTRE ligne
  // — retrouvé par mesure directe (headless + clic réel simulé) : avec 15
  // titres, cliquer sur la dernière ligne visible plaçait le curseur en
  // toute fin de note. Corrigé en retrouvant la VRAIE position cliquée
  // dans le rendu de l'overlay via `caretRangeFromPoint` — qui fait son
  // propre hit-test (comme `elementFromPoint`) et ignore normalement le
  // pre (`pointer-events: none`, purement décoratif) au profit du textarea
  // par-dessus (`z-index:1`) : bascule temporaire des deux (le pre devient
  // hit-testable, le textarea non) pendant la seule durée de la mesure,
  // restaurée aussitôt (synchrone, aucun effet visible) — vérifié par
  // mesure directe que `caretRangeFromPoint` retrouve alors bien le texte
  // réel du pre plutôt qu'une position vide dans `#ed-wrap`.
  //
  // Round 30 (retour utilisateur : sélection encore décalée sur un texte
  // long, "toujours décalé du même espace qu'auparavant" malgré le round
  // 29) — root-causé par une reproduction CDP (mousedown/mousemove/mouseup
  // réels + auto-scroll natif du navigateur pendant un glisser maintenu
  // près du bord, comparé à un calcul de référence indépendant) : ce
  // n'était PAS un problème d'auto-scroll/timing (round 29 avait bien
  // corrigé ce point-là) mais un cas que `caretRangeFromPoint` renvoie
  // TRÈS souvent — pas un cas rare — un point tombant sur une LIGNE VIDE
  // (fréquentes entre deux paragraphes, voir capture d'écran de
  // l'utilisateur) renvoie un `Range` dont `startContainer` est le `<span
  // class="hl-line">` lui-même (pas de nœud texte à l'intérieur, rien à
  // sélectionner) — l'ancien garde-fou `startContainer.nodeType !==
  // Node.TEXT_NODE` rejetait ce cas en renvoyant `null`, laissant tomber la
  // correction ENTIÈREMENT et retombant sur la résolution native buguée en
  // silence. Un glisser assez long pour déclencher l'auto-scroll traverse
  // presque toujours au moins une ligne vide (paragraphes séparés par des
  // lignes blanches), ce qui explique le côté systématique du décalage.
  // Traité maintenant comme un cas normal (pas une erreur) : la seule
  // position possible sur une ligne vide est son propre début.
  function correctedOffsetAt(clientX, clientY) {
    if (!document.caretRangeFromPoint) return null;
    const input = ta();
    const overlay = pre();
    input.style.pointerEvents = 'none';
    overlay.style.pointerEvents = 'auto';
    let range;
    try {
      range = document.caretRangeFromPoint(clientX, clientY);
    } finally {
      input.style.pointerEvents = '';
      overlay.style.pointerEvents = '';
    }
    if (!range || !overlay.contains(range.startContainer)) return null;
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      return offsetForDomPosition(range.startContainer, range.startOffset);
    }
    const lineSpan = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer.closest('span.hl-line') : null;
    return lineSpan ? globalOffsetOfLineStart(lineSpan) : null;
  }

  // Peint la sélection comme un `Highlight` (CSS Custom Highlight API) sur
  // le texte du pre plutôt que de compter sur `::selection` du vrai
  // textarea — voir le commentaire de `#ed-input::selection` dans
  // style.css pour le pourquoi (alignement + contraste du texte
  // sélectionné). Sur un navigateur sans l'API, ne fait rien : le repli CSS
  // (fond de sélection natif translucide) prend le relais tout seul.
  //
  // `overrideStart`/`overrideEnd` (round 31) : par défaut, lit la vraie
  // sélection native (`ta().selectionStart/End`) — mais pendant un glisser
  // (voir le listener 'mousemove'), le natif reste temporairement décalé
  // jusqu'au `mouseup` (round 20bis n'a jamais eu vocation à corriger la
  // sélection native ELLE-MÊME, seulement ce qui est affiché) ; passer un
  // intervalle explicite permet de peindre un APERÇU corrigé sans toucher
  // à `ta().selectionStart/End`, laissée à son propre suivi natif jusqu'à
  // ce que le `mouseup` la remplace pour de bon.
  function updateSelectionHighlight(overrideStart, overrideEnd) {
    if (!window.CSS || !CSS.highlights) return;
    const input = ta();
    const start = overrideStart !== undefined ? overrideStart : input.selectionStart;
    const end = overrideEnd !== undefined ? overrideEnd : input.selectionEnd;
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

  // Faux caret peint sur l'overlay, à la place du vrai caret natif du
  // textarea (`caret-color`, voir style.css) — même cause racine que le
  // décalage de sélection déjà corrigé au round 13 : le vrai textarea ne
  // peut avoir qu'une seule taille de police uniforme, donc son caret
  // natif se positionne selon des métriques de ligne qui divergent de
  // l'overlay dès qu'un titre plus haut dans le texte (agrandi via
  // `.hl-h1`..`.hl-h4`) précède la ligne courante. Mesuré ici directement
  // sur le texte RÉEL du pre (même `Range`/`domPositionForOffset` que la
  // sélection ci-dessus), donc toujours aligné avec ce qui est
  // visuellement affiché, quel que soit le nombre de titres traversés.
  // Seulement quand il n'y a PAS de sélection active (start === end) — une
  // sélection non vide est déjà rendue par `updateSelectionHighlight`.
  let _lastCaretOffset = null; // évite de forcer un reflow (redémarrage du clignotement) quand seul le défilement a changé, pas la position — voir plus bas

  function updateCaretIndicator() {
    const indicator = el('ed-caret');
    const input = ta();
    if (document.activeElement !== input || input.selectionStart !== input.selectionEnd) {
      indicator.hidden = true;
      _lastCaretOffset = null;
      return;
    }
    const offset = input.selectionStart;
    let rect = null;
    if (input.value.length === 0) {
      // Note vide : aucune ligne à mesurer dans le pre — repli sur le
      // coin haut-gauche de la zone de texte (aucun titre au-dessus pour
      // décaler quoi que ce soit dans ce cas précis).
      const wrapRect = el('ed-wrap').getBoundingClientRect();
      const style = getComputedStyle(input);
      rect = {
        left: wrapRect.left + parseFloat(style.paddingLeft || '0'),
        top: wrapRect.top + parseFloat(style.paddingTop || '0'),
        height: parseFloat(style.lineHeight) || input.clientHeight
      };
    } else {
      // `lineRangeForOffset` (pas domPositionForOffset+Range directement) :
      // localise d'abord la LIGNE puis, si elle est vide (ou curseur en
      // tout début de ligne), utilise la géométrie du `<span
      // class="hl-line">` lui-même plutôt qu'une position ambiguë sur le
      // '\n' séparateur — sinon le caret disparaissait sur une ligne vide.
      const range = lineRangeForOffset(offset);
      if (range) rect = range.getClientRects()[0] || range.getBoundingClientRect();
    }
    if (!rect || (!rect.width && !rect.height)) {
      indicator.hidden = true;
      _lastCaretOffset = null;
      return;
    }
    const wrapRect = el('ed-wrap').getBoundingClientRect();
    indicator.hidden = false;
    indicator.style.left = (rect.left - wrapRect.left) + 'px';
    indicator.style.top = (rect.top - wrapRect.top) + 'px';
    indicator.style.height = rect.height + 'px';
    // Redémarre le cycle de clignotement (reste plein pendant qu'on tape/
    // déplace le curseur, comme un vrai caret natif) SEULEMENT quand la
    // position a réellement changé — cette fonction est aussi appelée à
    // chaque évènement 'scroll' (`syncScroll`), potentiellement très
    // fréquent pendant un défilement ; le forçage de reflow
    // (`void indicator.offsetHeight`) nécessaire pour relancer l'animation
    // n'a de sens que sur un vrai déplacement, pas à chaque pixel défilé —
    // sinon coût perceptible ("tout est moins réactif", retour utilisateur
    // round 20bis) pour un simple repositionnement visuel.
    if (offset !== _lastCaretOffset) {
      indicator.style.animation = 'none';
      void indicator.offsetHeight;
      indicator.style.animation = '';
      _lastCaretOffset = offset;
    }
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
    updateCaretIndicator();
  }

  function onInput() {
    rehighlight();
    markDirty();
    scheduleAutosave();
  }

  // Continuation automatique du marqueur de liste à l'Entrée (round 32
  // Android) — `inputType === 'insertLineBreak'` est l'équivalent web du
  // `TextWatcher.onTextChanged`'s `before == 0 && count == 1` : ne se
  // déclenche que pour une frappe Entrée ISOLÉE dans le textarea, jamais un
  // collage multi-lignes (`insertFromPaste`) ni une insertion programmatique
  // (`insertText`, dont celle-ci elle-même via `applyFormattingResult` juste
  // en dessous — la réentrance qui en résulte retombe sur ce même chemin
  // `onInput`, mais `inputType` n'est alors plus 'insertLineBreak', donc pas
  // de boucle).
  function onEditorInput(e) {
    onInput();
    if (e && e.inputType === 'insertLineBreak') handleListContinuation();
  }

  function handleListContinuation() {
    const input = ta();
    const result = EditorFormatting.continueListOnNewline(input.value, input.selectionStart);
    if (result) applyFormattingResult(result);
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
    if (!(await requestLeave())) return false;
    await close();
    return true;
  }

  // Ouvre une autre note en remplaçant celle affichée, avec le garde-fou
  // "enregistrer avant de quitter" — depuis l'éditeur lui-même (backlink,
  // ZkLink cliqué en aperçu) mais aussi, depuis le round 19 (liste de
  // fichiers épinglée), depuis le navigateur : cliquer une autre note ou en
  // créer une nouvelle pendant qu'une note dirty est déjà ouverte dans le
  // panneau doit demander confirmation, pas écraser silencieusement — un
  // cas qui ne pouvait pas se produire avant ce panneau (les deux écrans
  // étaient mutuellement exclusifs, jamais cliquables en même temps).
  async function openOther(file, options) {
    if (!(await requestLeave())) return;
    await open(file, options); // open() sauvegarde lui-même la position du curseur de la note quittée
  }

  async function close() {
    if (!_file) return; // rien d'ouvert — no-op sûr (ex. Editor.requestClose() appelé sans note active)
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
    _distractionFree = false;
    applyDistractionFree();
    // Liste de fichiers épinglée (round 19) : le panneau reste étroit et
    // `editor-screen` reste visible — seul son CONTENU bascule vers
    // l'état vide, contrairement au mode normal qui referme l'écran entier
    // (demande explicite : fermer une note ne doit pas réagrandir le
    // navigateur tant qu'on ne quitte pas le dépôt).
    if (document.body.classList.contains('sticky-workspace-active')) {
      el('editor-note-view').hidden = true;
      el('editor-empty-state').hidden = false;
      // Round 32 : si la liste était masquée par l'utilisateur (le "x"),
      // la réafficher maintenant — plus aucune note n'est ouverte, la
      // laisser masquée coincerait l'utilisateur sans aucun moyen d'en
      // choisir une autre.
      _fileListSidebarHiddenByUser = false;
      el('browser-screen').hidden = false;
      Browser.render(); // efface le surlignage de la note qui vient de fermer
    } else {
      el('editor-screen').hidden = true;
      el('browser-screen').hidden = false;
    }
    Browser.rescan();
  }

  // Recalcule et réécrit l'aperçu depuis le texte courant du textarea —
  // factorisé pour être rappelé après une bascule de case à cocher
  // (`toggleChecklistItem`) sans repasser par `togglePreview` (qui bascule
  // aussi le mode édition/aperçu, non souhaité ici).
  function renderPreview() {
    const ast = Txt2TagsParser.parse(ta().value);
    const resolveZkLink = _repo ? (zkId => Index.findByZkId(_repo.id, zkId)) : undefined;
    const checklistIndices = Txt2TagsChecklist.assignIndices(ast);
    el('ed-preview').innerHTML = Txt2TagsRender.renderAstToHtml(ast, { resolveZkLink, checklistIndices });
  }

  function togglePreview() {
    _previewMode = !_previewMode;
    if (_previewMode) {
      if (!el('ed-search-bar').hidden) searchClose(); // opère sur #ed-input, caché en aperçu
      renderPreview();
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

  // Mode sans distraction (round 24, demande explicite) — masque uniquement
  // #ed-header (le bandeau : titre, TOC, backlinks, aperçu, enregistrer,
  // menu ⋮), laisse le reste (recherche en note, panneau TOC latéral)
  // inchangé — ce sont des outils explicitement invoqués par l'utilisateur,
  // pas du chrome permanent au sens de la demande. Une fois le bandeau
  // masqué, le bouton "⋮" qui héberge cette même action disparaît avec lui
  // — deux façons d'en sortir : le bouton flottant #ed-distraction-exit-btn
  // (toujours visible, discret) et Échap (voir le listener keydown global).
  function applyDistractionFree() {
    el('editor-note-view').classList.toggle('distraction-free', _distractionFree);
    el('ed-distraction-exit-btn').hidden = !_distractionFree;
    // Recalcule --ed-margin-x/y : `applyEditorTypography()` (app.js) lit
    // `_distractionFree` via `isDistractionFree()` pour appliquer (ou
    // retirer) le facteur de grossissement round 25 — point d'entrée
    // unique, pas de logique de marge dupliquée ici.
    applyEditorTypography();
  }

  function isDistractionFree() {
    return _distractionFree;
  }

  function toggleDistractionFree() {
    _distractionFree = !_distractionFree;
    applyDistractionFree();
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

  // Bascule d'une case à cocher tapée dans l'aperçu (round 32 Android) —
  // traitée comme une frappe normale (`replaceAllContent`, undo-safe) : le
  // texte SOURCE est la vérité, le glyphe visuel natif de <input
  // type="checkbox"> est de toute façon écrasé par le prochain
  // `renderPreview()` juste après. `change` (pas `click`) : fire une seule
  // fois par bascule utilisateur, après la mise à jour de `checked`.
  function onPreviewChange(e) {
    const cb = e.target.closest('input.t2t-checkbox[data-checkbox-index]');
    if (!cb) return;
    const idx = parseInt(cb.dataset.checkboxIndex, 10);
    if (Number.isNaN(idx)) return;
    const newContent = Txt2TagsChecklist.toggle(ta().value, idx);
    if (newContent === null) return;
    replaceAllContent(newContent);
    renderPreview();
  }

  // --- Menu contextuel (clic droit) de formatage --------------------------
  // Porté d'Android (EditorScreen.kt : ActionMode.Callback du long appui +
  // EditorFormatting.kt) — même liste, même ordre : "Suivre le lien" en
  // tête SEULEMENT si le curseur/la sélection chevauche un lien
  // [[cible|zkId]] (round 19 Android, "en haut" - demande explicite),
  // Titre 1/2/3, Gras, Italique, Souligné, Barré, Commentaire, Date.
  // Remplace le menu contextuel natif du navigateur (`preventDefault` sur
  // `contextmenu`) — clic droit seulement, pas d'équivalent tactile testé
  // ici (souris uniquement, comme le reste de cette version web).

  let _ctxLink = null; // lien [[cible|zkId]] sous le curseur/la sélection à l'ouverture du menu, s'il y en a un

  function openContextMenu(x, y) {
    const input = ta();
    _ctxLink = ZettelkastenLinks.linkAt(input.value, input.selectionStart, input.selectionEnd);
    el('ed-ctx-follow-link').hidden = !_ctxLink;
    // "Évaluer" — visible seulement si la sélection courante n'est pas vide
    // (round 30 Android : évaluer une sélection vide n'a pas de sens,
    // contrairement aux autres actions de ce menu qui basculent la ligne ou
    // insèrent au curseur sans sélection).
    el('ed-ctx-eval').hidden = input.selectionStart === input.selectionEnd;

    const menu = el('ed-context-menu');
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.hidden = false;
    // Repositionné après un premier affichage non contraint (pour connaître
    // sa vraie taille) — évite de déborder hors de la fenêtre si le clic
    // droit a lieu près d'un bord.
    const rect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 4;
    const maxTop = window.innerHeight - rect.height - 4;
    menu.style.left = Math.max(0, Math.min(x, maxLeft)) + 'px';
    menu.style.top = Math.max(0, Math.min(y, maxTop)) + 'px';
  }

  function closeContextMenu() {
    el('ed-context-menu').hidden = true;
  }

  function runContextMenuAction(fn) {
    return () => { closeContextMenu(); fn(); };
  }

  // Remplace `text.slice(rangeStart, rangeEnd)` par `replacement` via
  // `execCommand` (préserve l'historique annuler/rétablir natif du textarea
  // — réassigner `.value` en entier l'efface, round 2 : "Ctrl+Z n'annulait
  // pas l'insertion d'un ID") puis place le curseur sur les positions
  // ABSOLUES déjà calculées par `EditorFormatting` (dans le texte final,
  // pas dans la sélection de remplacement).
  function applyFormattingResult(r) {
    const input = ta();
    input.focus();
    input.setSelectionRange(r.rangeStart, r.rangeEnd);
    const usedNativeInsert = !!(document.execCommand && document.execCommand('insertText', false, r.replacement));
    if (!usedNativeInsert) {
      const value = input.value;
      input.value = value.slice(0, r.rangeStart) + r.replacement + value.slice(r.rangeEnd);
      onInput(); // le chemin execCommand déclenche déjà notre écouteur 'input' nativement
    }
    input.setSelectionRange(r.cursorStart, r.cursorEnd);
  }

  function formatHeading(level) {
    const input = ta();
    applyFormattingResult(EditorFormatting.toggleHeading(input.value, input.selectionStart, input.selectionEnd, level));
  }

  function formatWrap(marker) {
    const input = ta();
    applyFormattingResult(EditorFormatting.wrapInline(input.value, input.selectionStart, input.selectionEnd, marker));
  }

  function formatComment() {
    const input = ta();
    applyFormattingResult(EditorFormatting.toggleLinePrefix(input.value, input.selectionStart, input.selectionEnd, '% '));
  }

  // "Liste"/"Case à cocher" (round 32 Android) — réutilisent tels quels
  // toggleLinePrefix (déjà utilisé pour "Commentaire"), aucune nouvelle
  // fonction de formatage nécessaire.
  function formatList() {
    const input = ta();
    applyFormattingResult(EditorFormatting.toggleLinePrefix(input.value, input.selectionStart, input.selectionEnd, '- '));
  }

  function formatChecklist() {
    const input = ta();
    applyFormattingResult(EditorFormatting.toggleLinePrefix(input.value, input.selectionStart, input.selectionEnd, '- [ ] '));
  }

  function formatIndentList() {
    const input = ta();
    applyFormattingResult(EditorFormatting.indentListLines(input.value, input.selectionStart, input.selectionEnd));
  }

  function formatDedentList() {
    const input = ta();
    applyFormattingResult(EditorFormatting.dedentListLines(input.value, input.selectionStart, input.selectionEnd));
  }

  function insertDate() {
    insertAtCursor(new Date().toISOString().slice(0, 10));
  }

  // "Évaluer" (round 30/31/33 Android) : remplace la sélection par
  // "<expression> <résultat>" (mise en forme différenciée par notation, voir
  // MathExprEval.formatResult) via execCommand('insertText', ...) — même
  // technique que les autres actions de ce menu (préserve l'historique
  // annuler/rétablir natif). Échec : alerte avec le message d'erreur, le
  // texte de l'éditeur reste inchangé (pas de modification silencieuse ou
  // partielle).
  function evalSelection() {
    const input = ta();
    const start = input.selectionStart, end = input.selectionEnd;
    if (start === end) return;
    const expression = input.value.slice(start, end);
    const result = MathExprEval.evaluate(expression);
    if (!result.ok) {
      alert(I18n.t('editor.ctxEvalFailed', { error: result.message }));
      return;
    }
    const replacement = MathExprEval.formatResult(expression, result);
    input.focus();
    input.setSelectionRange(start, end);
    const usedNativeInsert = !!(document.execCommand && document.execCommand('insertText', false, replacement));
    if (!usedNativeInsert) {
      const value = input.value;
      input.value = value.slice(0, start) + replacement + value.slice(end);
      onInput();
    }
    input.setSelectionRange(start + replacement.length, start + replacement.length);
  }

  // Même garde-fou "enregistrer avant de quitter" que le clic sur un ZkLink
  // résolu dans l'aperçu (`onPreviewClick`) — `openOther` s'en charge déjà.
  function followContextLink() {
    if (!_ctxLink || !_repo) return;
    const entry = Index.findByZkId(_repo.id, _ctxLink.zkId);
    if (!entry) {
      alert(I18n.t('editor.ctxLinkNotFound', { zkId: _ctxLink.zkId }));
      return;
    }
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

  // Insertion d'ID/lien/recherche masquées en mode aperçu (rien à éditer/
  // chercher dans le textarea, qui est caché) — même condition qu'Android
  // pour insert-id/insert-link (`if (!previewMode) { ... }` dans le
  // DropdownMenu) ; recherche alignée dessus par cohérence, pas d'équivalent
  // Android à porter (pas de recherche en note côté Android non plus).
  function updateEditorMenuVisibility() {
    el('editor-menu-search').hidden = _previewMode;
    el('editor-menu-insert-id').hidden = _previewMode;
    el('editor-menu-insert-link').hidden = _previewMode;
    el('editor-menu-goto-id').hidden = _previewMode;
  }

  function runMenuAction(fn) {
    return () => { closeEditorMenu(); fn(); };
  }

  // Localise l'ID Zettelkasten de la note DANS LE CORPS du texte (placer le
  // curseur + défiler dessus, même technique que `navigateToToc` —
  // `pixelTopForOffset`) — demande explicite : "et si l'id n'existe pas,
  // indique qu'il n'y en a pas". Même précédence que `detectZkId`/
  // `ZettelkastenLinks.extractId` partout ailleurs dans l'app : le nom de
  // fichier gagne outright, donc rien à localiser dans le texte dans ce cas.
  function goToId() {
    const idRegex = ZettelkastenLinks.compileIdRegex(State.settings.idPattern);
    if (idRegex.exec(_file.name)) {
      alert(I18n.t('editor.goToIdNotInBody'));
      return;
    }
    const occurrence = ZettelkastenLinks.findBodyIdOccurrence(ta().value, idRegex);
    if (!occurrence) {
      alert(I18n.t('editor.goToIdNone'));
      return;
    }
    const input = ta();
    input.focus();
    input.setSelectionRange(occurrence.start, occurrence.end);
    const top = pixelTopForOffset(occurrence.start);
    input.scrollTop = Math.max(0, top - input.clientHeight / 3);
    syncScroll();
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

  // Masque la liste de fichiers épinglée (round 32, "x" tout à droite de la
  // liste — bouton câblé côté browser.js, `#browser-sidebar-close-btn`,
  // visible seulement en mode épinglé) — voir le commentaire de
  // `_fileListSidebarHiddenByUser` plus haut : ne modifie jamais le réglage
  // `fileListSidebarMode` lui-même, juste "cachée pour l'instant".
  function hideFileListSidebar() {
    _fileListSidebarHiddenByUser = true;
    el('browser-screen').hidden = true;
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
    syncScroll();
  }

  // Mesure la position "top" (dans le même repère que `scrollTop` : la
  // distance depuis le début du contenu, indépendante du défilement
  // courant) du caractère à `offset`, pour calculer un nouveau `scrollTop`
  // qui l'amène en vue. **Round "curseur décalé"** : mesurait auparavant
  // sur un div miroir recevant les métriques UNIFORMES du textarea (même
  // technique que `linePixelTop()` de writhdeck-web) — donc, comme le clic
  // et le caret, ne tenait pas compte des lignes de titre agrandies
  // (`.hl-h1`..`.hl-h4`) de l'overlay, avec le même risque de scroller vers
  // une position qui laisse la cible réelle hors de la zone visible sur
  // une note à plusieurs titres. Mesure maintenant directement sur le
  // texte RÉEL du pre via un `Range` (même technique que le caret/la
  // sélection) : `rect.top - wrapRect.top` donne la position ACTUELLEMENT
  // affichée (dépend du défilement en cours), on y rajoute `ta().scrollTop`
  // pour revenir à la position absolue indépendante du défilement.
  //
  // Round 28 (retour utilisateur : TOC toujours décalée, parfois besoin de
  // scroller pour voir le curseur) : cette fonction construisait encore un
  // `Range` collé directement via `domPositionForOffset` + `.collapse(true)`
  // — exactement la technique dont le round 20ter avait pourtant démontré
  // qu'elle renvoie un rect systématiquement VIDE (`getClientRects()`
  // longueur 0 ET `getBoundingClientRect()` tout à zéro dans Chromium) à
  // certaines positions de frontière, en particulier en tout DÉBUT de ligne
  // — exactement la position d'une entrée de TOC (`entry.charOffset` pointe
  // le premier caractère du titre). Un rect à zéro donnait alors
  // `ta().scrollTop + (0 - wrapRect.top)`, une valeur sans rapport avec la
  // cible réelle (souvent négative, ramenée à 0 par le `Math.max` de
  // l'appelant — d'où le défilement vers le HAUT du document au lieu du
  // titre visé). Le round 20ter n'avait corrigé que `updateCaretIndicator`
  // (nouvelle fonction `lineRangeForOffset`), jamais cette fonction-ci,
  // pourtant touchée par exactement le même piège. Remplacé par
  // `lineRangeForOffset` (même technique, déjà robuste à cette position) —
  // le curseur RESTAIT correctement placé même avant ce correctif (`entry
  // .charOffset` passé tel quel à `setSelectionRange`, jamais concerné),
  // seul le calcul du DÉFILEMENT vers lui était faux.
  function pixelTopForOffset(offset) {
    const range = lineRangeForOffset(offset);
    if (!range) return 0;
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return 0;
    const wrapRect = el('ed-wrap').getBoundingClientRect();
    return ta().scrollTop + (rect.top - wrapRect.top);
  }

  // --- Recherche dans la note (Ctrl+F / menu ⋮) -------------------------------
  // Porte le mécanisme de writhdeck-web/src/editor.js (searchOpen/Update/Next/
  // Prev/selectMatch) : pas de remplacement (non demandé ici, "pour retrouver
  // des passages"), juste trouver/naviguer. Réutilise `pixelTopForOffset` pour
  // le défilement (même technique de mirror-div que le TOC ci-dessus).

  function searchOpen() {
    const bar = el('ed-search-bar');
    if (!bar.hidden) { searchClose(); return; } // Ctrl+F alors que la barre est déjà ouverte -> la ferme
    bar.hidden = false;
    const input = el('ed-search-input');
    if (_searchTerm) input.value = _searchTerm;
    input.focus();
    input.select();
    searchUpdate();
  }

  // Ouvre la recherche déjà pré-remplie et saute directement à la première
  // occurrence — utilisé quand on clique un résultat de recherche de CONTENU
  // depuis le navigateur (browser.js) : la note s'ouvre avec le mot cherché
  // déjà sélectionné, au lieu de laisser l'utilisateur le retrouver à la
  // main. Ne vole pas le focus du textarea (déjà donné par open()) — l'accent
  // reste sur "voir le passage trouvé", pas sur retaper une recherche.
  function searchOpenWithTerm(term) {
    el('ed-search-bar').hidden = false;
    el('ed-search-input').value = term;
    searchUpdate();
  }

  function searchClose() {
    el('ed-search-bar').hidden = true;
    ta().focus();
    _matches = []; _matchIdx = -1;
    el('ed-search-count').textContent = '';
    rehighlight(); // retire les surlignages (barre cachée -> searchTerm ignoré)
  }

  function searchUpdate() {
    _searchTerm = el('ed-search-input').value;
    _matches = [];
    _matchIdx = -1;
    if (!_searchTerm) {
      el('ed-search-count').textContent = '';
      rehighlight();
      return;
    }
    const text  = ta().value;
    const lower = text.toLowerCase();
    const term  = _searchTerm.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(term, pos)) !== -1) {
      _matches.push(pos);
      pos += term.length;
    }
    el('ed-search-count').textContent = I18n.t('editor.searchMatchCount', { count: _matches.length });
    if (_matches.length) searchNext();
    rehighlight(); // applique les surlignages
  }

  function searchNext() {
    if (!_matches.length) return;
    _matchIdx = (_matchIdx + 1) % _matches.length;
    selectSearchMatch(_matches[_matchIdx]);
  }

  function searchPrev() {
    if (!_matches.length) return;
    _matchIdx = (_matchIdx - 1 + _matches.length) % _matches.length;
    selectSearchMatch(_matches[_matchIdx]);
  }

  function selectSearchMatch(pos) {
    const input = ta();
    // Ne pas appeler input.focus() : cela volerait le focus depuis le champ
    // de recherche pendant la frappe (même raisonnement que writhdeck-web).
    input.setSelectionRange(pos, pos + _searchTerm.length);
    const top = pixelTopForOffset(pos);
    input.scrollTop = Math.max(0, top - input.clientHeight / 3);
    syncScroll();
    // Appelé explicitement (pas seulement via le listener 'selectionchange'
    // filtré sur `document.activeElement === ta()`) : le focus peut être sur
    // #ed-search-input pendant qu'on navigue les résultats, la sélection du
    // match courant doit quand même se peindre dans l'overlay.
    updateSelectionHighlight();
    updateCaretIndicator();
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
    await rekeyFavorite(_repo.id, _file.path, _repo.id, newFile.path);

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
    el('editor-menu-distraction-free').innerHTML = `${Icons.maximize()} ${I18n.t('editor.distractionFree')}`;
    el('editor-menu-search').innerHTML = `${Icons.search()} ${I18n.t('editor.search')}`;
    el('editor-menu-insert-id').innerHTML = `${Icons.hash()} ${I18n.t('editor.insertId')}`;
    el('editor-menu-insert-link').innerHTML = `${Icons.link()} ${I18n.t('editor.insertLink')}`;
    el('editor-menu-goto-id').innerHTML = `${Icons.crosshair()} ${I18n.t('editor.goToId')}`;
    el('editor-menu-rename').innerHTML = `${Icons.edit()} ${I18n.t('common.rename')}`;
    el('editor-menu-backup-create').innerHTML = `${Icons.clock()} ${I18n.t('editor.createBackup')}`;
    el('editor-menu-backup-restore').innerHTML = `${Icons.restore()} ${I18n.t('editor.restoreBackup')}`;
    el('editor-menu-settings').innerHTML = `${Icons.gear()} ${I18n.t('common.settings')}`;
    el('rename-note-confirm').innerHTML = `${Icons.save()} ${I18n.t('common.rename')}`;
    el('ed-ctx-follow-link').innerHTML = `${Icons.link()} ${I18n.t('editor.ctxFollowLink')}`;
    el('ed-ctx-h1').innerHTML = `<span class="ctx-glyph">H1</span> ${I18n.t('editor.ctxH1')}`;
    el('ed-ctx-h2').innerHTML = `<span class="ctx-glyph">H2</span> ${I18n.t('editor.ctxH2')}`;
    el('ed-ctx-h3').innerHTML = `<span class="ctx-glyph">H3</span> ${I18n.t('editor.ctxH3')}`;
    el('ed-ctx-bold').innerHTML = `<span class="ctx-glyph" style="font-weight:bold">B</span> ${I18n.t('editor.ctxBold')}`;
    el('ed-ctx-italic').innerHTML = `<span class="ctx-glyph" style="font-style:italic">I</span> ${I18n.t('editor.ctxItalic')}`;
    el('ed-ctx-underline').innerHTML = `<span class="ctx-glyph" style="text-decoration:underline">U</span> ${I18n.t('editor.ctxUnderline')}`;
    el('ed-ctx-strike').innerHTML = `<span class="ctx-glyph" style="text-decoration:line-through">S</span> ${I18n.t('editor.ctxStrike')}`;
    el('ed-ctx-comment').innerHTML = `<span class="ctx-glyph">%</span> ${I18n.t('editor.ctxComment')}`;
    el('ed-ctx-list').innerHTML = `${Icons.list()} ${I18n.t('editor.ctxList')}`;
    el('ed-ctx-checkbox').innerHTML = `${Icons.checkSquare()} ${I18n.t('editor.ctxCheckbox')}`;
    el('ed-ctx-indent').innerHTML = `<span class="ctx-glyph">→</span> ${I18n.t('editor.ctxIndent')}`;
    el('ed-ctx-dedent').innerHTML = `<span class="ctx-glyph">←</span> ${I18n.t('editor.ctxDedent')}`;
    el('ed-ctx-date').innerHTML = `${Icons.clock()} ${I18n.t('editor.ctxDate')}`;
    el('ed-ctx-eval').innerHTML = `<span class="ctx-glyph">=</span> ${I18n.t('editor.ctxEval')}`;
    // Le titre de la bascule aperçu/édition dépend du mode courant, pas
    // seulement de la langue — resynchronisé depuis l'état actuel.
    el('editor-preview-btn').title = _previewMode ? I18n.t('editor.editTooltip') : I18n.t('editor.previewTooltip');
  }

  function init() {
    el('editor-toc-btn').innerHTML = Icons.toc();
    el('editor-backlinks-icon').innerHTML = Icons.link();
    el('editor-preview-btn').innerHTML = Icons.eye();
    el('editor-save-btn').innerHTML = Icons.save();
    el('ed-distraction-exit-btn').innerHTML = Icons.minimize();
    refreshI18nLabels();
    document.addEventListener('i18n:apply', refreshI18nLabels);

    el('editor-back-btn').addEventListener('click', requestClose);
    el('editor-save-btn').addEventListener('click', save);
    el('editor-preview-btn').addEventListener('click', togglePreview);
    el('editor-backlinks-btn').addEventListener('click', openBacklinks);
    el('editor-toc-btn').addEventListener('click', openToc);
    el('toc-panel-close-btn').addEventListener('click', hideTocSidebar);
    el('ed-distraction-exit-btn').addEventListener('click', toggleDistractionFree);

    el('editor-menu-btn').addEventListener('click', toggleEditorMenu);
    el('editor-menu-distraction-free').addEventListener('click', runMenuAction(toggleDistractionFree));
    el('editor-menu-search').addEventListener('click', runMenuAction(searchOpen));
    el('editor-menu-insert-id').addEventListener('click', runMenuAction(insertId));
    el('editor-menu-insert-link').addEventListener('click', runMenuAction(openLinkPicker));
    el('editor-menu-goto-id').addEventListener('click', runMenuAction(goToId));
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
      // Ferme la recherche sur Échap même si le focus est ailleurs (textarea,
      // p. ex.) — quand le focus est dans #ed-search-input, son propre
      // listener ci-dessous a déjà refermé la barre avant que cet écouteur
      // (posé sur document, donc après en ordre de bulle) ne s'exécute.
      else if (e.key === 'Escape' && !el('ed-search-bar').hidden) searchClose();
      // Seul autre moyen de sortir du mode sans distraction que le bouton
      // flottant, une fois le bandeau (et son bouton "⋮") masqué.
      else if (e.key === 'Escape' && _distractionFree) toggleDistractionFree();
    });

    ta().addEventListener('input', onEditorInput);
    ta().addEventListener('scroll', syncScroll);
    ta().addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchOpen();
      }
    });
    window.addEventListener('resize', syncGutter);

    el('ed-search-input').addEventListener('input', searchUpdate);
    el('ed-search-prev').addEventListener('click', searchPrev);
    el('ed-search-next').addEventListener('click', searchNext);
    el('ed-search-close').addEventListener('click', searchClose);
    el('ed-search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.shiftKey) searchPrev();
      else if (e.key === 'Enter')          searchNext();
      else if (e.key === 'Escape')         searchClose();
    });
    // `selectionchange` couvre tous les cas (glisser-déposer, clavier avec
    // Maj, sélectionner tout, ...) en un seul listener — filtré à quand le
    // textarea a le focus pour ne pas répondre aux sélections ailleurs dans
    // l'appli (ex. un champ de recherche).
    document.addEventListener('selectionchange', () => {
      if (document.activeElement !== ta()) return;
      // Round 31 : pendant un glisser actif, l'aperçu corrigé est déjà
      // repeint par le listener 'mousemove' (`updateSelectionHighlight(lo,
      // hi)`) — ce listener-ci réagit au suivi NATIF (non corrigé) de la
      // sélection en cours ; le laisser repeindre aussi ferait clignoter
      // entre l'aperçu corrigé et la valeur native décalée entre deux
      // `mousemove`.
      if (!(_dragAnchorOffset !== null && _didDragSelect)) updateSelectionHighlight();
      updateCaretIndicator();
    });
    ta().addEventListener('blur', () => {
      if (window.CSS && CSS.highlights) CSS.highlights.delete('ed-selection');
      el('ed-caret').hidden = true;
    });
    el('ed-preview').addEventListener('click', onPreviewClick);
    el('ed-preview').addEventListener('change', onPreviewChange);

    // Résout et mémorise l'ANCRE du glisser en offset de texte DÈS le
    // mousedown (round 29 — voir le commentaire de `_dragAnchorOffset` plus
    // haut : pas de coordonnées écran gardées pour plus tard, un glisser
    // assez long pour déclencher l'auto-scroll natif du textarea les
    // rendrait fausses au moment du mouseup). `_didDragSelect` distingue le
    // glisser d'un simple clic/double-clic/triple-clic (qui ne bougent pas
    // la souris entre down et up) : ces derniers restent volontairement
    // laissés à la résolution native (sélection par mot/ligne entière,
    // round 20bis) pour ne pas casser leur alignement sur les frontières de
    // mot.
    ta().addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _dragAnchorOffset = correctedOffsetAt(e.clientX, e.clientY);
      _didDragSelect = false;
      _lastDragPreviewTime = 0;
    });
    // Round 31 (retour utilisateur : "la sélection finale est correcte,
    // mais pendant qu'on sélectionne c'est toujours décalé — juste
    // visuel") : round 27-30 ne corrigeaient la sélection RÉELLE
    // (`ta().selectionStart/End`) qu'au relâchement — pendant le glisser
    // lui-même, la sélection native (non corrigée) continue son propre
    // suivi, et c'est CE surlignage décalé que l'utilisateur voyait
    // pendant le geste, avant qu'il ne "saute" à la bonne position au
    // relâchement. Repeint maintenant un APERÇU corrigé à chaque
    // déplacement, via `updateSelectionHighlight(lo, hi)` — SANS toucher à
    // `ta().selectionStart/End` elle-même (laissée à son suivi natif
    // jusqu'au `mouseup`, qui la remplace pour de bon comme avant) : lui
    // écrire directement ici risquerait d'interférer avec le suivi natif
    // du glisser en cours (ancre interne du navigateur, distincte de la
    // nôtre). Throttlé (~60fps, `performance.now()`) — `correctedOffsetAt`
    // fait un hit-test DOM complet, coûteux à répéter à chaque `mousemove`
    // (peut être très fréquent pendant un glisser).
    ta().addEventListener('mousemove', e => {
      if (_dragAnchorOffset === null || !(e.buttons & 1)) return;
      _didDragSelect = true;
      const now = performance.now();
      if (now - _lastDragPreviewTime < 16) return;
      _lastDragPreviewTime = now;
      const focusOffset = correctedOffsetAt(e.clientX, e.clientY);
      if (focusOffset === null) return;
      updateSelectionHighlight(Math.min(_dragAnchorOffset, focusOffset), Math.max(_dragAnchorOffset, focusOffset));
    });

    // Corrige la position du curseur après un simple clic ET après un
    // glisser-sélection réel — round 20bis n'avait corrigé que le premier
    // cas, laissant explicitement le second à la résolution native (voir
    // `correctedOffsetAt`) : un glisser sur une note à plusieurs titres
    // atterrit alors sur du texte plus bas que ce qui a été visuellement
    // sélectionné, la MÊME cause racine (métriques uniformes du textarea vs.
    // titres agrandis de l'overlay) que le clic simple, jamais traitée pour
    // ce cas précis avant le round 27 (round 29 en corrige la variante à
    // longue distance, voir `_dragAnchorOffset`). Seul le point de
    // RELÂCHEMENT (`e.clientX/Y`) est résolu ICI, en direct — il reflète
    // déjà l'état actuel (post-défilement éventuel) du contenu.
    ta().addEventListener('mouseup', e => {
      if (e.button !== 0) return;
      if (ta().selectionStart === ta().selectionEnd) {
        const corrected = correctedOffsetAt(e.clientX, e.clientY);
        if (corrected !== null && corrected !== ta().selectionStart) {
          ta().setSelectionRange(corrected, corrected);
          updateCaretIndicator();
        }
      } else if (_didDragSelect && _dragAnchorOffset !== null) {
        const focusOffset = correctedOffsetAt(e.clientX, e.clientY);
        if (focusOffset !== null) {
          const lo = Math.min(_dragAnchorOffset, focusOffset);
          const hi = Math.max(_dragAnchorOffset, focusOffset);
          ta().setSelectionRange(lo, hi, _dragAnchorOffset <= focusOffset ? 'forward' : 'backward');
          updateSelectionHighlight();
          updateCaretIndicator();
        }
      }
      _dragAnchorOffset = null;
      _didDragSelect = false;
    });

    ta().addEventListener('contextmenu', e => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY);
    });
    el('ed-ctx-follow-link').addEventListener('click', runContextMenuAction(followContextLink));
    el('ed-ctx-h1').addEventListener('click', runContextMenuAction(() => formatHeading(1)));
    el('ed-ctx-h2').addEventListener('click', runContextMenuAction(() => formatHeading(2)));
    el('ed-ctx-h3').addEventListener('click', runContextMenuAction(() => formatHeading(3)));
    el('ed-ctx-bold').addEventListener('click', runContextMenuAction(() => formatWrap('**')));
    el('ed-ctx-italic').addEventListener('click', runContextMenuAction(() => formatWrap('//')));
    el('ed-ctx-underline').addEventListener('click', runContextMenuAction(() => formatWrap('__')));
    el('ed-ctx-strike').addEventListener('click', runContextMenuAction(() => formatWrap('--')));
    el('ed-ctx-comment').addEventListener('click', runContextMenuAction(formatComment));
    el('ed-ctx-list').addEventListener('click', runContextMenuAction(formatList));
    el('ed-ctx-checkbox').addEventListener('click', runContextMenuAction(formatChecklist));
    el('ed-ctx-indent').addEventListener('click', runContextMenuAction(formatIndentList));
    el('ed-ctx-dedent').addEventListener('click', runContextMenuAction(formatDedentList));
    el('ed-ctx-date').addEventListener('click', runContextMenuAction(insertDate));
    el('ed-ctx-eval').addEventListener('click', runContextMenuAction(evalSelection));
    document.addEventListener('click', e => {
      if (el('ed-context-menu').hidden) return;
      if (el('ed-context-menu').contains(e.target)) return;
      closeContextMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !el('ed-context-menu').hidden) closeContextMenu();
    });

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

  // `requestClose`/`currentPath` exposés pour browser.js : quitter un dépôt
  // depuis le panneau épinglé doit respecter le même garde-fou "enregistrer
  // avant de quitter" que partout ailleurs (round 19), et chaque ligne de la
  // liste doit pouvoir savoir si elle correspond à la note actuellement
  // ouverte pour se surligner.
  function currentPath() {
    return _file ? _file.path : null;
  }

  return { init, open, openOther, requestClose, currentPath, isDistractionFree, hideFileListSidebar };
})();
