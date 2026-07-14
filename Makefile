JS_SRCS := src/schemes.js src/storage.js src/fsa.js \
           src/txt2tags/regexes.js src/txt2tags/ast.js src/txt2tags/inline.js \
           src/txt2tags/parser.js src/txt2tags/render.js src/txt2tags/summary.js \
           src/txt2tags/toc.js \
           src/zettelkasten.js src/tags.js src/ini.js \
           src/state.js src/highlight.js src/index.js \
           src/themes.js src/backup.js \
           src/repositories.js src/settings.js src/theme-editor.js \
           src/browser.js src/editor.js src/app.js

.PHONY: all clean test

all: zettelium.html

zettelium.html: src/template.html src/style.css $(JS_SRCS) build.py
	python3 build.py > zettelium.html
	@echo "Built zettelium.html ($$(wc -c < zettelium.html) bytes)"

test:
	node test/run.js

clean:
	rm -f zettelium.html
