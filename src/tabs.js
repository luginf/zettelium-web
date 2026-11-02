'use strict';
// Onglets de notes (barre en bas de l'éditeur). Un seul éditeur existe à la fois : l'onglet
// actif est la note affichée, les autres sont une simple liste (dépôt + chemin) rouverte à la
// demande. Contenu non enregistré, curseur : gérés par Editor à chaque changement de note.
const Tabs = (() => {
  const MAX = 10;
  const el = id => document.getElementById(id);
  let _tabs = [];          // [{repoId, path, name}]
  let _active = null;      // clé de l'onglet actif
  const keyOf = (repoId, path) => `${repoId}::${path}`;
  const tabKey = t => keyOf(t.repoId, t.path);

  let _resolveReady;
  const _ready = new Promise(r => { _resolveReady = r; });

  async function load() {
    try {
      const s = await Storage.getMeta('openTabs');
      if (s && Array.isArray(s.tabs)) {
        _tabs = s.tabs.filter(t => t && t.repoId && t.path);
        _active = s.active || null;
      }
    } catch (e) { /* pas d'onglets mémorisés */ }
    _resolveReady();
    render();
  }

  function persist() {
    Storage.setMeta('openTabs', { tabs: _tabs, active: _active }).catch(() => {});
  }

  // L'éditeur n'affiche plus aucune note (fermé) : plus d'onglet actif.
  function noteClosed() {
    _active = null;
    persist();
    render();
  }

  // Appelé par Editor.open() une fois la note affichée. mode : 'replace' (suivi de lien,
  // renommage : remplace l'onglet de [prevPath]), sinon ajoute l'onglet s'il n'existe pas.
  // Un remplacement par une note déjà ouverte ailleurs ferme simplement l'ancien onglet.
  async function noteOpened(repoId, file, mode, prevPath, prevRepoId) {
    await _ready;
    const tab = { repoId, path: file.path, name: file.name };
    const key = tabKey(tab);
    const existing = _tabs.findIndex(t => tabKey(t) === key);
    const prevIndex = mode === 'replace' && prevPath ? _tabs.findIndex(t => tabKey(t) === keyOf(prevRepoId || repoId, prevPath)) : -1;
    if (prevIndex >= 0 && prevIndex !== existing) {
      if (existing >= 0) _tabs.splice(prevIndex, 1); else _tabs[prevIndex] = tab;
    } else if (existing >= 0) {
      _tabs[existing] = tab;
    } else {
      _tabs.push(tab);
      while (_tabs.length > MAX) {
        const victim = _tabs.findIndex(t => tabKey(t) !== key);
        _tabs.splice(victim, 1);
      }
    }
    _active = key;
    persist();
    render();
  }

  // Renommage/déplacement d'une note ailleurs que dans l'éditeur (navigateur).
  function rekey(oldRepoId, oldPath, newRepoId, newPath, newName) {
    const i = _tabs.findIndex(t => tabKey(t) === keyOf(oldRepoId, oldPath));
    if (i < 0) return;
    const newTab = { repoId: newRepoId, path: newPath, name: newName || newPath.split('/').pop() };
    const dup = _tabs.findIndex(t => tabKey(t) === tabKey(newTab));
    if (_active === keyOf(oldRepoId, oldPath)) _active = tabKey(newTab);
    if (dup >= 0 && dup !== i) _tabs.splice(i, 1); else _tabs[i] = newTab;
    persist();
    render();
  }

  function removePath(repoId, path) {
    const key = keyOf(repoId, path);
    const i = _tabs.findIndex(t => tabKey(t) === key);
    if (i < 0) return;
    _tabs.splice(i, 1);
    if (_active === key) _active = null;
    persist();
    render();
  }

  // Retrouve le fichier d'un onglet en descendant les dossiers du dépôt (l'index peut ne pas
  // être prêt au lancement).
  async function resolveFile(tab) {
    const repo = State.repositories.find(r => r.id === tab.repoId);
    if (!repo) return null;
    if (repo.permission !== 'granted') return 'unavailable';
    try {
      const segments = tab.path.split('/');
      const name = segments.pop();
      let dir = repo.dirHandle;
      for (const seg of segments) dir = await dir.getDirectoryHandle(seg);
      const fileHandle = await dir.getFileHandle(name);
      const f = await fileHandle.getFile();
      return { path: tab.path, name, fileHandle, lastModified: f.lastModified };
    } catch (e) {
      // Seule une vraie absence retire l'onglet ; permission perdue/erreur transitoire : on le garde.
      return e && e.name === 'NotFoundError' ? null : 'unavailable';
    }
  }

  async function openTab(tab, mode) {
    const file = await resolveFile(tab);
    if (file === 'unavailable') {
      alert(I18n.t('editor.tabUnavailable'));
      return false;
    }
    if (!file) {
      removePath(tab.repoId, tab.path);
      return false;
    }
    if (tab.repoId !== State.activeRepositoryId) {
      State.activeRepositoryId = tab.repoId;
      await scanActiveRepo();
    }
    await Editor.openOther(file, { tabMode: mode });
    return true;
  }

  async function activate(tab) {
    if (tabKey(tab) === _active) return;
    await openTab(tab, 'activate');
  }

  async function close(tab) {
    const key = tabKey(tab);
    if (key !== _active) {
      _tabs = _tabs.filter(t => tabKey(t) !== key);
      persist();
      render();
      return;
    }
    const i = _tabs.findIndex(t => tabKey(t) === key);
    const neighbour = _tabs[i + 1] || _tabs[i - 1];
    if (neighbour) {
      // Remplacer l'onglet actif par un onglet déjà ouvert = le fermer (voir noteOpened).
      await openTab(neighbour, 'replace');
    } else if (await Editor.requestClose()) {
      _tabs = [];
      _active = null;
      persist();
      render();
    }
  }

  function render() {
    const bar = el('ed-tabbar');
    if (!bar) return;
    bar.hidden = _tabs.length < 2;
    bar.innerHTML = '';
    for (const tab of _tabs) {
      const item = document.createElement('div');
      item.className = 'ed-tab' + (tabKey(tab) === _active ? ' active' : '');
      item.title = tab.path;
      const label = document.createElement('span');
      label.className = 'ed-tab-label';
      label.textContent = tab.name;
      const x = document.createElement('button');
      x.className = 'ed-tab-close';
      x.textContent = '✕';
      x.title = I18n.t('editor.tabClose');
      x.addEventListener('click', e => { e.stopPropagation(); close(tab); });
      item.addEventListener('click', () => activate(tab));
      // Clic milieu = fermer, comme un navigateur.
      item.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); close(tab); } });
      item.append(label, x);
      bar.appendChild(item);
    }
    const active = bar.querySelector('.ed-tab.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function init() {
    document.addEventListener('i18n:apply', render);
    load();
  }

  return { init, noteOpened, noteClosed, rekey, removePath };
})();
