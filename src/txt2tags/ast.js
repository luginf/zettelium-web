'use strict';
// AST produced by parser.js: a document is an array of Block. Ported from
// zettelium-android's `parser/Txt2TagsAst.kt` — Kotlin's sealed
// interfaces/data classes become plain objects with a `type` discriminant
// (JS has no sealed types), everything else (field names, shape) mirrors
// the Kotlin 1:1.

// --- Inline --------------------------------------------------------------
function Text(text) { return { type: 'Text', text }; }
function Bold(children) { return { type: 'Bold', children }; }
function Italic(children) { return { type: 'Italic', children }; }
function Underline(children) { return { type: 'Underline', children }; }
function Strike(children) { return { type: 'Strike', children }; }

// Code inline (`` `code` ``) — contenu verbatim, jamais reparsé.
function Mono(text) { return { type: 'Mono', text }; }
// Texte "brut" (`""texte""`) — passe-plat verbatim, rendu comme texte simple.
function RawInline(text) { return { type: 'RawInline', text }; }
// Texte "tagué" (`''texte''`) — verbatim, rendu comme texte simple.
function TaggedInline(text) { return { type: 'TaggedInline', text }; }

function Link(label, target) { return { type: 'Link', label, target }; }
// Lien Zettelkasten `[[cible|zkId]]` — voir zettelkasten.js (phase 5).
function ZkLink(target, zkId) { return { type: 'ZkLink', target, zkId }; }
function Image(path) { return { type: 'Image', path }; }

// --- Block -----------------------------------------------------------------
function Heading(level, inlines, label = null, numbered = true) {
  return { type: 'Heading', level, inlines, label, numbered };
}
function Paragraph(inlines) { return { type: 'Paragraph', inlines }; }

// Ligne(s) de commentaire (`% ...` ou bloc `%%% ... %%%`) — jamais rendues.
function Comment(lines) { return { type: 'Comment', lines }; }

function HorizontalRule(marker) { return { type: 'HorizontalRule', marker }; }

// kind: 'verbatim' | 'raw' | 'tagged' (CodeBlockKind Kotlin enum -> string).
function CodeBlock(lines, kind) { return { type: 'CodeBlock', lines, kind }; }

function ListItem(inlines, children = []) { return { inlines, children }; }
function ListNode(ordered, items) { return { type: 'ListNode', ordered, items }; }

function DefinitionItem(term, description) { return { term, description }; }
function DefinitionList(items) { return { type: 'DefinitionList', items }; }

function TableCell(inlines) { return { inlines }; }
function TableRow(cells, isHeader) { return { cells, isHeader }; }
function Table(rows) { return { type: 'Table', rows }; }
