#!/usr/bin/env python3
"""Assembles src/ modules into a single zettelium.html file."""
import sys, os

BASE = os.path.join(os.path.dirname(__file__), 'src')

# Load order — each module assigns to global consts, no ES modules (see
# PLAN.md section 1: same no-bundler convention as writhdeck-web).
JS_ORDER = [
    'schemes.js',
    'icons.js',
    'i18n.js',
    'storage.js',
    'fsa.js',
    'txt2tags/regexes.js',
    'txt2tags/ast.js',
    'txt2tags/inline.js',
    'txt2tags/parser.js',
    'txt2tags/render.js',
    'txt2tags/summary.js',
    'txt2tags/toc.js',
    'zettelkasten.js',
    'tags.js',
    'ini.js',
    'state.js',
    'highlight.js',
    'index.js',
    'themes.js',
    'backup.js',
    'repositories.js',
    'settings.js',
    'theme-editor.js',
    'browser.js',
    'editor.js',
    'app.js',
]

def read(name):
    with open(os.path.join(BASE, name), encoding='utf-8') as f:
        return f.read()

template = read('template.html')
style    = read('style.css')
script   = '\n\n'.join(read(js) for js in JS_ORDER)

result = (template
    .replace('{{STYLE}}',  style)
    .replace('{{SCRIPT}}', script))
sys.stdout.write(result)
