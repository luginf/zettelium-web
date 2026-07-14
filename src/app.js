'use strict';
// Entry point.

// Résout le mode de thème tri-état ('system'|'light'|'dark', round 9 —
// remplace l'ancien booléen `darkMode`, unifié avec l'énum `ThemeMode`
// d'Android) en un simple booléen sombre/clair. 'system' suit
// `prefers-color-scheme`, réévalué en direct si l'utilisateur change le
// thème de son OS pendant que l'app est ouverte (voir le listener dans
// init() ci-dessous) — pas d'équivalent Android exact ici (Android relit sa
// propre config système à chaque recomposition), mais le même résultat :
// le thème suit le système sans redémarrer l'app.
function resolveDarkMode(themeMode) {
  if (themeMode === 'light') return false;
  if (themeMode === 'dark') return true;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyTheme(schemeName = 'default', themeMode = 'system') {
  const s = getScheme(schemeName);
  const darkMode = resolveDarkMode(themeMode);
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

// Éditeur : police/taille, marges, interligne — réglages globaux (phase 6,
// "sur le modèle de zettelium-android") appliqués via les mêmes variables
// CSS déjà utilisées par style.css (--ed-*), jusqu'ici figées à des valeurs
// par défaut fixes.
function applyEditorTypography() {
  const root = document.documentElement.style;
  const s = State.settings;
  root.setProperty('--ed-font-family', s.editorFontFamily);
  root.setProperty('--ed-font-size', s.editorFontSize + 'px');
  root.setProperty('--ed-margin-x', s.editorMarginX + 'px');
  root.setProperty('--ed-margin-y', s.editorMarginY + 'px');
  root.setProperty('--ed-line-spacing', String(s.editorLineSpacing));
}

async function init() {
  applyTheme(); // default palette immediately, no flash while loadState() (IndexedDB) is in flight
  if (!FSA.supported()) {
    document.getElementById('repo-support-hint').textContent = I18n.t('repo.fsaUnsupportedHint');
  }
  await Promise.all([loadState(), Themes.loadCustomSchemes()]);
  applyTheme(State.settings.scheme, State.settings.themeMode); // the persisted choice, once known
  applyEditorTypography();
  I18n.apply();
  Repositories.init();
  Settings.init();
  ThemeEditor.init();
  Browser.init();
  Editor.init();

  // Réévalue le thème si l'OS change de mode clair/sombre pendant que l'app
  // est ouverte — seulement pertinent en mode 'system' (voir resolveDarkMode).
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (State.settings.themeMode === 'system') applyTheme(State.settings.scheme, State.settings.themeMode);
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
