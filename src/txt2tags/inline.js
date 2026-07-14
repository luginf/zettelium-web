'use strict';
// Parseur inline txt2tags — ported from zettelium-android's
// `parser/Txt2TagsInline.kt`. Transforme le texte d'une ligne logique en
// liste d'Inline en cherchant, à chaque position, le construit reconnu le
// plus à gauche parmi tous les types (lien-marque, image, autolien,
// mono/raw/tagged, gras/italique/souligné/barré) — permet l'imbrication
// (gras contenant de l'italique, etc.).
//
// Cas "répétition gourmande" (`****bold****` -> gras contenant le texte
// littéral `**bold**`) : en reparsant le contenu capturé d'une marque, cette
// même marque est exclue de la recherche à ce niveau de récursion (le
// paramètre `exclude`) — sinon `**bold**` capturé par le `**` externe serait
// aussitôt réinterprété comme un gras imbriqué.
const Txt2TagsInline = (() => {
  function parse(text, exclude = null) {
    if (!text) return [];
    const result = [];
    let pos = 0;
    while (pos < text.length) {
      const remaining = text.slice(pos);
      const candidate = findEarliest(remaining, exclude);
      if (!candidate) {
        result.push(Text(remaining));
        break;
      }
      if (candidate.start > 0) {
        result.push(Text(remaining.slice(0, candidate.start)));
      }
      result.push(candidate.inline);
      pos += candidate.end; // end is relative to `remaining`, one past the match
    }
    return coalesceText(result);
  }

  function findEarliest(text, exclude) {
    let best = null; // { start, end, inline }
    function consider(regex, m, build) {
      if (!m || regex === exclude) return;
      const start = m.index;
      if (best === null || start < best.start) {
        best = { start, end: start + m[0].length, inline: build(m) };
      }
    }

    consider(Txt2TagsRegexes.zkLink, Txt2TagsRegexes.zkLink.exec(text), m =>
      ZkLink(m.groups.target ?? '', m.groups.zkId ?? ''));
    consider(Txt2TagsRegexes.linkmark, Txt2TagsRegexes.linkmark.exec(text), m =>
      Link(parse(m.groups.label ?? ''), m.groups.link ?? ''));
    consider(Txt2TagsRegexes.img, Txt2TagsRegexes.img.exec(text), m =>
      Image(m.groups.path ?? ''));
    consider(Txt2TagsRegexes.link, Txt2TagsRegexes.link.exec(text), m =>
      Link([Text(m[0])], m[0]));
    consider(Txt2TagsRegexes.fontMono, Txt2TagsRegexes.fontMono.exec(text), m => Mono(m[1]));
    consider(Txt2TagsRegexes.raw, Txt2TagsRegexes.raw.exec(text), m => RawInline(m[1]));
    consider(Txt2TagsRegexes.tagged, Txt2TagsRegexes.tagged.exec(text), m => TaggedInline(m[1]));
    consider(Txt2TagsRegexes.fontBold, Txt2TagsRegexes.fontBold.exec(text), m =>
      Bold(parse(m[1], Txt2TagsRegexes.fontBold)));
    consider(Txt2TagsRegexes.fontItalic, Txt2TagsRegexes.fontItalic.exec(text), m =>
      Italic(parse(m[1], Txt2TagsRegexes.fontItalic)));
    consider(Txt2TagsRegexes.fontUnderline, Txt2TagsRegexes.fontUnderline.exec(text), m =>
      Underline(parse(m[1], Txt2TagsRegexes.fontUnderline)));
    consider(Txt2TagsRegexes.fontStrike, Txt2TagsRegexes.fontStrike.exec(text), m =>
      Strike(parse(m[1], Txt2TagsRegexes.fontStrike)));

    return best;
  }

  function coalesceText(inlines) {
    const out = [];
    for (const inline of inlines) {
      const last = out[out.length - 1];
      if (inline.type === 'Text' && last && last.type === 'Text') {
        out[out.length - 1] = Text(last.text + inline.text);
      } else {
        out.push(inline);
      }
    }
    return out;
  }

  return { parse };
})();
