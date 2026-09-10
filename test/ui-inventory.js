#!/usr/bin/env node
'use strict';
// Dump de l'arbre d'accessibilité (CDP `Accessibility.getFullAXTree`) de l'éditeur de note
// — pilote d'un inventaire d'UI comparable à celui des ports Android/desktop (qui, eux,
// dument l'arbre `SemanticsNode` de Compose, la même famille d'API). Demande explicite de
// l'utilisateur, pour fiabiliser le portage.
//
// Même technique CDP brute que le round 19bis (voir CLAUDE.md) : PAS de Puppeteer/
// Playwright (convention déjà établie dans ce projet), client CDP écrit à la main sur le
// `WebSocket` global de Node 22, `Editor.open()` piloté avec un `dirHandle`/`fileHandle`
// factices — la vraie File System Access API ne peut pas être automatisée en headless (pas
// de vrai geste utilisateur pour le sélecteur de dossier).
//
// Usage : `node test/ui-inventory.js` depuis la racine du projet — lance un Brave headless,
// charge `zettelium.html` en `file://`, ouvre l'éditeur sur une note de test, dump l'arbre
// d'accessibilité dans `test/ui-inventory-output/web-EditorScreen.txt`, ferme le navigateur.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HTML_PATH = path.join(__dirname, '..', 'zettelium.html');
const OUTPUT_DIR = path.join(__dirname, 'ui-inventory-output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'web-EditorScreen.txt');
const BROWSER_BIN = process.env.ZETTELIUM_BROWSER || 'brave-browser';
const DEBUG_PORT = 9333;

const NOTE_CONTENT = `= Titre =
Un paragraphe avec **gras** et //italique//.

== Sous-titre ==
- [ ] Une case à cocher
- Un item de liste
`;

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    require('node:http').get(url, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForDebuggerPort(port, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await httpGetJson(`http://127.0.0.1:${port}/json/version`);
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`Le port de debug CDP ${port} n'a jamais répondu (navigateur pas démarré ?)`);
}

// Client CDP minimal : un WebSocket + une map id -> {resolve, reject}, comme round 19bis.
class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else resolve(msg.result);
      }
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

// Construit le harnais dans la page (repo + fichier factices, voir round 19bis) puis ouvre
// l'éditeur — exécuté via `Runtime.evaluate` (même contexte global que la console DevTools :
// `State`/`Editor`/`FSA` sont des `const` de premier niveau, donc directement accessibles,
// voir build.py "chaque module s'assigne à des const globales, pas de modules ES").
function buildHarnessExpression(noteContent) {
  const encoded = JSON.stringify(noteContent);
  return `(async () => {
    const NOTE_CONTENT = ${encoded};
    const fakeFileHandle = {
      kind: 'file',
      name: 'note.txt',
      async getFile() {
        return { lastModified: Date.now(), text: async () => NOTE_CONTENT };
      },
    };
    const fakeDirHandle = {
      kind: 'directory',
      name: 'repo-pilote',
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      async *entries() {},
    };
    // Injection directe dans State (PAS addRepository(), qui persiste en IndexedDB via
    // structured clone — échouerait sur ce faux handle qui porte des méthodes, non
    // clonables). Un inventaire d'UI n'a besoin d'aucune persistance réelle.
    State.repositories.push({
      id: 'ui-inventory-repo',
      name: 'repo-pilote',
      dirHandle: fakeDirHandle,
      order: 0,
      colorTag: null,
      includeExtensionInLinks: false,
      permission: 'granted',
    });
    State.activeRepositoryId = 'ui-inventory-repo';

    const fakeFile = {
      path: 'note.txt',
      name: 'note.txt',
      fileHandle: fakeFileHandle,
      lastModified: Date.now(),
      size: NOTE_CONTENT.length,
    };
    await Editor.open(fakeFile);
    return document.title;
  })()`;
}

// Aplatit l'arbre d'accessibilité (liste plate de `AXNode` + `childIds`) en un texte
// indenté — même esprit que le dump `SemanticsNode` côté desktop (`EditorScreenSemanticsTest`).
function dumpAxTree(nodes) {
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const childIds = new Set();
  for (const n of nodes) for (const c of n.childIds || []) childIds.add(c);
  const roots = nodes.filter(n => !childIds.has(n.nodeId));

  const KEEP_PROPS = new Set([
    'focusable', 'focused', 'editable', 'checked', 'expanded', 'selected',
    'disabled', 'required', 'invalid', 'level', 'valuemin', 'valuemax', 'valuetext',
  ]);

  const lines = [];
  function render(node, indent) {
    if (!node) return;
    // Un nœud `ignored` (présentational pour l'accessibilité) n'implique PAS que ses
    // descendants le sont aussi — vérifié faux sur un cas réel : le wrapper racine de
    // toute l'appli est lui-même `ignored` alors que tout ce qu'il contient, éditeur
    // compris, est exposé normalement en dessous. Ne PAS l'imprimer, mais TOUJOURS
    // continuer à descendre à la même indentation (ce nœud "n'existe pas" dans la sortie,
    // mais ses enfants si). Un sous-arbre réellement sans rien d'exposé (ex. l'écran de
    // dépôts caché derrière l'éditeur, `hidden` en CSS) ne produit alors naturellement
    // aucune ligne, sans avoir besoin de le savoir à l'avance.
    if (node.ignored) {
      for (const childId of node.childIds || []) {
        render(byId.get(childId), indent);
      }
      return;
    }
    const role = node.role && node.role.value;
    const name = node.name && node.name.value;
    const value = node.value && node.value.value;
    const props = (node.properties || [])
      .filter(p => KEEP_PROPS.has(p.name))
      .map(p => `${p.name}=${p.value && p.value.value}`);
    const parts = [];
    if (role) parts.push(`role=${role}`);
    if (name) parts.push(`name="${String(name).slice(0, 80)}"`);
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`value="${String(value).replace(/\n/g, '\\n').slice(0, 80)}"`);
    }
    parts.push(...props);
    lines.push(`${indent}- [${node.nodeId}] ${parts.join(', ')}`);
    for (const childId of node.childIds || []) {
      const child = byId.get(childId);
      // `InlineTextBox` : détail d'implémentation Chrome (segmentation caractère par
      // caractère pour les lecteurs d'écran), toujours une feuille qui répète exactement
      // le nom de son parent `StaticText`/`LineBreak` — bruit pur pour un inventaire
      // structurel, jamais d'information supplémentaire.
      if (child && child.role && child.role.value === 'InlineTextBox') continue;
      render(child, indent + '  ');
    }
  }
  roots.forEach(r => render(r, ''));
  return lines.join('\n') + '\n';
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'zettelium-ui-inventory-'));

  // `detached: true` : place le navigateur dans son propre groupe de process — Chromium
  // lance plusieurs sous-process (zygote/gpu/renderer/crashpad) qui ne meurent pas tous de
  // façon fiable en tuant seulement le PID direct (confirmé : le premier essai de ce script
  // s'est terminé avec succès mais le process Node ne rendait jamais la main). Tuer le
  // groupe entier (PID négatif) est la façon robuste de tout nettoyer.
  const browser = spawn(BROWSER_BIN, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });

  let browserStderr = '';
  browser.stderr.on('data', chunk => { browserStderr += chunk; });

  try {
    await waitForDebuggerPort(DEBUG_PORT);
    const targets = await httpGetJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error(`Aucune target de type "page" trouvée : ${JSON.stringify(targets)}`);

    const client = new CdpClient(page.webSocketDebuggerUrl);
    await client.ready();

    await client.send('Runtime.enable');
    await client.send('Page.enable');
    // Attend le chargement complet (le fichier local est petit, mais évite une course avec
    // Runtime.evaluate arrivant avant que `zettelium.html` n'ait fini d'exécuter ses
    // <script> de premier niveau qui déclarent State/Editor/FSA).
    await new Promise(resolve => {
      client.send('Page.navigate', { url: `file://${HTML_PATH}` }).then(() => {
        const onEvent = event => {
          const msg = JSON.parse(event.data);
          if (msg.method === 'Page.loadEventFired') {
            client.ws.removeEventListener('message', onEvent);
            resolve();
          }
        };
        client.ws.addEventListener('message', onEvent);
      });
    });

    const evalResult = await client.send('Runtime.evaluate', {
      expression: buildHarnessExpression(NOTE_CONTENT),
      awaitPromise: true,
      returnByValue: true,
    });
    if (evalResult.exceptionDetails) {
      throw new Error(`Échec du harnais dans la page : ${JSON.stringify(evalResult.exceptionDetails)}`);
    }

    await client.send('Accessibility.enable');
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const dump = dumpAxTree(nodes);
    fs.writeFileSync(OUTPUT_FILE, dump, 'utf-8');
    console.log(`Inventaire écrit dans ${OUTPUT_FILE} (${nodes.length} nœuds)`);

    client.close();
  } catch (e) {
    console.error('ui-inventory.js a échoué :', e.message);
    if (browserStderr) console.error('--- stderr du navigateur ---\n' + browserStderr);
    process.exitCode = 1;
  } finally {
    try { process.kill(-browser.pid, 'SIGKILL'); } catch (e) { /* déjà mort */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(process.exitCode || 0));
