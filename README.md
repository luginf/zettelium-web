# Zettelium

A Zettelkasten note-taking app in [txt2tags](https://txt2tags.org/) syntax that runs as a single self-contained HTML file — no server, no install, no internet required. Open `zettelium.html` directly in a Chromium-based browser.

This is the web port of `zettelium-android`, built with the same single-file, no-bundler approach as [Writhdeck](https://github.com/luginf/writhdeck) (see [Build](#build)).

## Features

- **Multiple repositories**: each one is a real folder on your disk, opened via the File System Access API — no data lives anywhere but your own filesystem.
- **txt2tags syntax** with live syntax highlighting and a real HTML preview, from a parser ported directly from the Android app's Kotlin implementation.
- **Zettelkasten linking**: `[[target|id]]` links, configurable ID generation format and detection pattern, a backlinks panel, and a link-repair action that fixes stale links after a rename/move.
- **Search**: by name, content, or `#tag`, scoped to the active repository and covering all subfolders regardless of which one you're browsing.
- **Subfolder navigation** within a repository, file-manager style.
- **Full note management**: create, rename, move (to another folder or repository), and delete notes directly from the browser.
- **External modification detection**: if a note changed on disk since you opened it, saving offers to overwrite, reload, or cancel instead of silently clobbering the change.
- **Cursor position** is remembered per note and restored when you reopen it.
- **Backups**: create a timestamped copy of a note on demand, and restore from its backup history.
- **8 built-in color schemes** (dark/light variants) plus a full custom-scheme editor.
- **Configurable editor typography**: font family/size, margins, line spacing — with direct numeric entry, not just +/- steppers.
- **Autosave** (opt-in, debounced, off by default).
- **Table of contents**: either a quick modal popup, or an optional persistent side panel that docks next to the editor.
- **FR/EN interface language**, following the system language or set explicitly.
- **Durable `.ini` config** written to the primary repository, so settings survive a browser data wipe (the repository folders themselves still need to be re-authorized once, a File System Access API constraint that can't be worked around).

## Build

```sh
make        # produces zettelium.html
make clean  # removes zettelium.html
make test   # runs the pure-logic test suite (Node.js, no browser needed)
```

`build.py` inlines `src/style.css` and all JS modules (in the order defined in `JS_ORDER`/`JS_SRCS`) into `src/template.html`. Python 3, no dependencies, no npm.

## Browser support

**Chromium-based browsers only** (Chrome, Edge, Brave, …). The File System Access API — the storage mechanism this app is built around, not an optional add-on — doesn't exist in Firefox or Safari. There is no degraded fallback mode.

## Project structure

```
src/
  template.html    HTML skeleton with {{STYLE}} / {{SCRIPT}} placeholders
  style.css         All CSS (custom properties for theming, no hardcoded colors)
  schemes.js        Built-in color schemes
  icons.js          Monochrome inline SVG icons
  i18n.js           FR/EN interface strings
  storage.js        IndexedDB wrapper (repositories + settings)
  fsa.js            File System Access API helpers
  txt2tags/         Parser: regexes, AST, inline/block parsing, HTML rendering, TOC
  zettelkasten.js   ID generation/detection, [[target|id]] links, link repair
  tags.js           #tag extraction
  ini.js            Durable config file parser/writer
  state.js          App state, settings, repository registry
  highlight.js       Editor syntax highlighting (shares the parser's regexes)
  index.js          In-memory search index (name/content/tag), incremental scan
  themes.js         Custom color scheme persistence
  backup.js         Timestamped note backups
  repositories.js   Repository list screen
  settings.js       Global settings screen
  theme-editor.js   Color scheme list/editor screens
  browser.js        File browser for the active repository
  editor.js         Note editor: textarea+overlay highlighting, preview, TOC, backlinks
  app.js            Entry point, theming, initialization
build.py            Build script (inlines CSS/JS into one HTML file)
Makefile            Convenience wrapper around build.py
zettelium.html       Build output — the actual app, a single portable file
test/
  cases.js          Test cases (Node's built-in test runner)
  run.js            Concatenates pure-logic sources + cases.js and evaluates them
```

## Storage

- **Repositories**: each is a `FileSystemDirectoryHandle` persisted in IndexedDB (`zettelium` database) — the handle itself, not a copy of its contents. Permission is re-checked (never assumed) each time a repository is opened.
- **Notes**: plain text files on disk, in whatever repository folder they live in. The files are always the source of truth — the in-memory search index is a reconstructible projection, never authoritative data.
- **Settings**: IndexedDB `meta` store, plus a durable `zettelium.ini` mirror written to the primary (first-added) repository.
- **Cursor positions**: a small IndexedDB store, keyed by repository + note path.

Nothing is sent to any server.

## Related projects

Part of the same Zettelkasten app family as `zettelium-android` (the original Android app this is ported from) and `zettelium-tcl` (a planned Tcl/Tk desktop port).
