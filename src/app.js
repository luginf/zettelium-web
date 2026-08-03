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

// #rrggbb -> "r, g, b" (pour composer une couleur translucide via rgba() en
// CSS, voir --bg-sel-translucent ci-dessous).
function hexToRgbTriplet(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
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
  root.setProperty('--bg-sel-rgb', hexToRgbTriplet(pick('bgSel')));
  root.setProperty('--heading', pick('heading'));
  root.setProperty('--comment', pick('comment'));
  root.setProperty('--markup',  pick('markup'));
  root.setProperty('--bg2',     pick('bg2'));
}

// Éditeur : police/taille, marges, interligne — réglages globaux (phase 6,
// "sur le modèle de zettelium-android") appliqués via les mêmes variables
// CSS déjà utilisées par style.css (--ed-*), jusqu'ici figées à des valeurs
// par défaut fixes.
// Le facteur de grossissement des marges (round 25) ne s'applique QUE
// pendant que le mode sans distraction est actif (`Editor.isDistractionFree()`)
// — en dehors de ce mode, `editorMarginX`/`editorMarginY` s'appliquent tels
// quels, comportement historique inchangé. Point d'entrée UNIQUE pour les
// marges (Réglages, toggle du mode sans distraction) : pas de logique de
// grossissement dupliquée ailleurs.
// Round 33 (retour utilisateur : marges du mode sans distraction visibles
// seulement en haut/à gauche) — cause réelle, retrouvée par mesure directe
// (headless + CDP) : `#ed-input`/`#ed-highlight` sont en `position:
// absolute; inset:0; width:100%; height:100%` avec `box-sizing: border-box`
// (reset global). Si le padding multiplié (marge × facteur, des DEUX
// côtés) dépasse la largeur/hauteur RÉELLEMENT disponible de `#ed-main`
// (facile à atteindre avec la liste de fichiers épinglée round 19, qui
// rétrécit beaucoup l'éditeur, ou simplement une fenêtre pas très large),
// `border-box` ne peut pas faire rétrécir le padding en dessous de 0 — au
// lieu de ça, la boîte elle-même s'agrandit au-delà de `width:100%`/
// `height:100%` pour faire de la place. Comme `left`/`top` restent fixés à
// 0 (`inset:0`), ce débordement ne peut se produire QUE vers la droite/le
// bas — d'où l'illusion que seules les marges haut/gauche "fonctionnent" :
// la marge droite/basse existe bien dans le CSS, mais elle est poussée
// hors de la zone visible (voire hors de la fenêtre), jamais visible ni
// atteignable en défilant. Corrigé en plafonnant chaque marge à 40 % de la
// dimension actuelle de `#ed-main` (garantit au moins 20 % de largeur/
// hauteur réservés au texte lui-même, quel que soit le facteur choisi) —
// mesuré à CHAQUE appel (pas mis en cache), donc reste correct après un
// redimensionnement de fenêtre ou du panneau de fichiers épinglé (voir les
// appels supplémentaires dans editor.js/browser.js).
// Round 34 (retour utilisateur : marge droite toujours pas triplée, marges
// verticales ignorées au défilement) — `Editor.syncOverlayMetrics()` DOIT
// être rappelée à la fin de cette fonction : `#ed-highlight` porte un
// `paddingRight` INLINE (posé par `syncGutter()`, pour compenser la
// largeur de la scrollbar du textarea) qui bat inconditionnellement la
// règle CSS `padding: var(--ed-margin-y) var(--ed-margin-x)` ci-dessus —
// changer la variable seule ne suffit donc pas, l'inline reste périmé tant
// que `syncGutter()` n'est pas rappelée. Voir aussi
// `syncVerticalCompensation()` (editor.js) pour la marge basse/le
// défilement, un problème distinct (déficit de `scrollHeight` entre le
// textarea à métriques uniformes et l'overlay aux titres agrandis).
function applyEditorTypography() {
  const root = document.documentElement.style;
  const s = State.settings;
  const marginFactor = Editor.isDistractionFree() ? Math.max(1, s.distractionFreeMarginFactor || 1) : 1;
  let marginX = s.editorMarginX * marginFactor;
  let marginY = s.editorMarginY * marginFactor;
  const main = document.getElementById('ed-main');
  if (main && main.clientWidth > 0 && main.clientHeight > 0) {
    marginX = Math.min(marginX, main.clientWidth * 0.4);
    marginY = Math.min(marginY, main.clientHeight * 0.4);
  }
  root.setProperty('--ed-font-family', s.editorFontFamily);
  root.setProperty('--ed-font-size', s.editorFontSize + 'px');
  root.setProperty('--ed-margin-x', marginX + 'px');
  root.setProperty('--ed-margin-y', marginY + 'px');
  root.setProperty('--ed-line-spacing', String(s.editorLineSpacing));
  Editor.syncOverlayMetrics();
}

// Injecte le CSS de la prévisualisation dans une balise <style> dédiée
// (round 25, demande explicite : exposer ce CSS dans Réglages et permettre
// de l'éditer). Réglage vide (jamais personnalisé, ou vidé par
// l'utilisateur) retombe sur `PreviewStyle.DEFAULT_CSS` — l'un OU l'autre
// est injecté, jamais une fusion des deux.
function applyPreviewCss() {
  let styleEl = document.getElementById('preview-custom-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'preview-custom-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = State.settings.previewCustomCss || PreviewStyle.DEFAULT_CSS;
}

// Largeur du panneau de fichiers épinglé (round 19bis) — variable CSS
// consommée par `body.sticky-workspace-active #browser-screen` (style.css),
// même principe que `applyEditorTypography()` ci-dessus : une fonction
// séparée, appelée à la fois au démarrage et depuis le setter
// (`setFileListSidebarWidth`, state.js), pour ne pas dupliquer la
// résolution de la variable CSS à chaque endroit qui touche ce réglage.
function applyFileListSidebarWidth() {
  document.documentElement.style.setProperty('--file-list-sidebar-width', State.settings.fileListSidebarWidth + 'px');
}

async function init() {
  // Utilisée par editor.js pour peindre la sélection comme un `Highlight`
  // (CSS Custom Highlight API) sur l'overlay plutôt que via `::selection` du
  // vrai textarea — voir le commentaire de `#ed-input::selection` dans
  // style.css. Chromium seulement (support depuis 2022), cohérent avec la
  // contrainte déjà assumée pour la File System Access API.
  document.documentElement.classList.toggle('custom-highlight-supported', !!(window.CSS && CSS.highlights));
  applyTheme(); // default palette immediately, no flash while loadState() (IndexedDB) is in flight
  if (!FSA.supported()) {
    document.getElementById('repo-support-hint').textContent = I18n.t('repo.fsaUnsupportedHint');
  }
  await Promise.all([loadState(), Themes.loadCustomSchemes()]);
  applyTheme(State.settings.scheme, State.settings.themeMode); // the persisted choice, once known
  applyEditorTypography();
  applyPreviewCss();
  applyFileListSidebarWidth();
  document.documentElement.classList.toggle('heading-sizes', State.settings.headingSizesEnabled);
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
