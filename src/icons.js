'use strict';
// Monochrome inline SVG icons (`fill`/`stroke: currentColor`, follows the
// button's own text color) — replaces colored emoji glyphs (🔗💾👁✏️🔢🕘♻️
// ⚙📁🏷 etc.) per explicit user request ("de façon générale ne mets pas
// d'icone colorée si possible"). Mostly simple Feather-style stroke icons
// (well-known, simple single/double-path shapes, safe to reproduce exactly)
// plus two hand-drawn ones (settings gear, hash) where no simple standard
// icon fit. Where Android reuses the *same* Material icon for two
// different actions (e.g. `Icons.Filled.Link` for both backlinks and
// "insert link"), this reuses the same SVG here too.
const Icons = (() => {
  const strokeSvg = (paths, size) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

  // Feather "link" — reused for both the backlinks button and "Insérer un
  // lien", same as Android reusing Icons.Filled.Link for both.
  const link = (size = 18) => strokeSvg(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', size);

  // Feather "save" (floppy disk).
  const save = (size = 18) => strokeSvg(
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>', size);

  // Feather "eye" / "eye-off" — preview/edit toggle.
  const eye = (size = 18) => strokeSvg(
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>', size);
  const eyeOff = (size = 18) => strokeSvg(
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>', size);

  // Feather "edit-2" (plain pencil) — reused for both the preview toggle's
  // "switch to edit" state and "Renommer", same as Android reusing
  // Icons.Filled.Edit for both.
  const edit = (size = 18) => strokeSvg('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>', size);

  // Hash/number glyph — no simple standard "insert ID" icon exists; a
  // literal "#" reads reasonably for "insert a generated identifier".
  const hash = (size = 18) => strokeSvg(
    '<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>' +
    '<line x1="9" y1="4" x2="7" y2="20"/><line x1="16" y1="4" x2="14" y2="20"/>', size);

  // Feather "clock" — create backup (Android's History icon is a clock
  // with a back-arrow; a plain clock reads the same at this size).
  const clock = (size = 18) => strokeSvg(
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', size);

  // Feather "rotate-ccw" — restore backup.
  const restore = (size = 18) => strokeSvg(
    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>', size);

  // Feather "tool" (wrench) — repair Zettelkasten links (Android:
  // Icons.Filled.Build).
  const wrench = (size = 18) => strokeSvg(
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', size);

  // Feather "tag".
  const tag = (size = 18) => strokeSvg(
    '<path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2.59 12.59a2 2 0 0 1 0-2.83l7.17-7.17A2 2 0 0 1 12 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-.41 1.41z"/>' +
    '<circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>', size);

  // Simple stacked-triangles "sort" glyph — one icon for the sort toggle
  // regardless of state, the tooltip text says which order is active.
  const sort = (size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">` +
    '<polygon points="12,4 16,9 8,9"/><polygon points="12,20 16,15 8,15"/></svg>';

  // Gear/settings — hand-drawn (ring + 8 teeth), no simple standard icon
  // reused elsewhere in this set fit closely enough to justify borrowing.
  function gear(size = 18) {
    let teeth = '';
    for (let i = 0; i < 8; i++) {
      teeth += `<rect x="10.7" y="1.2" width="2.6" height="3.6" rx="1" transform="rotate(${i * 45} 12 12)"/>`;
    }
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">` +
      '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
      teeth + '</svg>';
  }

  // Material "toc" (AutoMirrored.Filled.Toc) — 3 lines + 3 trailing dots,
  // exact shape requested by the user, already in use in template.html.
  const toc = (size = 20) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor">` +
    '<path d="M4,18h9v-2H4V18z M4,13h9v-2H4V13z M4,6v2h9V6H4z M18.5,15c0.83,0,1.5,-0.67,1.5,-1.5S19.33,12,18.5,12' +
    'S17,12.67,17,13.5S17.67,15,18.5,15z M18.5,20c0.83,0,1.5,-0.67,1.5,-1.5S19.33,17,18.5,17s-1.5,0.67,-1.5,1.5' +
    'S17.67,20,18.5,20z M18.5,10c0.83,0,1.5,-0.67,1.5,-1.5S19.33,7,18.5,7S17,7.67,17,8.5S17.67,10,18.5,10z"/></svg>';

  // Feather "trash-2" — supprimer une note (Android : Icons.Filled.Delete).
  const trash = (size = 18) => strokeSvg(
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>', size);

  // Feather "folder" — lignes du navigateur de destination dans le
  // dialogue "Déplacer" (Android : Icons.Filled.Folder).
  const folder = (size = 18) => strokeSvg(
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', size);

  return { link, save, eye, eyeOff, edit, hash, clock, restore, wrench, tag, sort, gear, toc, trash, folder };
})();
