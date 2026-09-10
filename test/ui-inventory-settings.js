#!/usr/bin/env node
'use strict';
// Même famille que test/ui-inventory.js et test/ui-inventory-browser.js : dump de l'arbre
// d'accessibilité CDP de l'écran RÉGLAGES (settings-screen), troisième écran de l'inventaire
// d'UI comparable Android/desktop/web (demande explicite de l'utilisateur, round "autres
// écrans"). Le plus simple des trois : `Settings.open()` ne dépend d'aucun dépôt/fichier.
//
// Voir ui-inventory.js pour le détail des pièges CDP déjà résolus (pas de Puppeteer/
// Playwright, tuer le GROUPE de process, `ignored` != descendants ignorés) — non reproduit
// ici, juste réappliqué.
//
// Usage : `node test/ui-inventory-settings.js` depuis la racine du projet.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HTML_PATH = path.join(__dirname, '..', 'zettelium.html');
const OUTPUT_DIR = path.join(__dirname, 'ui-inventory-output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'web-SettingsScreen.txt');
const BROWSER_BIN = process.env.ZETTELIUM_BROWSER || 'brave-browser';
const DEBUG_PORT = 9335; // port distinct des deux autres scripts

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

function buildHarnessExpression() {
  return `(async () => {
    Settings.open('repo-screen');
    // Voir ui-inventory-browser.js : \`I18n.apply()\` dépend normalement du vrai flux de
    // démarrage async (\`App.init()\`/\`loadState()\`), pas garanti terminé dans ce harnais
    // minimal — rappel explicite, idempotent.
    I18n.apply();
    return document.title;
  })()`;
}

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
      expression: buildHarnessExpression(),
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
    console.error('ui-inventory-settings.js a échoué :', e.message);
    if (browserStderr) console.error('--- stderr du navigateur ---\n' + browserStderr);
    process.exitCode = 1;
  } finally {
    try { process.kill(-browser.pid, 'SIGKILL'); } catch (e) { /* déjà mort */ }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().then(() => process.exit(process.exitCode || 0));
