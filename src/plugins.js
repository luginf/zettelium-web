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
const Plugins = (() => {
  const CURSOR_MARKER = '{{cursor}}';

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
    self.onmessage = function (e) {
      var source = e.data.source, text = e.data.text, cursor = e.data.cursor;
      var result = null;
      try {
        (0, eval)(source);
        if (typeof Plugin !== 'undefined' && typeof Plugin.action === 'function') {
          result = Plugin.action(text, cursor);
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
   * persistante d'un appel à l'autre). Résout `null` en cas d'échec (exception JS,
   * `Plugin`/`Plugin.action` absent, ou délai dépassé — un greffon qui boucle indéfiniment ne
   * doit pas bloquer l'éditeur).
   */
  function runAction(source, text, cursor) {
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
        finish(typeof e.data.result === 'string' ? e.data.result : null);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        finish(null);
      };
      worker.postMessage({ source, text, cursor });
    });
  }

  // Même sandbox/Worker jetable que `runAction` (pas d'`eval` en dehors), pour lire
  // `Plugin.name` sans exécuter `action` — affiché dans le menu "Greffons" à la place du
  // nom de fichier (voir `EditorScreen` côté Android, `PluginHost.readName`). `null` si
  // absent/invalide/délai dépassé.
  const METADATA_WORKER_BODY = `
    self.onmessage = function (e) {
      var source = e.data.source;
      var name = null;
      try {
        (0, eval)(source);
        if (typeof Plugin !== 'undefined' && typeof Plugin.name === 'string') {
          name = Plugin.name;
        }
      } catch (err) {
        name = null;
      }
      self.postMessage({ name: name });
    };
  `;

  function readName(source) {
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
      const timeout = setTimeout(() => finish(null), 5000);
      worker.onmessage = e => {
        clearTimeout(timeout);
        const name = typeof e.data.name === 'string' ? e.data.name.trim() : '';
        finish(name || null);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        finish(null);
      };
      worker.postMessage({ source });
    });
  }

  return { list, runAction, readName, stripCursorMarker };
})();
