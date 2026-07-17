JS_SRCS := src/schemes.js src/icons.js src/i18n.js src/storage.js src/fsa.js \
           src/txt2tags/regexes.js src/txt2tags/ast.js src/txt2tags/inline.js \
           src/txt2tags/parser.js src/txt2tags/render.js src/txt2tags/summary.js \
           src/txt2tags/toc.js \
           src/zettelkasten.js src/editor-formatting.js src/tags.js src/ini.js \
           src/state.js src/highlight.js src/index.js \
           src/themes.js src/backup.js \
           src/repositories.js src/settings.js src/theme-editor.js \
           src/browser.js src/editor.js src/app.js

.PHONY: all debug clean test

# Minified by default (production export). Always rebuilds — zettelium.html
# is not used as a make prerequisite so `make` reliably overwrites whatever
# `make debug` last left in place, regardless of file mtimes.
all:
	python3 build.py > zettelium.html
	@echo "Built zettelium.html (minified, $$(wc -c < zettelium.html) bytes)"

# Unminified, same output filename — for debugging in the browser devtools.
# Run `make` again once done to restore the minified version before shipping.
debug:
	python3 build.py --debug > zettelium.html
	@echo "Built zettelium.html (debug/unminified, $$(wc -c < zettelium.html) bytes)"

test:
	node test/run.js

clean:
	rm -f zettelium.html
