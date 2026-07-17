'use strict';
// Global settings screen — reachable from any screen (repository list,
// file browser, note editor — explicit user request), each one remembering
// where to return to on close, same principle as zettelium-android where
// the editor's "⋮" menu got a "Réglages" entry specifically because
// "le menu réglages n'est disponible que sur la page d'accueil" was a
// complaint (round 19) — the editor keeps its state/ViewModel-equivalent
// (`Editor`'s closure variables) alive underneath, no data lost on return.
// Holds the settings that are global to the app (theme, file extensions,
// Zettelkasten ID detection/generation) — per-repository settings
// (extension in links) live in the repo-options dialog instead, wired from
// browser.js.
const Settings = (() => {
  function el(id) { return document.getElementById(id); }

  // Choix de police pour l'éditeur — adapté (pas porté tel quel) de
  // `EditorFonts.kt`/`EDITOR_FONTS` : les valeurs Android sont des alias de
  // familles de polices *Android* (`sans-serif-condensed`, etc.), qui ne
  // veulent rien dire en CSS — remplacés ici par de vraies familles CSS
  // couvrant le même esprit (une poignée de choix monospace/sans-serif/
  // serif, pas un gestionnaire de polices custom).
  const EDITOR_FONTS = [
    { label: 'Monospace', family: 'monospace' },
    { label: 'Monospace (Courier)', family: '"Courier New", monospace' },
    { label: 'Sans-serif', family: 'sans-serif' },
    { label: 'Sans-serif (Helvetica)', family: '"Helvetica Neue", Arial, sans-serif' },
    { label: 'Serif', family: 'serif' },
    { label: 'Cursive', family: 'cursive' },
  ];

  // Mêmes bornes que SettingsScreen.kt (MIN/MAX_FONT_SIZE_SP,
  // MIN/MAX_MARGIN_DP, MIN/MAX_LINE_SPACING, *_STEP) — sp/dp Android
  // deviennent simplement des px ici.
  const MIN_FONT_SIZE = 10, MAX_FONT_SIZE = 32, FONT_SIZE_STEP = 1;
  const MIN_MARGIN = 0, MAX_MARGIN = 200, MARGIN_STEP = 4;
  const MIN_LINE_SPACING = 0.8, MAX_LINE_SPACING = 3.0, LINE_SPACING_STEP = 0.1;

  let _returnScreenId = 'repo-screen';
  let _returnIsStickyWorkspace = false; // voir open()/close() ci-dessous
  let _renderSteppers = () => {}; // reassigned in init(), called from sync()

  // Liste de fichiers épinglée (round 19) : quand `browser-screen` ET
  // `editor-screen` sont visibles côte à côte (`sticky-workspace-active`),
  // les Réglages doivent cacher/réafficher LES DEUX ensemble plutôt qu'un
  // seul `returnScreenId` — sinon `settings-screen` se retrouverait, le
  // temps de l'aller-retour, coincé dans un <body> resté en `display:flex`
  // à côté du panneau non caché, au lieu de prendre tout l'écran. La classe
  // elle-même sert de source de vérité (plutôt que de re-dériver la
  // condition depuis le réglage + l'écran de retour) : elle ne peut être
  // présente que si `editor.js` a réellement mis les deux écrans en scène.
  function open(returnScreenId = 'repo-screen') {
    _returnScreenId = returnScreenId;
    _returnIsStickyWorkspace = document.body.classList.contains('sticky-workspace-active');
    if (_returnIsStickyWorkspace) {
      document.body.classList.remove('sticky-workspace-active');
      el('browser-screen').hidden = true;
      el('editor-screen').hidden = true;
    } else {
      el(returnScreenId).hidden = true;
    }
    el('settings-screen').hidden = false;
    sync();
  }

  function close() {
    el('settings-screen').hidden = true;
    if (_returnIsStickyWorkspace) {
      el('browser-screen').hidden = false;
      el('editor-screen').hidden = false;
      document.body.classList.add('sticky-workspace-active');
    } else {
      el(_returnScreenId).hidden = false;
    }
  }

  function populateEditorFontOptions() {
    const select = el('settings-editor-font');
    select.innerHTML = '';
    for (const font of EDITOR_FONTS) {
      const option = document.createElement('option');
      option.value = font.family;
      option.textContent = font.label;
      select.appendChild(option);
    }
  }

  function populateSchemeOptions() {
    const select = el('settings-scheme');
    select.innerHTML = '';
    for (const name of getAllSchemeNames()) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      select.appendChild(option);
    }
  }

  // Rangée d'aperçu sombre + rangée d'aperçu clair du thème actif — porté de
  // `SchemePreviewSwatch`/la disposition `SettingsScreen.kt` (6 pastilles par
  // rangée : fond/texte/sélection/titre/commentaire/balisage).
  function renderSchemePreview() {
    const scheme = getScheme(State.settings.scheme);
    const darkRow = el('settings-scheme-preview-dark');
    const lightRow = el('settings-scheme-preview-light');
    darkRow.innerHTML = '';
    lightRow.innerHTML = '';
    for (const key of ['bg', 'fg', 'bgSel', 'heading', 'comment', 'markup']) {
      const dark = document.createElement('span');
      dark.className = 'scheme-swatch';
      dark.style.background = scheme[key];
      darkRow.appendChild(dark);

      const light = document.createElement('span');
      light.className = 'scheme-swatch';
      light.style.background = scheme[key + 'Alt'];
      lightRow.appendChild(light);
    }
  }

  function sync() {
    syncRadioGroup('settings-theme-mode', State.settings.themeMode);
    populateSchemeOptions();
    el('settings-scheme').value = State.settings.scheme;
    renderSchemePreview();

    populateEditorFontOptions();
    el('settings-editor-font').value = State.settings.editorFontFamily;
    _renderSteppers();
    el('settings-autosave').checked = State.settings.autosaveEnabled;
    el('settings-toc-sidebar').checked = State.settings.tocSidebarMode;
    el('settings-file-list-sidebar').checked = State.settings.fileListSidebarMode;
    el('settings-heading-sizes').checked = State.settings.headingSizesEnabled;

    syncRadioGroup('settings-language', State.settings.language);

    el('settings-extensions-input').value = State.settings.noteExtensions;
    el('settings-extensions-all').checked = State.settings.noteExtensionsFilterDisabled;
    el('settings-extensions-input').disabled = State.settings.noteExtensionsFilterDisabled;
    el('settings-id-pattern').value = State.settings.idPattern;
    el('settings-id-format').value = State.settings.idGenerationFormat;
    updateIdPreview();
  }

  // Aperçu en direct : l'ID que produirait le format de génération actuel,
  // et s'il est reconnu par le motif de détection actuel — les deux
  // réglages sont indépendants (une regex n'est pas inversible en général,
  // voir zettelkasten.js), cet aperçu aide à les garder cohérents sans les
  // déduire automatiquement l'un de l'autre (même aide visuelle qu'Android).
  function updateIdPreview() {
    const generated = ZettelkastenLinks.generateId(new Date(), State.settings.idGenerationFormat);
    const regex = ZettelkastenLinks.compileIdRegex(State.settings.idPattern);
    const recognised = regex.test(generated);
    el('settings-id-preview').textContent = I18n.t(
      recognised ? 'settings.idPreviewMatch' : 'settings.idPreviewMismatch', { id: generated });
  }

  function roundTo(value, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
  }

  // Groupe de boutons radio générique (mode de thème, langue) — porté du
  // `RadioButton`/`ThemeMode.entries.forEach` d'Android.
  function syncRadioGroup(containerId, value) {
    for (const input of document.querySelectorAll(`#${containerId} input[type=radio]`)) {
      input.checked = input.value === value;
    }
  }
  function wireRadioGroup(containerId, onSelect) {
    for (const input of document.querySelectorAll(`#${containerId} input[type=radio]`)) {
      input.addEventListener('change', () => { if (input.checked) onSelect(input.value); });
    }
  }

  // -/+ stepper (font size, margins, line spacing) — one wiring function
  // covers all four, same shape as Android's Remove/Add IconButton pairs
  // (`IntStepperRow`/`FloatStepperRow`). The middle value is a real
  // `<input type="number">` (not a plain span) so an exact value can be
  // typed directly, not just nudged — explicit request: "il faut pouvoir
  // entrer une valeur". Applied on blur/Enter, not on every keystroke (an
  // incomplete number being typed shouldn't get clamped mid-entry).
  // Returns a `render()` to call from sync()/after any external change.
  function wireStepper(idPrefix, get, set, min, max, step, decimals = 0) {
    const dec = el(`${idPrefix}-dec`);
    const inc = el(`${idPrefix}-inc`);
    const valueEl = el(`${idPrefix}-value`);

    function render() {
      const value = get();
      valueEl.value = decimals ? value.toFixed(decimals) : String(value);
      dec.disabled = value <= min;
      inc.disabled = value >= max;
    }
    dec.addEventListener('click', async () => {
      await set(Math.max(min, roundTo(get() - step, decimals)));
      render();
    });
    inc.addEventListener('click', async () => {
      await set(Math.min(max, roundTo(get() + step, decimals)));
      render();
    });
    async function commit() {
      const parsed = parseFloat(String(valueEl.value).replace(',', '.'));
      if (!Number.isNaN(parsed)) {
        await set(Math.min(max, Math.max(min, roundTo(parsed, decimals))));
      }
      render(); // resync the field — also reverts an invalid/out-of-range entry
    }
    valueEl.addEventListener('change', commit); // fires on blur, and on Enter in most browsers
    valueEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); valueEl.blur(); } });
    return render;
  }

  function init() {
    el('repo-settings-btn').innerHTML = Icons.gear();
    el('repo-settings-btn').addEventListener('click', () => open('repo-screen'));
    el('settings-back-btn').addEventListener('click', close);
    // `updateIdPreview()` construit un texte dynamique (I18n.t) — pas
    // couvert par le sweep `data-i18n` générique, statique.
    document.addEventListener('i18n:apply', () => { if (!el('settings-screen').hidden) updateIdPreview(); });

    el('settings-editor-font').addEventListener('change', e => setEditorFontFamily(e.target.value));
    const renderFontSize = wireStepper('settings-font-size',
      () => State.settings.editorFontSize, setEditorFontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, FONT_SIZE_STEP);
    const renderMarginX = wireStepper('settings-margin-x',
      () => State.settings.editorMarginX, setEditorMarginX, MIN_MARGIN, MAX_MARGIN, MARGIN_STEP);
    const renderMarginY = wireStepper('settings-margin-y',
      () => State.settings.editorMarginY, setEditorMarginY, MIN_MARGIN, MAX_MARGIN, MARGIN_STEP);
    const renderLineSpacing = wireStepper('settings-line-spacing',
      () => State.settings.editorLineSpacing, setEditorLineSpacing, MIN_LINE_SPACING, MAX_LINE_SPACING, LINE_SPACING_STEP, 1);
    _renderSteppers = () => { renderFontSize(); renderMarginX(); renderMarginY(); renderLineSpacing(); };
    el('settings-autosave').addEventListener('change', e => setAutosaveEnabled(e.target.checked));
    el('settings-toc-sidebar').addEventListener('change', e => setTocSidebarMode(e.target.checked));
    el('settings-file-list-sidebar').addEventListener('change', e => setFileListSidebarMode(e.target.checked));
    el('settings-heading-sizes').addEventListener('change', e => setHeadingSizesEnabled(e.target.checked));

    el('settings-scheme').addEventListener('change', async e => {
      await setScheme(e.target.value);
      renderSchemePreview();
    });
    wireRadioGroup('settings-theme-mode', value => setThemeMode(value));
    el('settings-edit-theme-btn').addEventListener('click', () => ThemeEditor.openList(sync));
    wireRadioGroup('settings-language', value => setLanguage(value));

    el('settings-extensions-input').addEventListener('change', e => setNoteExtensions(e.target.value));
    el('settings-extensions-all').addEventListener('change', async e => {
      await setNoteExtensionsFilterDisabled(e.target.checked);
      sync();
    });
    el('settings-id-pattern').addEventListener('input', async e => {
      await setIdPattern(e.target.value);
      updateIdPreview();
    });
    el('settings-id-format').addEventListener('input', async e => {
      await setIdGenerationFormat(e.target.value);
      updateIdPreview();
    });
  }

  return { init, open };
})();
