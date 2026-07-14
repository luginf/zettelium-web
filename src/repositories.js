'use strict';
// Repository list screen — add/remove/reorder/reauthorize repositories,
// and open a repository into the file browser (browser.js).
const Repositories = (() => {
  function el(id) { return document.getElementById(id); }

  function render() {
    const list = el('repo-list');
    list.innerHTML = '';

    if (!State.repositories.length) {
      el('repo-empty-hint').hidden = false;
      return;
    }
    el('repo-empty-hint').hidden = true;

    State.repositories.forEach((repo, idx) => {
      const item = document.createElement('div');
      item.className = 'repo-item';
      if (repo.colorTag) item.style.borderLeftColor = repo.colorTag;

      const name = document.createElement('span');
      name.className = 'repo-item-name';
      name.textContent = repo.name;
      item.appendChild(name);

      if (repo.permission !== 'granted') {
        const badge = document.createElement('button');
        badge.className = 'repo-item-reauth';
        badge.textContent = 'Ré-autoriser';
        badge.title = 'La permission d\'accès à ce dossier a expiré ou a été révoquée';
        badge.addEventListener('click', async e => {
          e.stopPropagation();
          await reauthorize(repo);
        });
        item.appendChild(badge);
      }

      const actions = document.createElement('span');
      actions.className = 'repo-item-actions';

      const upBtn = document.createElement('button');
      upBtn.textContent = '↑';
      upBtn.title = 'Monter';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await moveRepository(repo.id, -1);
        render();
      });
      actions.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.textContent = '↓';
      downBtn.title = 'Descendre';
      downBtn.disabled = idx === State.repositories.length - 1;
      downBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await moveRepository(repo.id, 1);
        render();
      });
      actions.appendChild(downBtn);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.title = 'Retirer ce dépôt (le dossier réel n\'est pas supprimé)';
      removeBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Retirer le dépôt "${repo.name}" ? Le dossier lui-même n'est pas supprimé.`)) return;
        await removeRepository(repo.id);
        render();
      });
      actions.appendChild(removeBtn);

      item.appendChild(actions);

      item.addEventListener('click', () => open(repo));
      list.appendChild(item);
    });
  }

  async function reauthorize(repo) {
    const result = await reauthorizeRepository(repo);
    if (result !== 'granted') {
      alert('Permission refusée — le dépôt reste inaccessible.');
    }
    render();
  }

  async function open(repo) {
    if (repo.permission !== 'granted') {
      await reauthorize(repo);
      if (repo.permission !== 'granted') return;
    }
    State.activeRepositoryId = repo.id;
    resetDirStack(); // always start browsing at the repo's root
    el('repo-screen').hidden = true;
    el('browser-screen').hidden = false;
    await Browser.openActive();
  }

  async function addViaPicker() {
    if (!FSA.supported()) {
      alert('La File System Access API n\'est pas disponible dans ce navigateur — utilisez Chrome, Edge ou Brave.');
      return;
    }
    let dirHandle;
    try {
      dirHandle = await FSA.pickDirectory();
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled the picker
      throw e;
    }
    // A given folder shouldn't be registered twice — isSameEntry avoids a
    // duplicate repository pointing at the same directory.
    for (const repo of State.repositories) {
      if (await repo.dirHandle.isSameEntry(dirHandle)) {
        alert('Ce dossier est déjà enregistré comme dépôt.');
        return;
      }
    }
    const repo = await addRepository(dirHandle);
    await maybeRestoreDurableConfig(repo);
    render();
  }

  function showList() {
    State.activeRepositoryId = null;
    el('browser-screen').hidden = true;
    el('repo-screen').hidden = false;
    render();
  }

  function init() {
    el('repo-add-btn').addEventListener('click', addViaPicker);
    render();
  }

  return { init, render, showList };
})();
