'use strict';
// Ported from zettelium-android's `parser/Txt2TagsSummary.kt`. Aplatit une
// liste d'Inline en texte brut, et dérive le titre indexé d'une note (phase
// 4 — utilisé par index.js) : premier titre trouvé, sinon premier
// paragraphe non vide, sinon un repli (typiquement le nom de fichier).
const Txt2TagsSummary = (() => {
  function plainText(inlines) {
    let out = '';
    for (const inline of inlines) {
      switch (inline.type) {
        case 'Text':
        case 'Mono':
        case 'RawInline':
        case 'TaggedInline':
          out += inline.text;
          break;
        case 'Bold':
        case 'Italic':
        case 'Underline':
        case 'Strike':
          out += plainText(inline.children);
          break;
        case 'Link':
          out += plainText(inline.label);
          break;
        case 'ZkLink':
          out += inline.target;
          break;
        case 'Image':
          out += inline.path;
          break;
      }
    }
    return out;
  }

  function extractTitle(blocks, fallback) {
    for (const b of blocks) {
      if (b.type !== 'Heading') continue;
      const t = plainText(b.inlines).trim();
      if (t) return t;
    }
    for (const b of blocks) {
      if (b.type !== 'Paragraph') continue;
      const t = plainText(b.inlines).trim();
      if (t) return t;
    }
    return fallback;
  }

  return { plainText, extractTitle };
})();
