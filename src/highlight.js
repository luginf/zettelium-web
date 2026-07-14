'use strict';
// Syntax highlighting engine — textarea overlay technique, ported from
// writhdeck-web/src/highlight.js. Driven by the shared Txt2TagsRegexes bank
// (same regexes as the parser) rather than writhdeck-web's configurable
// single-char markers — mirrors zettelium-android's SyntaxHighlighting.kt
// model (heading level -> size class, comment dim, inline markup color).
//
// Deliberately NOT AST-based (same simplification Android documents for
// itself): a lightweight per-line regex pass, not full parse+re-render on
// every keystroke. No incremental single-line repaint optimization either
// (writhdeck-web's editor.js has one, justified there by 90K-word
// documents) — a full rehighlight() per keystroke is plenty for
// zettelkasten-sized notes; can be added later if it proves necessary.
const Highlight = (() => {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 'g'-flagged copies for iterating all matches on a line — kept separate
  // from the parser's own flagless instances so shared `lastIndex` state
  // never corrupts the parser's single-shot `.exec()` calls.
  const MARKUP_REGEXES_G = [
    Txt2TagsRegexes.fontBold,
    Txt2TagsRegexes.fontItalic,
    Txt2TagsRegexes.fontUnderline,
    Txt2TagsRegexes.fontStrike,
  ].map(re => new RegExp(re.source, 'g'));

  // Heading level for a line — txt2tags `=`/`+` titles or markdown ATX, same
  // precedence as Txt2TagsParser.matchHeading.
  function headingLevel(line) {
    let m = Txt2TagsRegexes.title.exec(line);
    if (m) return m[1].length;
    m = Txt2TagsRegexes.numtitle.exec(line);
    if (m) return m[1].length;
    m = Txt2TagsRegexes.markdownHeading.exec(line);
    if (m) return m[1].length;
    return null;
  }

  function renderLine(line) {
    const esc = escapeHtml(line);
    if (line.startsWith('%')) {
      return `<span class="hl-comment">${esc}</span>`;
    }
    const level = headingLevel(line);
    if (level !== null) {
      const lvCls = level <= 4 ? ` hl-h${level}` : '';
      return `<span class="hl-heading${lvCls}">${esc}</span>`;
    }
    let result = esc;
    for (const rx of MARKUP_REGEXES_G) {
      rx.lastIndex = 0;
      result = result.replace(rx, m => `<span class="hl-markup">${escapeHtml(m)}</span>`);
    }
    return result;
  }

  // \n between spans = line break in the pre's pre-wrap IFC. Trailing \n
  // ensures the overlay's height matches the textarea (empty last line).
  function highlight(text) {
    return text.split('\n')
      .map(line => `<span class="hl-line">${renderLine(line)}</span>`)
      .join('\n') + '\n';
  }

  return { highlight };
})();
