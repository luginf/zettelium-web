# Zettelium

A Zettelkasten note-taking app in [txt2tags](https://txt2tags.org/) syntax that runs as a single self-contained HTML file — no server, no install, no internet required. Open `zettelium.html` directly in a Chromium-based browser.

This is the web port of `zettelium-android`, built with the same single-file, no-bundler approach as [Writhdeck](https://github.com/luginf/writhdeck) (see [Build](#build)).

## Try it online

- [https://luginf.github.io/zettelium-web/zettelium.html](https://luginf.github.io/zettelium-web/zettelium.html)


## Features

- **Multiple repositories**: each one is a real folder on your disk, opened via the File System Access API — no data lives anywhere but your own filesystem. Give each one an identifying color (8 presets or any custom color) shown as a tint on the browser header.
- **txt2tags syntax** with live syntax highlighting and a real HTML preview, from a parser ported directly from the Android app's Kotlin implementation. Fenced code blocks support an optional language identifier (` ```lang `) and are colored like comments, both in the editor and the preview. Unordered lists also accept `*` as a markdown-style alias for `-` (a web-only addition).
- **Checklists**: `- [ ]` / `- [x]` items are rendered as real, clickable checkboxes in the preview, toggleable from the right-click menu in the editor too (list/checkbox toggle, indent/dedent, and Enter continues the current list marker automatically).
- **Zettelkasten linking**: `[[target|id]]` links, configurable ID generation format and detection pattern, a backlinks panel, a "jump to this note's own ID" action, and a link-repair action that fixes stale links after a rename/move. Follow a link straight from edit mode via the right-click menu, not just from the preview.
- **Right-click formatting menu**: heading levels 1-3, bold, italic, underline, strikethrough, comment, date insertion, list/checkbox toggling and indent/dedent, and inline expression evaluation (prefix, RPN, or infix arithmetic — select an expression and pick "Evaluate" to replace it with its result).
- **Search**: by name, content, or `#tag` (with a tag browser to pick from all tags in use), scoped to the active repository by default or toggled to search across every added repository, and covering all subfolders regardless of which one you're browsing. A separate in-note search (Ctrl+F) finds and jumps between matches inside the note currently open.
- **Favorites**: star any note from its actions menu; favorites survive renames and moves.
- **Subfolder navigation** within a repository, file-manager style.
- **Full note management**: create (from the toolbar or from any note's own folder), duplicate, rename, move (to another folder or repository), and delete notes directly from the browser.
- **External modification detection**: if a note changed on disk since you opened it, saving offers to overwrite, reload, or cancel instead of silently clobbering the change.
- **Cursor position** is remembered per note and restored when you reopen it.
- **Backups**: create a timestamped copy of a note on demand, and restore from its backup history.
- **8 built-in color schemes** (dark/light variants) plus a full custom-scheme editor.
- **Configurable editor typography**: font family/size, margins, line spacing — with direct numeric entry, not just +/- steppers. Heading size enlargement can be turned off (keeps heading color) if the cursor/selection ever look offset on a note with several headings.
- **Distraction-free mode**: hides the editor's header bar down to just the text, with an optional margin-magnification factor (1-5×) for a narrower reading column — toggle from the editor's "⋮" menu, exit with the floating button or Escape.
- **Customizable preview CSS**: the stylesheet that renders a note's preview is editable directly from Settings, stored in the browser, with a one-click reset back to the default.
- **Autosave** (opt-in, debounced, off by default).
- **Table of contents**: either a quick modal popup, or an optional persistent side panel that docks next to the editor.
- **Pinned file list** (opt-in): keeps the file browser visible as a sidebar next to the editor once you open a note, for quick navigation between notes.
- **FR/EN interface language**, following the system language or set explicitly.
- **Durable `.ini` config** written to the primary repository, so settings survive a browser data wipe (the repository folders themselves still need to be re-authorized once, a File System Access API constraint that can't be worked around).

### Which ID counts as "the" note's Zettelkasten ID?

If more than one string in a note matches the configured detection pattern, precedence is:

1. **The file name wins outright** if it matches — the note's body isn't even checked in that case.
2. Otherwise, existing `[[target|id]]` links are stripped from the body first (so a link *pointing at* another note's ID is never mistaken for this note's own ID), and the **first match found scanning the body top to bottom** is used.

Any other matching strings further down are silently ignored — there's no conflict warning.

## Build

```sh
make        # produces zettelium.html
make clean  # removes zettelium.html
make test   # runs the pure-logic test suite (Node.js, no browser needed)
```

`build.py` inlines `src/style.css` and all JS modules (in the order defined in `JS_ORDER`/`JS_SRCS`) into `src/template.html`. Python 3, no dependencies, no npm.

## Browser support

**Chromium-based browsers only** (Chrome, Edge, Brave, …). The File System Access API — the storage mechanism this app is built around, not an optional add-on — doesn't exist in Firefox or Safari. There is no degraded fallback mode.

**Brave-specific**: Brave ships with the File System Access API disabled by default (its own privacy setting, unrelated to this app). If you see "The File System Access API is not available in this browser", go to `brave://flags/#file-system-access-api`, set it to Enabled, and relaunch Brave.

## Project structure

```
src/
  template.html         HTML skeleton with {{STYLE}} / {{SCRIPT}} placeholders
  style.css              All CSS (custom properties for theming, no hardcoded colors)
  schemes.js             Built-in color schemes
  icons.js               Monochrome inline SVG icons
  i18n.js                FR/EN interface strings
  storage.js             IndexedDB wrapper (repositories, settings, cursors, favorites)
  fsa.js                 File System Access API helpers
  txt2tags/
    regexes.js           Shared regex bank (parser, highlighter, formatting all use this)
    ast.js               AST node constructors
    inline.js             Inline parser (bold/italic/links/images/...)
    parser.js             Block-level parser (headings, lists, tables, code blocks, ...)
    render.js             AST -> HTML for the real preview
    summary.js            Plain-text extraction / title detection
    toc.js                Table of contents extraction
    checklist.js          `- [ ]`/`- [x]` checkbox parsing/toggling
  zettelkasten.js        ID generation/detection, [[target|id]] links, link repair
  tags.js                #tag extraction
  math-eval.js           Prefix/RPN/infix expression evaluation (right-click "Evaluate")
  editor-formatting.js   Text-transform helpers for the right-click menu (bold, lists, ...)
  ini.js                 Durable config file parser/writer
  preview-style.js       Default preview CSS (editable copy lives in settings)
  state.js               App state, settings, repository registry
  highlight.js           Editor syntax highlighting (shares the parser's regexes)
  index.js               In-memory search index (name/content/tag), incremental scan
  themes.js              Custom color scheme persistence
  backup.js              Timestamped note backups
  repositories.js        Repository list screen, per-repository color tag
  settings.js            Global settings screen
  theme-editor.js        Color scheme list/editor screens
  browser.js             File browser for the active repository, search, tag browser
  editor.js              Note editor: textarea+overlay highlighting, preview, TOC, backlinks
  app.js                 Entry point, theming, initialization
build.py                 Build script (inlines CSS/JS into one HTML file)
Makefile                 Convenience wrapper around build.py
zettelium.html            Build output — the actual app, a single portable file
test/
  cases.js               Test cases (Node's built-in test runner)
  run.js                 Concatenates pure-logic sources + cases.js and evaluates them
```

## Storage

- **Repositories**: each is a `FileSystemDirectoryHandle` persisted in IndexedDB (`zettelium` database) — the handle itself, not a copy of its contents. Permission is re-checked (never assumed) each time a repository is opened. A repository's color tag is IndexedDB-only (not part of the durable `.ini` export).
- **Notes**: plain text files on disk, in whatever repository folder they live in. The files are always the source of truth — the in-memory search index is a reconstructible projection, never authoritative data.
- **Settings**: IndexedDB `meta` store, plus a durable `zettelium.ini` mirror written to the primary (first-added) repository. The custom preview CSS is IndexedDB-only (multi-line CSS doesn't fit the `.ini` file's `key = value` format).
- **Cursor positions** and **favorites**: small IndexedDB stores, keyed by repository + note path.

Nothing is sent to any server.

## Related projects

Part of the same Zettelkasten app family as `zettelium-android` (the original Android app this is ported from) and `zettelium-tcl` (a planned Tcl/Tk desktop port).

**Related project:** [WrithDeck](https://github.com/luginf/writhdeck) is a separate distraction-free text editor — not a Zettelkasten app, but a parallel project built the same way (single self-contained HTML file, no server, no bundler) and fully compatible with Zettelium's plain-text/txt2tags notes, so the same files can be opened and edited in either app.
