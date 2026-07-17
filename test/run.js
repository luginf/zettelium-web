#!/usr/bin/env node
'use strict';
// Concatenates the txt2tags sources with cases.js into one script — same
// "single global scope, no ES modules" convention as build.py — and
// evaluates it as a single unit, so `Txt2TagsParser`/`Text`/etc. (declared
// as top-level const/function in the src files) are already in scope for
// the tests. The src files stay untouched (no require()/module.exports —
// they must remain plain browser-loadable <script> content); only this
// runner and cases.js use Node's require().
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const FILES = [
  'txt2tags/regexes.js',
  'txt2tags/ast.js',
  'txt2tags/inline.js',
  'txt2tags/parser.js',
  'txt2tags/render.js',
  'txt2tags/summary.js',
  'txt2tags/toc.js',
  'zettelkasten.js',
  'editor-formatting.js',
  'tags.js',
  'ini.js',
  'highlight.js',
];

const combined = FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf-8')).join('\n\n')
  + '\n\n' + fs.readFileSync(path.join(__dirname, 'cases.js'), 'utf-8');

// Direct eval: runs in this scope, so `require` (a free variable from this
// CommonJS module's wrapper) resolves normally even though the combined
// code is strict-mode (each concatenated file starts with 'use strict') —
// strict direct eval only isolates the *declarations* it introduces, not
// lookups of names declared in an enclosing scope.
eval(combined);
