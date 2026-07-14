'use strict';
// Custom color scheme storage — ported in spirit from zettelium-android's
// `AppSettings.customEditorSchemes` (create/edit/duplicate/delete, see
// `EditorThemesScreen.kt`). Mutates `schemes.js`'s `customSchemes` object in
// place (same shared top-level scope as `State`/`ZettelkastenLinks`/etc. —
// no export plumbing needed, see any other module here), persisted as one
// JSON blob in IndexedDB (`meta.customSchemes`).
//
// A custom scheme is edited with only the 6 colors zettelium-android also
// exposes (fond/texte/sélection/titre/commentaire/balisage, dark + light) —
// `bgBar`/`fgBar`/`bg2` (writhdeck-web's themed-toolbar fields, not part of
// Android's model — zettelium has no separately themed chrome bar) are
// derived from `bg`/`fg` rather than exposed for editing, so `applyTheme()`
// still has every CSS variable it needs without a 12-field editor.
const Themes = (() => {
  function schemeFromSixColors(colors) {
    const { bg, fg, bgSel, heading, comment, markup,
      bgAlt, fgAlt, bgSelAlt, headingAlt, commentAlt, markupAlt } = colors;
    return {
      bg, fg, bgSel, heading, comment, markup,
      bgBar: bg, fgBar: fg, bg2: bg,
      bgAlt, fgAlt, bgSelAlt, headingAlt, commentAlt, markupAlt,
      bgBarAlt: bgAlt, fgBarAlt: fgAlt, bg2Alt: bgAlt
    };
  }

  // Les 6 couleurs éditables, dans l'ordre attendu par l'éditeur de thème
  // (voir theme-editor.js) — même ordre qu'`EditorThemesScreen.kt`
  // (`COLOR_LABEL_KEYS`/`darkList()`/`lightList()`).
  function sixColorsFromScheme(scheme) {
    return {
      bg: scheme.bg, fg: scheme.fg, bgSel: scheme.bgSel,
      heading: scheme.heading, comment: scheme.comment, markup: scheme.markup,
      bgAlt: scheme.bgAlt, fgAlt: scheme.fgAlt, bgSelAlt: scheme.bgSelAlt,
      headingAlt: scheme.headingAlt, commentAlt: scheme.commentAlt, markupAlt: scheme.markupAlt
    };
  }

  async function persist() {
    await Storage.setMeta('customSchemes', JSON.stringify(customSchemes));
  }

  async function loadCustomSchemes() {
    const raw = await Storage.getMeta('customSchemes');
    if (!raw) return;
    try {
      Object.assign(customSchemes, JSON.parse(raw));
    } catch (e) {
      console.error('Échec de lecture des thèmes personnalisés', e);
    }
  }

  // `sixColors` = un objet {bg, fg, bgSel, heading, comment, markup,
  // bgAlt, fgAlt, bgSelAlt, headingAlt, commentAlt, markupAlt}.
  async function saveCustomScheme(name, sixColors) {
    customSchemes[name] = schemeFromSixColors(sixColors);
    await persist();
    if (State.settings.scheme === name) applyTheme(State.settings.scheme, State.settings.darkMode);
  }

  async function deleteCustomScheme(name) {
    delete customSchemes[name];
    await persist();
    if (State.settings.scheme === name) await setScheme('default');
  }

  return { loadCustomSchemes, saveCustomScheme, deleteCustomScheme, sixColorsFromScheme };
})();
