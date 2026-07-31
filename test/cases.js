'use strict';
// Test cases for the ported txt2tags parser/inline engine — derived from
// zettelium-android's Kotlin test suites
// (app/src/test/java/com/zettelium/app/parser/Txt2TagsParserTest.kt and
// Txt2TagsInlineTest.kt), themselves derived from txt2tags_perl/t/ (see
// PLAN.md section 6). Checks the same behaviors on the JS port, adapted to
// plain-object ASTs (`{ type: '...', ... }`) instead of Kotlin sealed
// classes. Assumes Txt2TagsRegexes/ast.js/Txt2TagsInline/Txt2TagsParser are
// already in scope — see test/run.js, which concatenates the txt2tags
// sources with this file before executing.
const test = require('node:test');
const assert = require('node:assert/strict');

// --- Titres ----------------------------------------------------------------

test('balanced titles from level 1 to 5', () => {
  const blocks = Txt2TagsParser.parse(
    [
      '= Title Level 1 =',
      '== Title Level 2 ==',
      '=== Title Level 3 ===',
      '==== Title Level 4 ====',
      '===== Title Level 5 =====',
    ].join('\n'));
  assert.equal(blocks.length, 5);
  blocks.forEach((block, index) => {
    assert.equal(block.type, 'Heading');
    assert.equal(block.level, index + 1);
  });
});

test('title with label', () => {
  const blocks = Txt2TagsParser.parse('= Title Level 1 =[lab_el-1]');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].label, 'lab_el-1');
});

test('surrounding and inner spaces are trimmed', () => {
  const blocks = Txt2TagsParser.parse('===     Title Level 3      ===');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].level, 3);
  assert.deepEqual(blocks[0].inlines, [Text('Title Level 3')]);
});

test('unbalanced equal signs are not a title', () => {
  const blocks = Txt2TagsParser.parse('=Not Title');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'Paragraph');
});

test('deeper than level 5 is not a title', () => {
  const blocks = Txt2TagsParser.parse('======Not Title 6======');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'Paragraph');
});

test('numbered vs unnumbered title marker', () => {
  const eq = Txt2TagsParser.parse('= Title =')[0];
  const plus = Txt2TagsParser.parse('+ Title +')[0];
  assert.equal(eq.numbered, true);
  assert.equal(plus.numbered, false);
});

test('markdown atx heading is recognised alongside txt2tags titles', () => {
  const h2 = Txt2TagsParser.parse('## Hello')[0];
  assert.equal(h2.level, 2);
  assert.deepEqual(h2.inlines, [Text('Hello')]);

  const trailingHashes = Txt2TagsParser.parse('# Hello #')[0];
  assert.deepEqual(trailingHashes.inlines, [Text('Hello')]);
});

// --- Paragraphes & commentaires ---------------------------------------------

test('blank line separates paragraphs', () => {
  const blocks = Txt2TagsParser.parse('first para\n\nsecond para');
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every(b => b.type === 'Paragraph'));
});

test('single line comment is not rendered as paragraph', () => {
  const blocks = Txt2TagsParser.parse('% just a comment');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'Comment');
  assert.deepEqual(blocks[0].lines, ['% just a comment']);
});

test('comment block is captured verbatim', () => {
  const blocks = Txt2TagsParser.parse(
    ['%%%', 'hidden line one', 'hidden line two', '%%%', 'visible paragraph'].join('\n'));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'Comment');
  assert.deepEqual(blocks[0].lines, ['hidden line one', 'hidden line two']);
  assert.deepEqual(blocks[1], Paragraph([Text('visible paragraph')]));
});

// --- Barre horizontale -------------------------------------------------------

test('horizontal bar', () => {
  const blocks = Txt2TagsParser.parse('--------------------');
  assert.deepEqual(blocks, [HorizontalRule('-')]);
});

// --- Listes ------------------------------------------------------------------

test('simple unordered list', () => {
  const blocks = Txt2TagsParser.parse(
    ['- Use the hyphen to prefix list items.', '- There must be one space after the hyphen.'].join('\n'));
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, 'ListNode');
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].inlines, [Text('Use the hyphen to prefix list items.')]);
});

test('numbered list', () => {
  const blocks = Txt2TagsParser.parse('+ one\n+ two');
  const list = blocks[0];
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 2);
});

// "*" est un alias markdown de "-" pour les listes non ordonnées (déviation
// web-only, demande utilisateur explicite — voir CLAUDE.md).
test('asterisk is a markdown-style alias for the unordered list marker', () => {
  const blocks = Txt2TagsParser.parse('* Use the asterisk to prefix list items.\n* Second item.');
  assert.equal(blocks.length, 1);
  const list = blocks[0];
  assert.equal(list.type, 'ListNode');
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].inlines, [Text('Use the asterisk to prefix list items.')]);
});

test('a leading **bold** paragraph is not mistaken for an asterisk list item', () => {
  const blocks = Txt2TagsParser.parse('**bold** at the start of a line');
  assert.equal(blocks[0].type, 'Paragraph');
});

test('asterisk and hyphen markers at the same level merge into one unordered list', () => {
  const blocks = Txt2TagsParser.parse('- first\n* second');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'ListNode');
  assert.equal(blocks[0].items.length, 2);
});

test('not a list without exactly one space after the marker', () => {
  const noSpace = Txt2TagsParser.parse('-This is not a list (no space)');
  assert.equal(noSpace[0].type, 'Paragraph');

  const twoSpaces = Txt2TagsParser.parse('-    This is not a list (more than one space)');
  assert.equal(twoSpaces[0].type, 'Paragraph');
});

test('nested sublist', () => {
  const blocks = Txt2TagsParser.parse(
    ['- Mother item one', '- Mother item two', '  - Sub item one', '  - Sub item two'].join('\n'));
  const list = blocks[0];
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].children.length, 0);
  assert.equal(list.items[1].children.length, 1);
  const sublist = list.items[1].children[0];
  assert.equal(sublist.type, 'ListNode');
  assert.equal(sublist.items.length, 2);
});

test('going back to a shallower level closes the deeper sublists', () => {
  const blocks = Txt2TagsParser.parse(
    ['- Level 1', '  - Level 2', '    - Level 3', '- Level 1 again'].join('\n'));
  const list = blocks[0];
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[1].inlines, [Text('Level 1 again')]);
  assert.equal(list.items[1].children.length, 0);
});

test('a blank line closes the list', () => {
  // Simplification Zettelium : une seule ligne vide suffit à refermer une
  // liste (voir la note de simplification en tête de parser.js).
  const blocks = Txt2TagsParser.parse('- item one\n- item two\n\nplain paragraph');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'ListNode');
  assert.deepEqual(blocks[1], Paragraph([Text('plain paragraph')]));
});

// --- Tableaux ------------------------------------------------------------------

test('simple table row', () => {
  const blocks = Txt2TagsParser.parse('| Cell 1 | Cell 2 | Cell 3');
  const table = blocks[0];
  assert.equal(table.type, 'Table');
  const row = table.rows[0];
  assert.equal(row.isHeader, false);
  assert.equal(row.cells.length, 3);
  assert.deepEqual(row.cells[0].inlines, [Text('Cell 1')]);
});

test('header row uses double pipe', () => {
  const blocks = Txt2TagsParser.parse('|| Cell 1 | Cell 2 | Cell 3 |');
  assert.equal(blocks[0].rows[0].isHeader, true);
});

test('multi row table', () => {
  const blocks = Txt2TagsParser.parse(
    ['|| Header A | Header B |', '| a1 | b1 |', '| a2 | b2 |'].join('\n'));
  const table = blocks[0];
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0].isHeader, true);
  assert.equal(table.rows[1].isHeader, false);
});

// --- Blocs de code ---------------------------------------------------------------

test('single line verbatim', () => {
  const blocks = Txt2TagsParser.parse('``` A verbatim line.');
  const code = blocks[0];
  assert.equal(code.type, 'CodeBlock');
  assert.equal(code.kind, 'verbatim');
  assert.deepEqual(code.lines, ['A verbatim line.']);
});

test('verbatim area block', () => {
  const blocks = Txt2TagsParser.parse(
    ['```', 'A verbatim area delimited', '       by lines with marks.', '```'].join('\n'));
  const code = blocks[0];
  assert.equal(code.kind, 'verbatim');
  assert.deepEqual(code.lines, ['A verbatim area delimited', '       by lines with marks.']);
});

test('unterminated verbatim block is closed at EOF', () => {
  const blocks = Txt2TagsParser.parse(
    ['```', 'The end of the file (EOF) closes', 'the currently open verbatim area.'].join('\n'));
  assert.equal(blocks[0].lines.length, 2);
});

test('no space between mark and contents is not a verbatim line', () => {
  const blocks = Txt2TagsParser.parse('```Not a verbatim line, need one space after mark.');
  assert.equal(blocks[0].type, 'Paragraph');
});

test('verbatim block with a language identifier is not interpreted', () => {
  const blocks = Txt2TagsParser.parse(
    ['```kotlin', '// not a comment', '**not bold**'].join('\n'));
  const code = blocks[0];
  assert.equal(code.type, 'CodeBlock');
  assert.equal(code.kind, 'verbatim');
  assert.deepEqual(code.lines, ['// not a comment', '**not bold**']);
});

test('a non-nude closing line is treated as code block content, not a real close', () => {
  const blocks = Txt2TagsParser.parse(
    ['```kotlin', '```texte', '```'].join('\n'));
  const code = blocks[0];
  assert.equal(code.kind, 'verbatim');
  assert.deepEqual(code.lines, ['```texte']);
});

// --- Bout en bout ------------------------------------------------------------------

test('empty document produces no blocks', () => {
  assert.deepEqual(Txt2TagsParser.parse(''), []);
});

test('mixed document keeps blocks in order', () => {
  const blocks = Txt2TagsParser.parse(
    ['= Title =', '', 'A paragraph with **bold** text.', '', '- item one', '- item two', '', '| a | b |'].join('\n'));
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].type, 'Heading');
  assert.equal(blocks[1].type, 'Paragraph');
  assert.equal(blocks[2].type, 'ListNode');
  assert.equal(blocks[3].type, 'Table');
});

// --- Inline (Txt2TagsInlineTest.kt) -----------------------------------------

test('bold italic underline strike mono', () => {
  assert.deepEqual(Txt2TagsInline.parse('**bold**'), [Bold([Text('bold')])]);
  assert.deepEqual(Txt2TagsInline.parse('//ital//'), [Italic([Text('ital')])]);
  assert.deepEqual(Txt2TagsInline.parse('__undr__'), [Underline([Text('undr')])]);
  assert.deepEqual(Txt2TagsInline.parse('--strk--'), [Strike([Text('strk')])]);
  assert.deepEqual(Txt2TagsInline.parse('``mono``'), [Mono('mono')]);
});

test('marks must be glued to their content, spaced marks are not recognised', () => {
  assert.deepEqual(Txt2TagsInline.parse('** bold**'), [Text('** bold**')]);
  assert.deepEqual(Txt2TagsInline.parse('**bold **'), [Text('**bold **')]);
  assert.deepEqual(Txt2TagsInline.parse('** bold **'), [Text('** bold **')]);
});

test('repetition is greedy, outer marks win', () => {
  const result = Txt2TagsInline.parse('****bold****');
  assert.deepEqual(result, [Bold([Text('**bold**')])]);
});

test('no content between marks is not recognised', () => {
  assert.deepEqual(Txt2TagsInline.parse('****'), [Text('****')]);
  assert.deepEqual(Txt2TagsInline.parse('// //'), [Text('// //')]);
});

test('nesting bold and italic', () => {
  const result = Txt2TagsInline.parse('**bo //ld// ne**');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'Bold');
  assert.ok(result[0].children.some(c => c.type === 'Italic'));
});

test('plain paragraph text is untouched', () => {
  assert.deepEqual(Txt2TagsInline.parse('just plain text'), [Text('just plain text')]);
});

test('bare url is recognised as an autolink', () => {
  const result = Txt2TagsInline.parse('see http://example.com/dir/ for details');
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], Text('see '));
  assert.equal(result[1].type, 'Link');
  assert.equal(result[1].target, 'http://example.com/dir/');
  assert.deepEqual(result[2], Text(' for details'));
});

test('www without protocol is guessed as a link', () => {
  const result = Txt2TagsInline.parse('www.domain.com');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'Link');
  assert.equal(result[0].target, 'www.domain.com');
});

test('email is recognised as a link', () => {
  const result = Txt2TagsInline.parse('user@domain.com');
  assert.equal(result.length, 1);
  assert.equal(result[0].target, 'user@domain.com');
});

test('labelled link', () => {
  const result = Txt2TagsInline.parse('[label http://example.com]');
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'Link');
  assert.equal(result[0].target, 'http://example.com');
  assert.deepEqual(result[0].label, [Text('label')]);
});

test('image reference', () => {
  const result = Txt2TagsInline.parse('[image.png]');
  assert.deepEqual(result, [Image('image.png')]);
});

test('image mixed with text', () => {
  const result = Txt2TagsInline.parse('Images [image.png] mixed with text.');
  assert.deepEqual(result[0], Text('Images '));
  assert.deepEqual(result[1], Image('image.png'));
  assert.deepEqual(result[2], Text(' mixed with text.'));
});

test('zettelkasten link is recognised distinctly from a labelled link', () => {
  const result = Txt2TagsInline.parse('[[note.txt|20260702143012]]');
  assert.deepEqual(result, [ZkLink('note.txt', '20260702143012')]);
});

test('zettelkasten link mixed with text', () => {
  const result = Txt2TagsInline.parse('Voir [[autre.txt|20260702143012]] pour plus.');
  assert.deepEqual(result[0], Text('Voir '));
  assert.deepEqual(result[1], ZkLink('autre.txt', '20260702143012'));
  assert.deepEqual(result[2], Text(' pour plus.'));
});

// --- Render (no Kotlin counterpart — see render.js header comment) ---------

test('render escapes text and renders basic inline formatting', () => {
  const ast = Txt2TagsParser.parse('A **bold** & <danger>.');
  const html = Txt2TagsRender.renderAstToHtml(ast);
  assert.equal(html, '<p>A <b>bold</b> &amp; &lt;danger&gt;.</p>');
});

test('render treats raw/tagged/verbatim code blocks as escaped text (XSS-safety deviation, see render.js)', () => {
  const ast = Txt2TagsParser.parse('```\n<script>alert(1)</script>\n```');
  const html = Txt2TagsRender.renderAstToHtml(ast);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('render turns a checkbox list item into a checkbox input, stripping the marker from the label', () => {
  const ast = Txt2TagsParser.parse('- [ ] buy milk\n- [x] done');
  const indices = Txt2TagsChecklist.assignIndices(ast);
  const html = Txt2TagsRender.renderAstToHtml(ast, { checklistIndices: indices });
  assert.ok(html.includes('<li class="t2t-checklist-item"><input type="checkbox" class="t2t-checkbox" data-checkbox-index="0"><span>buy milk</span></li>'));
  assert.ok(html.includes('<li class="t2t-checklist-item"><input type="checkbox" class="t2t-checkbox" checked data-checkbox-index="1"><span>done</span></li>'));
});

test('render leaves an ordered list item with bracket-looking text as plain text, not a checkbox', () => {
  const ast = Txt2TagsParser.parse('+ [ ] not a checkbox');
  const html = Txt2TagsRender.renderAstToHtml(ast);
  assert.ok(!html.includes('t2t-checkbox'));
  assert.ok(html.includes('[ ] not a checkbox'));
});

// --- Editor syntax highlighting (highlight.js) ------------------------------

test('highlight wraps a heading line in hl-heading with a size class', () => {
  const html = Highlight.highlight('== A heading ==');
  assert.equal(html, '<span class="hl-line"><span class="hl-heading hl-h2">== A heading ==</span></span>\n');
});

test('highlight wraps a comment line in hl-comment', () => {
  const html = Highlight.highlight('% a comment');
  assert.equal(html, '<span class="hl-line"><span class="hl-comment">% a comment</span></span>\n');
});

test('highlight wraps inline bold markup in hl-markup within a plain line', () => {
  const html = Highlight.highlight('plain **bold** text');
  assert.equal(html, '<span class="hl-line">plain <span class="hl-markup">**bold**</span> text</span>\n');
});

test('highlight escapes HTML-sensitive characters', () => {
  const html = Highlight.highlight('a < b & c > d');
  assert.equal(html, '<span class="hl-line">a &lt; b &amp; c &gt; d</span>\n');
});

test('highlight does not interpret markup/headings inside a fenced code block (bare or with language), coloring it like a comment', () => {
  const html = Highlight.highlight(['```kotlin', '== not a heading ==', '**not bold**', '```'].join('\n'));
  assert.equal(html, [
    '<span class="hl-line"><span class="hl-code">```kotlin</span></span>',
    '<span class="hl-line"><span class="hl-code">== not a heading ==</span></span>',
    '<span class="hl-line"><span class="hl-code">**not bold**</span></span>',
    '<span class="hl-line"><span class="hl-code">```</span></span>',
  ].join('\n') + '\n');
});

test('highlight resumes normal markup after a code block closes', () => {
  const html = Highlight.highlight(['```', '**opaque**', '```', '**bold again**'].join('\n'));
  assert.ok(html.includes('<span class="hl-line"><span class="hl-code">**opaque**</span></span>'));
  assert.ok(html.includes('<span class="hl-markup">**bold again**</span>'));
});

test('highlight treats a non-nude closing line inside a code block as opaque content, still open', () => {
  const html = Highlight.highlight(['```kotlin', '```texte', '**still opaque**'].join('\n'));
  assert.ok(html.includes('<span class="hl-line"><span class="hl-code">```texte</span></span>'));
  assert.ok(html.includes('<span class="hl-line"><span class="hl-code">**still opaque**</span></span>'));
});

test('highlight treats a one-line code form as opaque without opening a persisting block', () => {
  const html = Highlight.highlight(['``` code here', '**bold after**'].join('\n'));
  assert.equal(html, [
    '<span class="hl-line"><span class="hl-code">``` code here</span></span>',
    '<span class="hl-line"><span class="hl-markup">**bold after**</span></span>',
  ].join('\n') + '\n');
});

// --- Txt2TagsSummary (plainText/extractTitle) — derived from Txt2TagsSummaryTest.kt ---

test('plainText flattens nested inline formatting', () => {
  const inlines = [
    Text('start '),
    Bold([Text('bold '), Italic([Text('and italic')])]),
    Text(' end'),
  ];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'start bold and italic end');
});

test('plainText keeps underline and strike content without markers', () => {
  const inlines = [Underline([Text('underlined')]), Text(' '), Strike([Text('struck')])];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'underlined struck');
});

test('plainText keeps verbatim text for mono, raw, and tagged inlines', () => {
  const inlines = [Mono('code'), Text(' '), RawInline('raw'), Text(' '), TaggedInline('tagged')];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'code raw tagged');
});

test('plainText uses the label for a regular link, not the target', () => {
  const inlines = [Link([Text('click here')], 'http://example.com')];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'click here');
});

test('plainText uses the target for a zettelkasten link, not the id', () => {
  const inlines = [ZkLink('Autre note.txt', '20260702143012')];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'Autre note.txt');
});

test('plainText uses the path for an image', () => {
  const inlines = [Image('images/photo.png')];
  assert.equal(Txt2TagsSummary.plainText(inlines), 'images/photo.png');
});

test('extractTitle prefers the first non-empty heading', () => {
  const blocks = [
    Paragraph([Text('intro paragraph')]),
    Heading(1, [Text('First title')]),
    Heading(2, [Text('Second title')]),
  ];
  assert.equal(Txt2TagsSummary.extractTitle(blocks, 'file.txt'), 'First title');
});

test('extractTitle skips a blank heading and falls back to the first non-empty paragraph', () => {
  const blocks = [
    Heading(1, [Text('   ')]),
    Paragraph([Text('   ')]),
    Paragraph([Text('Real content')]),
  ];
  assert.equal(Txt2TagsSummary.extractTitle(blocks, 'file.txt'), 'Real content');
});

test('extractTitle falls back to the filename when no heading or paragraph has content', () => {
  const blocks = [Comment(['% just a comment']), HorizontalRule('-')];
  assert.equal(Txt2TagsSummary.extractTitle(blocks, 'file.txt'), 'file.txt');
});

test('extractTitle falls back on an empty block list', () => {
  assert.equal(Txt2TagsSummary.extractTitle([], 'file.txt'), 'file.txt');
});

// --- TagExtractor — derived from TagExtractorTest.kt ------------------------

test('extracts simple inline tags', () => {
  assert.deepEqual(TagExtractor.extract('#tag1 in text with #tag2'), new Set(['tag1', 'tag2']));
});

test('does not extract markdown atx headings', () => {
  assert.deepEqual(TagExtractor.extract('## Title\n### Another title'), new Set());
});

test('does not extract url anchors', () => {
  assert.deepEqual(TagExtractor.extract('see http://example.com/page#section for details'), new Set());
});

test('extracts unicode and hyphenated tags', () => {
  assert.deepEqual(TagExtractor.extract('une #idée sur le #deep-work'), new Set(['idée', 'deep-work']));
});

test('deduplicates repeated tags', () => {
  assert.deepEqual(TagExtractor.extract('#tag appears #tag twice'), new Set(['tag']));
});

test('tag at start of line is recognised', () => {
  assert.deepEqual(TagExtractor.extract('#todo finish the report'), new Set(['todo']));
});

test('bare hash with no following word chars is not a tag', () => {
  assert.deepEqual(TagExtractor.extract('just a # symbol'), new Set());
});

// --- ZettelkastenLinks — derived from ZettelkastenLinksTest.kt --------------

test('generateId formats a 14-digit timestamp with the default format', () => {
  const id = ZettelkastenLinks.generateId(new Date(2026, 6, 3, 14, 30, 5));
  assert.equal(id, '20260703143005');
});

test('generateId honors a custom token format, matching a user-configured detection pattern', () => {
  // Motif réel vu en usage (voir CLAUDE.md android, round 12/12bis/12ter).
  const id = ZettelkastenLinks.generateId(new Date(2026, 2, 26, 21, 26, 30), 'id%Y%M%Dx%h%m%s');
  assert.equal(id, 'id20260326x212630');
});

test('extractId prefers the filename over the content', () => {
  assert.equal(ZettelkastenLinks.extractId('20260702143012 note.txt', 'no id here'), '20260702143012');
});

test('extractId falls back to content when filename has no id', () => {
  assert.equal(ZettelkastenLinks.extractId('note.txt', 'some text 20260702143012 more text'), '20260702143012');
});

test('extractId strips existing links before searching content so a referenced id is not mistaken for the note\'s own id', () => {
  const content = 'Voir [[Autre note.txt|20260101000000]] pour plus de détails.';
  assert.equal(ZettelkastenLinks.extractId('note.txt', content), null);
});

test('extractId returns null when no id is found anywhere', () => {
  assert.equal(ZettelkastenLinks.extractId('note.txt', 'rien à voir ici'), null);
});

test('findBodyIdOccurrence finds the first id in the body, skipping ones inside existing links', () => {
  const content = 'Voir [[Autre note.txt|20260101000000]].\nid propre : 20260702143012 puis 20260702143099.';
  const occ = ZettelkastenLinks.findBodyIdOccurrence(content);
  assert.equal(content.slice(occ.start, occ.end), '20260702143012');
});

test('findBodyIdOccurrence returns null when the body has no id (even if the filename would match)', () => {
  assert.equal(ZettelkastenLinks.findBodyIdOccurrence('rien à voir ici'), null);
});

test('findLinks extracts target and id from wiki links', () => {
  const links = ZettelkastenLinks.findLinks('Voir [[Autre note.txt|20260101000000]] et [[Encore.txt|20260202000000]].');
  assert.deepEqual(links.map(l => [l.target, l.zkId]), [
    ['Autre note.txt', '20260101000000'],
    ['Encore.txt', '20260202000000'],
  ]);
});

test('formatLink builds the wiki link syntax', () => {
  assert.equal(ZettelkastenLinks.formatLink('Ma note.txt', '20260702143012'), '[[Ma note.txt|20260702143012]]');
});

test('repairLinks rewrites only links targeting the given id with a stale target', () => {
  const content = 'Ancien lien [[vieux_nom.txt|20260702143012]] et autre [[autre.txt|20260101000000]].';
  const repaired = ZettelkastenLinks.repairLinks(content, '20260702143012', 'nouveau_nom.txt');
  assert.equal(repaired, 'Ancien lien [[nouveau_nom.txt|20260702143012]] et autre [[autre.txt|20260101000000]].');
});

test('repairLinks leaves already up to date links untouched', () => {
  const content = '[[nouveau_nom.txt|20260702143012]]';
  assert.equal(ZettelkastenLinks.repairLinks(content, '20260702143012', 'nouveau_nom.txt'), content);
});

test('linkAt finds the link under a collapsed cursor', () => {
  const content = 'Voir [[loisir.jardin|id20260318x101819]] pour la suite.';
  const link = ZettelkastenLinks.linkAt(content, 10, 10);
  assert.equal(link.zkId, 'id20260318x101819');
});

test('linkAt finds the link when part of it is selected', () => {
  const content = 'Voir [[loisir.jardin|id20260318x101819]] pour la suite.';
  const start = content.indexOf('id20260318x101819');
  const link = ZettelkastenLinks.linkAt(content, start, start + 'id20260318x101819'.length);
  assert.equal(link.target, 'loisir.jardin');
});

test('linkAt returns null outside any link', () => {
  const content = 'Voir [[loisir.jardin|id20260318x101819]] pour la suite.';
  assert.equal(ZettelkastenLinks.linkAt(content, content.length - 3, content.length - 3), null);
  assert.equal(ZettelkastenLinks.linkAt(content, -1, -1), null);
});

test('linkAt picks the overlapped link among several', () => {
  const content = '[[a.txt|20260101000000]] et [[b.txt|20260202000000]]';
  const secondStart = content.indexOf('[[b');
  assert.equal(ZettelkastenLinks.linkAt(content, secondStart + 3, secondStart + 3).zkId, '20260202000000');
});

test('stripLinks removes wiki links but leaves surrounding text', () => {
  const content = 'Voir [[Autre note.txt|20260101000000]] pour plus de détails.';
  assert.equal(ZettelkastenLinks.stripLinks(content), 'Voir  pour plus de détails.');
});

test('stripNoteExtension removes a recognised extension', () => {
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.txt'), 'note');
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.t2t'), 'note');
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.md'), 'note');
});

test('stripNoteExtension leaves the name untouched when the extension is not recognised', () => {
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.pdf'), 'note.pdf');
});

test('stripNoteExtension honors a custom extension list instead of the default', () => {
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.text', ['.text']), 'note');
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.txt', ['.text']), 'note.txt');
});

test('stripNoteExtension matches case-insensitively', () => {
  assert.equal(ZettelkastenLinks.stripNoteExtension('note.TXT'), 'note');
});

test('linkTarget keeps the full filename when includeExtension is true', () => {
  assert.equal(ZettelkastenLinks.linkTarget('note.txt', true), 'note.txt');
});

test('linkTarget strips the extension when includeExtension is false', () => {
  assert.equal(ZettelkastenLinks.linkTarget('note.txt', false), 'note');
});

test('linkTarget passes through a custom extension list', () => {
  assert.equal(ZettelkastenLinks.linkTarget('note.text', false, ['.text']), 'note');
});

// --- Txt2TagsToc — derived from Txt2TagsTocTest.kt --------------------------

test('builds entries for txt2tags and markdown headings with correct levels', () => {
  const source = ['= Title 1 =', 'some text', '== Title 2 ==', '## Markdown heading'].join('\n');
  const entries = Txt2TagsToc.build(source);
  assert.deepEqual(entries.map(e => e.level), [1, 2, 2]);
  assert.deepEqual(entries.map(e => e.title), ['Title 1', 'Title 2', 'Markdown heading']);
});

test('char offsets point to the start of each heading line', () => {
  const source = '= A =\nline two\n== B ==';
  const entries = Txt2TagsToc.build(source);
  assert.deepEqual(entries.map(e => e.charOffset), [0, 15]);
  assert.equal(source.slice(entries[0].charOffset).split('\n')[0], '= A =');
  assert.equal(source.slice(entries[1].charOffset).split('\n')[0], '== B ==');
});

test('numbered titles are recognised', () => {
  const entries = Txt2TagsToc.build('+ Numbered +');
  assert.deepEqual(entries.map(e => e.level), [1]);
  assert.deepEqual(entries.map(e => e.title), ['Numbered']);
});

test('no headings yields an empty list', () => {
  assert.deepEqual(Txt2TagsToc.build('just a paragraph\nwith two lines'), []);
});

// --- INI (durable config, no Kotlin counterpart — see ini.js header) -------

test('INI.stringify writes recognised settings under [general] and known repo names under [repositories]', () => {
  const text = INI.stringify(
    { noteExtensions: 'txt, md', noteExtensionsFilterDisabled: true, noteSortOrder: 'modified' },
    ['Repo A', 'Repo B']);
  assert.ok(text.includes('[general]'));
  assert.ok(text.includes('note_extensions = txt, md'));
  assert.ok(text.includes('note_extensions_filter_disabled = yes'));
  assert.ok(text.includes('note_sort_order = modified'));
  assert.ok(text.includes('[repositories]'));
  assert.ok(text.includes('known = Repo A | Repo B'));
});

test('INI.stringify omits settings that are undefined', () => {
  const text = INI.stringify({ noteExtensions: 'txt' }, []);
  assert.ok(!text.includes('id_pattern'));
  assert.ok(!text.includes('theme_mode'));
});

test('INI.parse round-trips what INI.stringify wrote', () => {
  const written = INI.stringify(
    { noteExtensions: 'txt, t2t', noteExtensionsFilterDisabled: false, idPattern: '\\d{14}', themeMode: 'dark' },
    ['Only Repo']);
  const { settings, knownRepositories } = INI.parse(written);
  assert.equal(settings.noteExtensions, 'txt, t2t');
  assert.equal(settings.noteExtensionsFilterDisabled, false);
  assert.equal(settings.idPattern, '\\d{14}');
  assert.equal(settings.themeMode, 'dark');
  assert.deepEqual(knownRepositories, ['Only Repo']);
});

test('INI.parse ignores unknown keys and ignores keys outside [general]/[repositories]', () => {
  const text = ['[general]', 'note_sort_order = name', 'mystery_key = whatever',
    '[somewhere_else]', 'note_sort_order = modified'].join('\n');
  const { settings } = INI.parse(text);
  assert.equal(settings.noteSortOrder, 'name');
  assert.equal(Object.keys(settings).length, 1);
});

test('INI.parse treats yes/1/true/on as boolean true, anything else as false', () => {
  for (const truthy of ['yes', '1', 'true', 'on', 'YES']) {
    const { settings } = INI.parse(`[general]\nnote_extensions_filter_disabled = ${truthy}`);
    assert.equal(settings.noteExtensionsFilterDisabled, true, `expected "${truthy}" to parse as true`);
  }
  const { settings } = INI.parse('[general]\nnote_extensions_filter_disabled = no');
  assert.equal(settings.noteExtensionsFilterDisabled, false);
});

test('INI round-trips editor typography settings (int/float types)', () => {
  const written = INI.stringify(
    { editorFontFamily: 'serif', editorFontSize: 18, editorMarginX: 48, editorMarginY: 20, editorLineSpacing: 1.7 },
    []);
  assert.ok(written.includes('editor_font_size = 18'));
  assert.ok(written.includes('editor_line_spacing = 1.7'));
  const { settings } = INI.parse(written);
  assert.equal(settings.editorFontFamily, 'serif');
  assert.equal(settings.editorFontSize, 18);
  assert.equal(settings.editorMarginX, 48);
  assert.equal(settings.editorMarginY, 20);
  assert.equal(settings.editorLineSpacing, 1.7);
});

// --- EditorFormatting — dérivés 1:1 de EditorFormattingTest.kt (zettelium-
// android), adaptés à la forme de retour JS ({rangeStart, rangeEnd,
// replacement, cursorStart, cursorEnd} plutôt qu'un texte entier déjà
// recombiné — voir editor-formatting.js pour le pourquoi). `applyResult`
// recombine pour comparer au texte final attendu, comme le ferait
// l'appelant réel (editor.js) via execCommand('insertText', ...).
function applyResult(text, r) {
  return text.slice(0, r.rangeStart) + r.replacement + text.slice(r.rangeEnd);
}

test('wrapInline wraps a selection with the marker', () => {
  const r = EditorFormatting.wrapInline('hello world', 6, 11, '**');
  assert.equal(applyResult('hello world', r), 'hello **world**');
  assert.equal(r.cursorStart, 8);
  assert.equal(r.cursorEnd, 13);
});

test('wrapInline unwraps when the selection includes the markers themselves', () => {
  const r = EditorFormatting.wrapInline('hello **world**', 6, 15, '**');
  assert.equal(applyResult('hello **world**', r), 'hello world');
  assert.equal(r.cursorStart, 6);
  assert.equal(r.cursorEnd, 11);
});

test('wrapInline unwraps when selection excludes the markers', () => {
  const r = EditorFormatting.wrapInline('hello **world**', 8, 13, '**');
  assert.equal(applyResult('hello **world**', r), 'hello world');
  assert.equal(r.cursorStart, 6);
  assert.equal(r.cursorEnd, 11);
});

test('wrapInline with no selection inserts an empty pair and centers the cursor', () => {
  const r = EditorFormatting.wrapInline('hello ', 6, 6, '//');
  assert.equal(applyResult('hello ', r), 'hello ////');
  assert.equal(r.cursorStart, 8);
  assert.equal(r.cursorEnd, 8);
});

test('wrapInline wraps again when the marker is present on only one side', () => {
  const r = EditorFormatting.wrapInline('**hello world', 2, 7, '**');
  assert.equal(applyResult('**hello world', r), '****hello** world');
  assert.equal(r.cursorStart, 4);
  assert.equal(r.cursorEnd, 9);
});

test('toggleLinePrefix adds the prefix to every non-blank selected line', () => {
  const text = 'line one\nline two\nline three';
  const r = EditorFormatting.toggleLinePrefix(text, 0, text.length, '% ');
  const result = applyResult(text, r);
  assert.equal(result, '% line one\n% line two\n% line three');
  assert.equal(r.cursorStart, 0);
  assert.equal(r.cursorEnd, result.length);
});

test('toggleLinePrefix removes the prefix when every selected line already has it', () => {
  const text = '% line one\n% line two';
  const r = EditorFormatting.toggleLinePrefix(text, 0, text.length, '% ');
  assert.equal(applyResult(text, r), 'line one\nline two');
});

test('toggleLinePrefix on a single cursor position affects only that line', () => {
  const text = 'first\nsecond\nthird';
  const cursor = text.indexOf('second') + 2;
  const r = EditorFormatting.toggleLinePrefix(text, cursor, cursor, '% ');
  assert.equal(applyResult(text, r), 'first\n% second\nthird');
});

test('toggleLinePrefix adds the prefix to every line when only some already have it', () => {
  const text = '% line one\nline two\n% line three';
  const r = EditorFormatting.toggleLinePrefix(text, 0, text.length, '% ');
  assert.equal(applyResult(text, r), '% % line one\n% line two\n% % line three');
});

test('toggleLinePrefix leaves blank lines untouched when adding the prefix', () => {
  const text = 'line one\n\nline two';
  const r = EditorFormatting.toggleLinePrefix(text, 0, text.length, '% ');
  assert.equal(applyResult(text, r), '% line one\n\n% line two');
});

test('toggleHeading wraps the current line as a level-1 heading', () => {
  const text = 'Some Title';
  const r = EditorFormatting.toggleHeading(text, 3, 3, 1);
  const result = applyResult(text, r);
  assert.equal(result, '= Some Title =');
  assert.equal(r.cursorStart, result.length);
  assert.equal(r.cursorEnd, result.length);
});

test('toggleHeading wraps with the marker matching the requested level', () => {
  const r = EditorFormatting.toggleHeading('Some Title', 3, 3, 3);
  assert.equal(applyResult('Some Title', r), '=== Some Title ===');
});

test('toggleHeading strips an existing heading of the same level back to plain text', () => {
  const r = EditorFormatting.toggleHeading('= Some Title =', 3, 3, 1);
  assert.equal(applyResult('= Some Title =', r), 'Some Title');
});

test('toggleHeading converts to a different level instead of stacking markers', () => {
  const r = EditorFormatting.toggleHeading('= Some Title =', 3, 3, 2);
  assert.equal(applyResult('= Some Title =', r), '== Some Title ==');
});

test('toggleHeading only touches the line the cursor is on', () => {
  const text = 'first line\nsecond line\nthird line';
  const cursor = text.indexOf('second');
  const r = EditorFormatting.toggleHeading(text, cursor, cursor, 1);
  assert.equal(applyResult(text, r), 'first line\n= second line =\nthird line');
});

test('toggleHeading preserves an existing label when converting to a different level', () => {
  const r = EditorFormatting.toggleHeading('= Some Title =[mylabel]', 3, 3, 2);
  assert.equal(applyResult('= Some Title =[mylabel]', r), '== Some Title ==[mylabel]');
});

test('toggleHeading clamps an out-of-range level', () => {
  const r = EditorFormatting.toggleHeading('Some Title', 3, 3, 9);
  assert.equal(applyResult('Some Title', r), '===== Some Title =====');
});

// --- Évaluation d'expressions (math-eval.js) — derived from SExprEvalTest.kt/
// RpnEvalTest.kt/InfixEvalTest.kt/MathExprEvalTest.kt (zettelium-android) ---

function evalSuccess(evaluator, expr) {
  const r = evaluator.evaluate(expr);
  assert.equal(r.ok, true, `expected success, got ${JSON.stringify(r)}`);
  return r.resultText;
}
function evalFailureMessage(evaluator, expr) {
  const r = evaluator.evaluate(expr);
  assert.equal(r.ok, false, `expected failure, got ${JSON.stringify(r)}`);
  return r.message;
}

test('SExprEval evaluates basic addition like the SciTE reference example', () => {
  assert.equal(evalSuccess(SExprEval, '(+ 75 1581 1000)'), '2656');
});

test('SExprEval evaluates nested expressions', () => {
  assert.equal(evalSuccess(SExprEval, '(+ 2 (* 3 4))'), '14');
});

test('SExprEval subtraction with a single argument negates it', () => {
  assert.equal(evalSuccess(SExprEval, '(- 5)'), '-5');
});

test('SExprEval division with a single argument inverts it', () => {
  assert.equal(evalSuccess(SExprEval, '(/ 2)'), '0.5');
});

test('SExprEval subtraction and division fold left to right over multiple arguments', () => {
  assert.equal(evalSuccess(SExprEval, '(- 10 3 3)'), '4');
  assert.equal(evalSuccess(SExprEval, '(/ 20 5 2)'), '2');
});

test('SExprEval mod min max abs sqrt expt floor ceil all work', () => {
  assert.equal(evalSuccess(SExprEval, '(mod 7 3)'), '1');
  assert.equal(evalSuccess(SExprEval, '(min 5 2 9)'), '2');
  assert.equal(evalSuccess(SExprEval, '(max 5 2 9)'), '9');
  assert.equal(evalSuccess(SExprEval, '(abs -5)'), '5');
  assert.equal(evalSuccess(SExprEval, '(sqrt 9)'), '3');
  assert.equal(evalSuccess(SExprEval, '(expt 2 3)'), '8');
  assert.equal(evalSuccess(SExprEval, '(floor 2.7)'), '2');
  assert.equal(evalSuccess(SExprEval, '(ceil 2.1)'), '3');
});

test('SExprEval formats whole-number results without a decimal point', () => {
  assert.equal(evalSuccess(SExprEval, '(+ 1 2 3)'), '6');
});

test('SExprEval keeps a fractional result as-is', () => {
  assert.equal(evalSuccess(SExprEval, '(/ 5 2)'), '2.5');
});

test('SExprEval trims surrounding whitespace before evaluating', () => {
  assert.equal(evalSuccess(SExprEval, '  (+ 1 2)  '), '3');
});

test('SExprEval fails on an empty selection', () => {
  assert.ok(evalFailureMessage(SExprEval, '').length > 0);
  assert.ok(evalFailureMessage(SExprEval, '   ').length > 0);
});

test('SExprEval fails on an unknown function', () => {
  assert.ok(evalFailureMessage(SExprEval, '(pow 2 3)').includes('pow'));
});

test('SExprEval fails on a missing closing parenthesis', () => {
  assert.ok(evalFailureMessage(SExprEval, '(+ 1 2').length > 0);
});

test('SExprEval fails on an unexpected closing parenthesis', () => {
  assert.ok(evalFailureMessage(SExprEval, '+ 1 2)').length > 0);
});

test('SExprEval fails on trailing characters after a complete expression', () => {
  assert.ok(evalFailureMessage(SExprEval, '(+ 1 2) (+ 3 4)').length > 0);
});

test('SExprEval fails on a bare number-less symbol', () => {
  assert.ok(evalFailureMessage(SExprEval, 'foo').length > 0);
});

test('SExprEval fails on an empty list', () => {
  assert.ok(evalFailureMessage(SExprEval, '()').length > 0);
});

test('RpnEval subtracts in push order, like a physical Forth stack', () => {
  assert.equal(evalSuccess(RpnEval, '34 12 -'), '22');
});

test('RpnEval chains binary operators without parentheses', () => {
  assert.equal(evalSuccess(RpnEval, '34 12 - 5 12 - +'), '15');
});

test('RpnEval divides in push order', () => {
  assert.equal(evalSuccess(RpnEval, '5 2 /'), '2.5');
});

test('RpnEval unary functions pop a single operand', () => {
  assert.equal(evalSuccess(RpnEval, '9 sqrt'), '3');
  assert.equal(evalSuccess(RpnEval, '-5 abs'), '5');
});

test('RpnEval formats whole-number results without a decimal point', () => {
  assert.equal(evalSuccess(RpnEval, '1 2 3 + +'), '6');
});

test('RpnEval fails on an empty selection', () => {
  assert.ok(evalFailureMessage(RpnEval, '').length > 0);
  assert.ok(evalFailureMessage(RpnEval, '   ').length > 0);
});

test('RpnEval fails when a binary operator is missing an operand', () => {
  assert.ok(evalFailureMessage(RpnEval, '34 -').length > 0);
});

test('RpnEval fails when the stack has leftover values', () => {
  assert.ok(evalFailureMessage(RpnEval, '34 12').length > 0);
});

test('RpnEval fails on an unknown token', () => {
  assert.ok(evalFailureMessage(RpnEval, '34 12 pow').includes('pow'));
});

test('InfixEval evaluates a simple subtraction with the trailing equals sign', () => {
  assert.equal(evalSuccess(InfixEval, '34-12='), '22');
});

test('InfixEval respects operator precedence', () => {
  assert.equal(evalSuccess(InfixEval, '3+4*2='), '11');
});

test('InfixEval parentheses override precedence', () => {
  assert.equal(evalSuccess(InfixEval, '(3+4)*2='), '14');
});

test('InfixEval power is right-associative', () => {
  assert.equal(evalSuccess(InfixEval, '2^3^2='), '512');
});

test('InfixEval unary minus works at the start of an expression', () => {
  assert.equal(evalSuccess(InfixEval, '-5='), '-5');
  assert.equal(evalSuccess(InfixEval, '-5+4='), '-1');
});

test('InfixEval tolerates surrounding whitespace', () => {
  assert.equal(evalSuccess(InfixEval, '  3 + 4 =  '), '7');
});

test('InfixEval requires a trailing equals sign to disambiguate from RPN', () => {
  assert.ok(evalFailureMessage(InfixEval, '34-12').length > 0);
});

test('InfixEval fails on an empty expression before the equals sign', () => {
  assert.ok(evalFailureMessage(InfixEval, '=').length > 0);
});

test('InfixEval fails on a missing closing parenthesis', () => {
  assert.ok(evalFailureMessage(InfixEval, '(3+4=').length > 0);
});

test('InfixEval fails on trailing characters after a complete expression', () => {
  assert.ok(evalFailureMessage(InfixEval, '3+4 5=').length > 0);
});

test('MathExprEval routes a leading-paren selection to the prefix evaluator', () => {
  assert.equal(evalSuccess(MathExprEval, '(+ 75 1581 1000)'), '2656');
});

test('MathExprEval routes a trailing-equals selection to the infix evaluator', () => {
  assert.equal(evalSuccess(MathExprEval, '34-12='), '22');
});

test('MathExprEval routes anything else to the RPN evaluator', () => {
  assert.equal(evalSuccess(MathExprEval, '34 12 -'), '22');
});

test('MathExprEval trailing equals wins even if the expression is also parenthesised', () => {
  assert.equal(evalSuccess(MathExprEval, '(3+4)*2='), '14');
});

test('MathExprEval an unrecognized bare word still fails, not silently no-ops', () => {
  assert.equal(MathExprEval.evaluate('foo').ok, false);
});

test("MathExprEval.formatResult keeps the historical 'expr = result' form for prefix Lisp expressions", () => {
  const r = MathExprEval.evaluate('(+ 1 2)');
  assert.equal(MathExprEval.formatResult('(+ 1 2)', r), '(+ 1 2) = 3');
});

test('MathExprEval.formatResult appends just the result after the existing equals sign for infix', () => {
  const r = MathExprEval.evaluate('34-12=');
  assert.equal(MathExprEval.formatResult('34-12=', r), '34-12= 22');
});

test('MathExprEval.formatResult puts the RPN result on a new line below, without an equals sign', () => {
  const r = MathExprEval.evaluate('34 12 -');
  assert.equal(MathExprEval.formatResult('34 12 -', r), '34 12 -\n22');
});

// --- Gestion des listes (editor-formatting.js: continueListOnNewline/
// indentListLines/dedentListLines) — derived from EditorFormattingTest.kt
// (zettelium-android, round 32/34) ---

test('continueListOnNewline repeats the same unordered marker on a non-empty item', () => {
  const text = '- first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '- first\n- ');
  assert.equal(r.cursorStart, text.length + 2);
});

test('continueListOnNewline repeats an asterisk marker (markdown alias) and offers checkbox continuation for it too', () => {
  const text = '* first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '* first\n* ');

  const checklistText = '* [ ] first\n';
  const checklistResult = EditorFormatting.continueListOnNewline(checklistText, checklistText.length);
  assert.equal(applyResult(checklistText, checklistResult), '* [ ] first\n* [ ] ');
});

test('continueListOnNewline preserves indentation and ordered marker', () => {
  const text = '  + first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '  + first\n  + ');
  assert.equal(r.cursorStart, text.length + 4);
});

test('continueListOnNewline continues a definition list item', () => {
  const text = ': term\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), ': term\n: ');
  assert.equal(r.cursorStart, text.length + 2);
});

test('continueListOnNewline removes the marker instead of repeating it on an empty item', () => {
  const text = '- first\n- \n';
  const cursor = text.length;
  const r = EditorFormatting.continueListOnNewline(text, cursor);
  assert.equal(applyResult(text, r), '- first\n');
  assert.equal(r.cursorStart, '- first\n'.length);
});

test('continueListOnNewline does nothing when the previous line is not a list item', () => {
  assert.equal(EditorFormatting.continueListOnNewline('plain paragraph\n', 'plain paragraph\n'.length), null);
});

test('continueListOnNewline does nothing without a freshly inserted newline right before the cursor', () => {
  assert.equal(EditorFormatting.continueListOnNewline('- item', 3), null);
});

test('continueListOnNewline inserts a fresh unchecked checkbox after a checkbox item', () => {
  const text = '- [ ] first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '- [ ] first\n- [ ] ');
  assert.equal(r.cursorStart, text.length + 6);
});

test('continueListOnNewline inserts a fresh unchecked checkbox even after a checked item', () => {
  const text = '- [x] done\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '- [x] done\n- [ ] ');
  assert.equal(r.cursorStart, text.length + 6);
});

test('continueListOnNewline recognizes the empty-bracket checkbox form too', () => {
  const text = '- [] first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '- [] first\n- [ ] ');
  assert.equal(r.cursorStart, text.length + 6);
});

test('continueListOnNewline exits the list on a label-less checkbox item', () => {
  const text = '- [ ] first\n- [ ] \n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '- [ ] first\n');
  assert.equal(r.cursorStart, '- [ ] first\n'.length);
});

test("continueListOnNewline does not treat an ordered item's bracket text as a checkbox", () => {
  const text = '+ [ ] first\n';
  const r = EditorFormatting.continueListOnNewline(text, text.length);
  assert.equal(applyResult(text, r), '+ [ ] first\n+ ');
  assert.equal(r.cursorStart, text.length + 2);
});

test('indentListLines adds two spaces before list markers only', () => {
  const text = '- item\nnot a list line';
  const r = EditorFormatting.indentListLines(text, 0, text.length);
  assert.equal(applyResult(text, r), '  - item\nnot a list line');
});

test('indentListLines/dedentListLines also recognize the asterisk marker', () => {
  const text = '* item';
  const indented = applyResult(text, EditorFormatting.indentListLines(text, 0, text.length));
  assert.equal(indented, '  * item');
  const dedented = applyResult(indented, EditorFormatting.dedentListLines(indented, 0, indented.length));
  assert.equal(dedented, text);
});

test('dedentListLines removes up to two leading spaces from list markers only', () => {
  const text = '    - item\nnot a list line';
  const r = EditorFormatting.dedentListLines(text, 0, text.length);
  assert.equal(applyResult(text, r), '  - item\nnot a list line');
});

test('dedentListLines does not go below zero indentation', () => {
  const text = '- item';
  const r = EditorFormatting.dedentListLines(text, 0, text.length);
  assert.equal(applyResult(text, r), '- item');
});

test('indentListLines and dedentListLines round-trip on a single list line', () => {
  const text = '- item';
  const indented = applyResult(text, EditorFormatting.indentListLines(text, 0, text.length));
  const roundTripped = applyResult(indented, EditorFormatting.dedentListLines(indented, 0, indented.length));
  assert.equal(roundTripped, text);
});

// --- Cases à cocher (txt2tags/checklist.js) — derived from
// Txt2TagsChecklistTest.kt (zettelium-android, round 32/34) ---

test('parseCheckbox recognizes an unchecked box with a space', () => {
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[ ] buy milk'), { checked: false, label: 'buy milk' });
});

test('parseCheckbox recognizes the empty-bracket form as unchecked too', () => {
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[] buy milk'), { checked: false, label: 'buy milk' });
});

test('parseCheckbox recognizes a checked box (lower or upper case x)', () => {
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[x] done'), { checked: true, label: 'done' });
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[X] done'), { checked: true, label: 'done' });
});

test('parseCheckbox returns an empty label for a marker with nothing after it', () => {
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[ ] '), { checked: false, label: '' });
  assert.deepEqual(Txt2TagsChecklist.parseCheckbox('[ ]'), { checked: false, label: '' });
});

test('parseCheckbox returns null for content that is not a checkbox', () => {
  assert.equal(Txt2TagsChecklist.parseCheckbox('plain text'), null);
  assert.equal(Txt2TagsChecklist.parseCheckbox('not [ ] at start'), null);
});

test('toggle flips an unchecked box to checked', () => {
  assert.equal(Txt2TagsChecklist.toggle('- [ ] task', 0), '- [x] task');
});

test('toggle also works on an asterisk-marked list item', () => {
  assert.equal(Txt2TagsChecklist.toggle('* [ ] task', 0), '* [x] task');
});

test('toggle flips a checked box back to unchecked', () => {
  assert.equal(Txt2TagsChecklist.toggle('- [x] task', 0), '- [ ] task');
});

test('toggle finds the Nth checkbox top-to-bottom, nesting included', () => {
  const source = ['- [ ] first', '  - [ ] nested', '- [x] third'].join('\n');
  assert.equal(Txt2TagsChecklist.toggle(source, 1), ['- [ ] first', '  - [x] nested', '- [x] third'].join('\n'));
});

test('toggle returns null for an out-of-range index', () => {
  assert.equal(Txt2TagsChecklist.toggle('- [ ] only one', 5), null);
});

test('toggle ignores non-checkbox list items when counting', () => {
  const source = ['- plain item', '- [ ] checkbox'].join('\n');
  assert.equal(Txt2TagsChecklist.toggle(source, 0), ['- plain item', '- [x] checkbox'].join('\n'));
});

test('assignIndices numbers unordered checkbox items top-to-bottom, skipping ordered lists', () => {
  const blocks = Txt2TagsParser.parse(['- [ ] first', '- [ ] second', '+ [ ] not a checkbox (ordered)'].join('\n'));
  const list = blocks[0];
  const indices = Txt2TagsChecklist.assignIndices(blocks);
  assert.equal(indices.get(list.items[0]), 0);
  assert.equal(indices.get(list.items[1]), 1);
  const orderedList = blocks[1];
  assert.equal(indices.has(orderedList.items[0]), false);
});

test('assignIndices distinguishes two structurally identical empty checkbox items', () => {
  const blocks = Txt2TagsParser.parse(['- [ ] ', '- [ ] '].join('\n'));
  const list = blocks[0];
  const indices = Txt2TagsChecklist.assignIndices(blocks);
  assert.equal(indices.get(list.items[0]), 0);
  assert.equal(indices.get(list.items[1]), 1);
});
