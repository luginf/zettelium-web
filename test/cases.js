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
