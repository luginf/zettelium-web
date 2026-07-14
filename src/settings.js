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

  let _returnScreenId = 'repo-screen';

  function open(returnScreenId = 'repo-screen') {
    _returnScreenId = returnScreenId;
    el(returnScreenId).hidden = true;
    el('settings-screen').hidden = false;
    sync();
  }

  function close() {
    el('settings-screen').hidden = true;
    el(_returnScreenId).hidden = false;
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
    populateSchemeOptions();
    el('settings-scheme').value = State.settings.scheme;
    el('settings-dark-mode').checked = State.settings.darkMode;
    renderSchemePreview();

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
    el('settings-id-preview').textContent = recognised
      ? `Exemple d'ID généré : ${generated} (reconnu par le motif de détection)`
      : `Exemple d'ID généré : ${generated} (⚠ NON reconnu par le motif de détection actuel)`;
  }

  function init() {
    el('repo-settings-btn').addEventListener('click', () => open('repo-screen'));
    el('browser-settings-btn').addEventListener('click', () => open('browser-screen'));
    el('settings-back-btn').addEventListener('click', close);

    el('settings-scheme').addEventListener('change', async e => {
      await setScheme(e.target.value);
      renderSchemePreview();
    });
    el('settings-dark-mode').addEventListener('change', e => setDarkMode(e.target.checked));
    el('settings-edit-theme-btn').addEventListener('click', () => ThemeEditor.openList(sync));

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
