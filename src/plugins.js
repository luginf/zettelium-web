'use strict';
// Système de greffons JS pour Zettelium — première version, voir
// ~/src/zettelium/zettelium-plugins/CLAUDE.md (choix du langage, esquisse de
// l'architecture). Un script placé dans le sous-dossier `plugins/` du dépôt
// (dossier "neutre" — voir `FSA.PLUGINS_DIR_NAME` — pas exclu de la
// navigation/l'indexation, contrairement à `backups/`) assigne un objet
// global `Plugin` :
//
//   var Plugin = {
//     name: "Majuscules",
//     action: function(text) { return text.toUpperCase(); }
//   };
//
// Exécuté dans un Web Worker isolé (créé depuis une URL Blob — pas de fichier
// séparé à servir, cohérent avec le reste de l'appli : un seul `zettelium
// .html` autonome) : aucun accès au DOM ni à la page hôte, seule la fonction
// `action` communique via `postMessage`. Contrairement à QuickJS côté
// Android (zettelium-android's `plugin/PluginHost.kt`), un Worker garde un
// accès réseau (`fetch`/`XMLHttpRequest`) par défaut — limite connue de
// cette v1, voir la section "Questions ouvertes" du CLAUDE.md des greffons.
//
// `action(text, cursor)` reçoit aussi la position du curseur (second
// paramètre, décalage de caractère dans `text`) — un greffon qui n'en a pas
// besoin peut l'ignorer. Pour repositionner le curseur après application, le
// greffon peut inclure UNE FOIS `CURSOR_MARKER` dans le texte renvoyé (voir
// `stripCursorMarker` ci-dessous) — même convention qu'Android
// (`PLUGIN_CURSOR_MARKER`, `ui/PluginCursor.kt`).
//
// Contrat v2 (voir le CLAUDE.md des greffons) : `Plugin.choices` ([{id, label}]) demande un
// choix à l'utilisateur après sélection du greffon, `action(text, cursor, selection, choice)`
// reçoit la sélection et le choix, et peut renvoyer autre chose qu'un texte :
// `{message: "..."}` ou `{display: {kind: 'matrix'|'bars', title, caption, modules: ['0101', ...]}}`
// (voir `normalizeResult`, `drawDisplay`).
const Plugins = (() => {
  const CURSOR_MARKER = '{{cursor}}';

  /** Normalise le retour de `Plugin.action` en `{kind: 'text', text}`, `{kind: 'message', text}`
   *  ou `{kind: 'display', bars, title, caption, modules}` ; `null` si inexploitable. Écrite
   *  SANS référence extérieure : elle est aussi injectée telle quelle (`toString`) dans le
   *  Worker. */
  function normalizeResult(r) {
    if (typeof r === 'string') return { kind: 'text', text: r };
    if (!r || typeof r !== 'object') return null;
    if (typeof r.message === 'string') return { kind: 'message', text: r.message };
    const d = r.display;
    if (d && d.kind === 'html' && typeof d.html === 'string') {
      return { kind: 'html', title: String(d.title == null ? '' : d.title).replace(/[\r\n]+/g, ' '), html: d.html };
    }
    if (!d || !Array.isArray(d.modules)) return null;
    const modules = d.modules.map(String).filter(line => /^[01]+$/.test(line));
    if (modules.length === 0) return null;
    const flat = value => String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
    return { kind: 'display', bars: d.kind === 'bars', title: flat(d.title), caption: flat(d.caption), modules };
  }

  /** `Plugin.choices` nettoyé en `[{id, label}]` (vide si absent/invalide). Même remarque que
   *  `normalizeResult` : injectée dans le Worker. */
  function normalizeChoices(choices, lang) {
    if (!Array.isArray(choices)) return [];
    const loc = (v, l) => {
      if (v && typeof v === 'object') {
        let r = v[l] != null ? v[l] : v.en;
        if (r == null) for (const k in v) { r = v[k]; break; }
        return r;
      }
      return v;
    };
    return choices
      .filter(c => c && c.id != null)
      .map(c => {
        const label = loc(c.label, lang);
        return { id: String(c.id), label: String(label == null ? c.id : label) };
      });
  }

  /** Retire `CURSOR_MARKER` de `result` s'il est présent (seule la première occurrence
   *  compte) et calcule la position de curseur correspondante ; sinon renvoie
   *  `{text: result, cursor: fallbackCursor}` inchangé. */
  function stripCursorMarker(result, fallbackCursor) {
    const index = result.indexOf(CURSOR_MARKER);
    if (index < 0) return { text: result, cursor: fallbackCursor };
    return { text: result.slice(0, index) + result.slice(index + CURSOR_MARKER.length), cursor: index };
  }

  /** Greffons (`.js`) trouvés dans le sous-dossier `plugins/` du dépôt, ou `[]` s'il
   *  n'existe pas encore. */
  async function list(repo) {
    let pluginsDir;
    try {
      pluginsDir = await repo.dirHandle.getDirectoryHandle(FSA.PLUGINS_DIR_NAME);
    } catch (_) {
      return [];
    }
    const plugins = [];
    for await (const [name, handle] of pluginsDir.entries()) {
      if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.js')) continue;
      plugins.push({ name, fileHandle: handle });
    }
    plugins.sort((a, b) => a.name.localeCompare(b.name));
    return plugins;
  }

  // Code exécuté À L'INTÉRIEUR du Worker — reçoit `{source, text}`, exécute le script
  // via un eval INDIRECT (`(0, eval)(...)`, assigne `Plugin` dans la portée globale du
  // Worker lui-même — isolée de la page — plutôt que la portée locale de cette fonction),
  // renvoie `{result}` (texte transformé, ou `null` si `Plugin`/`Plugin.action` est
  // absent ou a levé une exception) — jamais d'exception qui remonterait comme une erreur
  // Worker non gérée.
  const WORKER_BODY = `
    var normalizeResult = ${normalizeResult.toString()};
    self.onmessage = function (e) {
      var d = e.data;
      var result = null;
      try {
        (0, eval)(d.source);
        if (typeof Plugin !== 'undefined' && typeof Plugin.action === 'function') {
          result = normalizeResult(Plugin.action(d.text, d.cursor, d.selection, d.choice, d.lang));
        }
      } catch (err) {
        result = null;
      }
      self.postMessage({ result: result });
    };
  `;

  /**
   * Exécute `source` (le texte d'un greffon) sur `text` (à partir de `cursor`, la position
   * du curseur au moment de l'appel) dans un Worker jetable — un par appel, jamais réutilisé
   * entre deux exécutions (même principe que `PluginHost` côté Android : pas de mémoire
   * persistante d'un appel à l'autre). `selection` = texte sélectionné, `choice` = id choisi
   * parmi `Plugin.choices`. Résout `null` en cas d'échec (exception JS,
   * `Plugin`/`Plugin.action` absent, ou délai dépassé — un greffon qui boucle indéfiniment ne
   * doit pas bloquer l'éditeur).
   */
  function runAction(source, text, cursor, selection = '', choice = '', lang = 'en') {
    return new Promise(resolve => {
      const blobUrl = URL.createObjectURL(new Blob([WORKER_BODY], { type: 'application/javascript' }));
      const worker = new Worker(blobUrl);
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 5000);
      worker.onmessage = e => {
        clearTimeout(timeout);
        finish(e.data.result || null);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        finish(null);
      };
      worker.postMessage({ source, text, cursor, selection, choice, lang });
    });
  }

  // Même sandbox/Worker jetable que `runAction` (pas d'`eval` en dehors), pour lire
  // `Plugin.name` et `Plugin.choices` sans exécuter `action` - le nom est affiché dans le menu
  // "Greffons" à la place du nom de fichier (voir `EditorScreen` côté Android,
  // `PluginHost.readName`). `{name: null, choices: []}` si absent/invalide/délai dépassé.
  const METADATA_WORKER_BODY = `
    var normalizeChoices = ${normalizeChoices.toString()};
    self.onmessage = function (e) {
      var name = null, choices = [];
      try {
        (0, eval)(e.data.source);
        if (typeof Plugin !== 'undefined') {
          // Plugin.name (chaîne ou {en, fr}) : passe par le même résolveur que les libellés.
          var n = normalizeChoices([{ id: 'n', label: Plugin.name }], e.data.lang)[0].label;
          if (Plugin.name != null) name = n;
          choices = normalizeChoices(Plugin.choices, e.data.lang);
        }
      } catch (err) {
        name = null;
        choices = [];
      }
      self.postMessage({ name: name, choices: choices });
    };
  `;

  function readMetadata(source, lang = 'en') {
    return new Promise(resolve => {
      const blobUrl = URL.createObjectURL(new Blob([METADATA_WORKER_BODY], { type: 'application/javascript' }));
      const worker = new Worker(blobUrl);
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
        resolve(value);
      };
      const timeout = setTimeout(() => finish({ name: null, choices: [] }), 5000);
      worker.onmessage = e => {
        clearTimeout(timeout);
        const name = typeof e.data.name === 'string' ? e.data.name.trim() : '';
        finish({ name: name || null, choices: e.data.choices || [] });
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        finish({ name: null, choices: [] });
      };
      worker.postMessage({ source, lang });
    });
  }

  /** Page complète d'un greffon `html` : le corps fourni par le greffon est enveloppé dans un
   *  document portant une CSP stricte (scripts/styles inline seulement, aucun réseau) - un
   *  greffon HTML ne doit pas rouvrir l'accès réseau qu'un Worker nu aurait déjà. Affichée dans
   *  une iframe `sandbox="allow-scripts"` (origine opaque, aucun accès à la page hôte). */
  function htmlDocument(body) {
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:";
    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
      + '</head><body>' + body + '</body></html>';
  }

  /** Dessine un résultat `display` dans `canvas` : noir sur blanc quel que soit le thème, zone
   *  de silence autour (QR : 4 modules, code-barres : 10), taille de module entière pour des
   *  bords nets. */
  function drawDisplay(canvas, display, box) {
    const quiet = display.bars ? 10 : 4;
    const cols = display.modules[0].length + 2 * quiet;
    const rows = display.bars ? 1 : display.modules.length + 2 * quiet;
    // `box` ({width, height}, plein écran) : on remplit la zone ; un code-barres s'allonge sur
    // tout l'écran en paysage et garde son rapport 2:1 en portrait.
    const maxWidth = box ? box.width : display.bars ? 480 : 360;
    const scale = Math.max(1, Math.floor(box && !display.bars ? Math.min(box.width / cols, box.height / rows) : maxWidth / cols));
    const width = cols * scale;
    const height = display.bars
      ? (box ? (box.width > box.height ? box.height : Math.min(box.height, Math.round(width * 0.5))) : Math.round(width * 0.5))
      : rows * scale;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    display.modules.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (line[x] !== '1') continue;
        if (display.bars) ctx.fillRect((x + quiet) * scale, 0, scale, y === 0 && display.modules.length > 1 ? Math.round(height * 0.85) : height);
        else ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    });
  }

  return { list, runAction, readMetadata, drawDisplay, htmlDocument, normalizeResult, normalizeChoices, stripCursorMarker };
})();
