#!/usr/bin/env python3
"""Assembles src/ modules into a single zettelium.html file."""
import sys, os, subprocess

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

def minify_js(code):
    """Runs the assembled bundle through terser (compress+mangle, no --toplevel
    so global module names like Editor/State/Index stay intact)."""
    try:
        result = subprocess.run(
            ['terser', '--compress', '--mangle', '--comments', 'false'],
            input=code, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("build.py: 'terser' not found on PATH — install it "
                  "(e.g. `npm install -g terser`) or build with `make debug` "
                  "for an unminified zettelium.html.")
    if result.returncode != 0:
        sys.exit(f"build.py: terser minification failed:\n{result.stderr}")
    return result.stdout

template = read('template.html')
style    = read('style.css')
script   = '\n\n'.join(read(js) for js in JS_ORDER)

if '--debug' not in sys.argv:
    script = minify_js(script)

result = (template
    .replace('{{STYLE}}',  style)
    .replace('{{SCRIPT}}', script))
sys.stdout.write(result)
