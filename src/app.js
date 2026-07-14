'use strict';
// Entry point.
function applyTheme(schemeName = 'default', darkMode = true) {
  const s = getScheme(schemeName);
  const root = document.documentElement.style;
  const pick = (key) => darkMode ? s[key] : s[key + 'Alt'];
  root.setProperty('--bg',      pick('bg'));
  root.setProperty('--fg',      pick('fg'));
  root.setProperty('--bg-bar',  pick('bgBar'));
  root.setProperty('--fg-bar',  pick('fgBar'));
  root.setProperty('--bg-sel',  pick('bgSel'));
  root.setProperty('--heading', pick('heading'));
  root.setProperty('--comment', pick('comment'));
  root.setProperty('--markup',  pick('markup'));
  root.setProperty('--bg2',     pick('bg2'));
}

async function init() {
  applyTheme(); // default palette immediately, no flash while loadState() (IndexedDB) is in flight
  if (!FSA.supported()) {
    document.getElementById('repo-support-hint').textContent =
      'La File System Access API n\'est pas disponible dans ce navigateur — ' +
      'utilisez Chrome, Edge ou Brave pour gérer des dépôts.';
  }
  await Promise.all([loadState(), Themes.loadCustomSchemes()]);
  applyTheme(State.settings.scheme, State.settings.darkMode); // the persisted choice, once known
  Repositories.init();
  Settings.init();
  ThemeEditor.init();
  Browser.init();
  Editor.init();
}

document.addEventListener('DOMContentLoaded', init);
