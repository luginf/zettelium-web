'use strict';
// Minimal INI parser/writer for zettelium's durable config file
// (`zettelium.ini`, written to the primary repository — see state.js
// `scheduleDurableExport()`/`writeDurableConfig()`).
//
// NOT a port of writhdeck-web's `ini.js`: that file's parse/write logic is
// tightly coupled to writhdeck's own settings (schemes, profiles, timer,
// margins...), none of which apply to zettelium — reusing it verbatim would
// import a pile of dead, confusing mappings for settings this app doesn't
// have. Kept the same *format* (`[section]` + `key = value`, `%`/`#`
// comments) for stylistic consistency with the writerdeck family and so the
// file stays human-readable/editable, but the content is new.
const INI = (() => {
  const KEY_MAP = {
    note_extensions:                 ['noteExtensions', 'str'],
    note_extensions_filter_disabled: ['noteExtensionsFilterDisabled', 'bool'],
    note_sort_order:                 ['noteSortOrder', 'str'],
    id_pattern:                      ['idPattern', 'str'],
    id_generation_format:            ['idGenerationFormat', 'str'],
    scheme:                          ['scheme', 'str'],
    theme_mode:                      ['themeMode', 'str'],
    language:                        ['language', 'str'],
    editor_font_family:              ['editorFontFamily', 'str'],
    editor_font_size:                ['editorFontSize', 'int'],
    editor_margin_x:                 ['editorMarginX', 'int'],
    editor_margin_y:                 ['editorMarginY', 'int'],
    editor_line_spacing:             ['editorLineSpacing', 'float'],
    autosave_enabled:                ['autosaveEnabled', 'bool'],
    toc_sidebar_mode:                ['tocSidebarMode', 'bool'],
  };
  const REVERSE_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, [jsKey]]) => [jsKey, k]));

  function parseBool(v) {
    return /^(yes|1|true|on)$/i.test(String(v).trim());
  }

  // Strips inline comments (# preceded by whitespace); leading whitespace
  // trimmed, trailing preserved (same convention as writhdeck-web's ini.js,
  // in case a value ever needs a meaningful trailing space).
  function stripComment(v) {
    return v.replace(/\s+#.*$/, '').replace(/^\s+/, '');
  }

  function parse(text) {
    const settings = {};
    let knownRepositories = [];
    let section = '';
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('%')) continue;

      const secMatch = line.match(/^\[([^[\]]+)\]$/);
      if (secMatch) { section = secMatch[1].trim(); continue; }

      const kvMatch = line.match(/^(\w+)\s*=(.*)$/);
      if (!kvMatch) continue;
      const key = kvMatch[1].trim();
      const val = stripComment(kvMatch[2]);

      if (section === 'repositories' && key === 'known') {
        knownRepositories = val.split('|').map(s => s.trim()).filter(Boolean);
        continue;
      }
      if (section !== 'general') continue;
      const mapping = KEY_MAP[key];
      if (!mapping) continue;
      const [jsKey, type] = mapping;
      if (type === 'bool') settings[jsKey] = parseBool(val);
      else if (type === 'int') settings[jsKey] = parseInt(val, 10);
      else if (type === 'float') settings[jsKey] = parseFloat(val);
      else settings[jsKey] = val;
    }
    return { settings, knownRepositories };
  }

  // `repositoryNames` is purely informational (see state.js
  // maybeRestoreDurableConfig — repositories themselves are never
  // auto-recreated from this list, only shown to the user as a reminder of
  // what to re-add via the folder picker).
  function stringify(settings, repositoryNames) {
    const lines = ['[general]'];
    for (const [jsKey, iniKey] of Object.entries(REVERSE_MAP)) {
      const value = settings[jsKey];
      if (value === undefined) continue;
      lines.push(`${iniKey} = ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`);
    }
    lines.push('', '[repositories]', `known = ${repositoryNames.join(' | ')}`);
    return lines.join('\n') + '\n';
  }

  return { parse, stringify };
})();
