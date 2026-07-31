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

  function escRx(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // Code block awareness (round 36) — same 3 open/close delimiter pairs the
  // parser uses (parser.js), tracked as a tiny open/closed state carried
  // from one line to the next. No markup/title/comment span is emitted for
  // any line inside a code block (opening/closing lines included), matching
  // the preview (render.js's CodeBlockView equivalent treats CodeBlock as
  // opaque text) — a previous version of this file kept applying markup
  // highlighting even inside verbatim blocks, inconsistent with the preview.
  // Wrapped in `hl-code` (round 22, user request) so it can be colored like
  // `hl-comment` — same var(--comment), a code block is "not prose" in the
  // same sense a comment is.
  const CODE_BLOCK_PAIRS = [
    { open: Txt2TagsRegexes.blockVerbOpen, close: Txt2TagsRegexes.blockVerbClose },
    { open: Txt2TagsRegexes.blockRawOpen, close: Txt2TagsRegexes.blockRawClose },
    { open: Txt2TagsRegexes.blockTaggedOpen, close: Txt2TagsRegexes.blockTaggedClose },
  ];
  const ONE_LINE_REGEXES = [
    Txt2TagsRegexes.oneLineVerb, Txt2TagsRegexes.oneLineRaw, Txt2TagsRegexes.oneLineTagged,
  ];

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
  //
  // `searchTerm` (in-note search, editor.js's Ctrl+F bar): injected as a
  // post-processing pass over the already-rendered HTML rather than woven
  // into renderLine() — same technique as writhdeck-web/src/highlight.js,
  // walking tag/text tokens so matches are only wrapped inside text nodes,
  // never inside an existing <span class="hl-...">'s markup.
  function highlight(text, searchTerm) {
    let closeRegex = null; // non-null = currently inside a code block
    const out = text.split('\n').map(line => {
      let opaque = false;
      if (closeRegex) {
        opaque = true;
        if (closeRegex.test(line)) closeRegex = null;
      } else {
        const pair = CODE_BLOCK_PAIRS.find(p => p.open.test(line));
        if (pair) {
          opaque = true;
          closeRegex = pair.close;
        } else if (ONE_LINE_REGEXES.some(rx => rx.test(line))) {
          opaque = true; // single-line form: opaque, but doesn't open a persisting block
        }
      }
      const rendered = opaque ? `<span class="hl-code">${escapeHtml(line)}</span>` : renderLine(line);
      return `<span class="hl-line">${rendered}</span>`;
    });
    if (!searchTerm) return out.join('\n') + '\n';
    const termRx = escRx(escapeHtml(searchTerm));
    return out.map(line => line.replace(/(<[^>]+>)|([^<]+)/g, (_, tag, chunk) =>
      tag ? tag : chunk.replace(new RegExp(termRx, 'gi'),
        m => `<span class="hl-search">${m}</span>`)
    )).join('\n') + '\n';
  }

  return { highlight };
})();
