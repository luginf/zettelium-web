'use strict';
// Repository list screen — add/remove/reorder/reauthorize repositories,
// and open a repository into the file browser (browser.js).
const Repositories = (() => {
  function el(id) { return document.getElementById(id); }

  // Dépôt ciblé par le sélecteur de couleur (round 22) — même mécanisme que
  // `_actionsFile`/`_moveFile` de browser.js (pas de vraie sélection HTML,
  // juste une variable de module).
  let _colorTarget = null;

  // Dernière couleur personnalisée choisie via le sélecteur natif (round 26,
  // retour utilisateur) — variable de session pure, jamais persistée : sert
  // uniquement à préremplir l'aperçu/le bouton "Valider" la prochaine fois
  // que le dialogue s'ouvre, y compris après être passé par une pastille
  // prédéfinie entre-temps (demande explicite : "garde en mémoire... même
  // si on revient sur une des couleurs prédéfinies ensuite" — `pickColor()`
  // ne touche jamais cette variable, seul `onCustomColorInput()` le fait).
  let _lastCustomColor = null;

  // --- Recherche depuis l'accueil (round 28, comme zettelium-android :
  // SearchScreen atteignable sans dépôt ambiant) — toujours cross-dépôt
  // (aucun dépôt "actif" ici), donc pas de bascule de portée comme
  // #browser-search-scope-btn : voir Browser.renderFileRow (browser.js)
  // pour le `crossRepo` qui en découle. Variable de session pure, comme
  // `Browser._searchMode` : jamais persistée, retombe sur 'name' à chaque
  // rechargement. -----------------------------------------------------
  let _searchMode = 'name';

  function updateSearchBarVisibility() {
    el('repo-search-bar').hidden = State.repositories.length <= 1;
  }

  function renderSearchResults() {
    const list = el('repo-list');
    list.innerHTML = '';
    const query = el('repo-search-input').value.trim();
    el('repo-search-clear-btn').hidden = !query;
    const results = Index.entriesAllRepos()
      .filter(e => Browser.matchesQuery(e, _searchMode, query))
      .sort((a, b) => a.name.localeCompare(b.name));
    el('repo-empty-hint').hidden = results.length > 0;
    el('repo-empty-hint').textContent = I18n.t('browser.emptyHintNoResults');
    const jumpTerm = _searchMode === 'content' ? query : undefined;
    results.forEach(file => {
      const row = Browser.renderFileRow(file, jumpTerm, true);
      // `renderFileRow`'s own click handler bascule le dépôt actif et ouvre
      // l'éditeur (`Editor.openOther`), mais celui-ci ne touche jamais
      // `repo-screen` (seulement `browser-screen`/`editor-screen` — voir
      // `Editor.open`) : sans ceci, l'écran d'accueil resterait visible à
      // côté de l'éditeur (même piège que `showList()` avec l'ancien
      // `editor-screen` orphelin, voir son commentaire plus haut).
      row.addEventListener('click', () => { el('repo-screen').hidden = true; });
      list.appendChild(row);
    });
  }

  function render() {
    const list = el('repo-list');
    list.innerHTML = '';
    updateSearchBarVisibility();

    const query = el('repo-search-input').value.trim();
    if ((query || _searchMode === 'noid') && !el('repo-search-bar').hidden) {
      renderSearchResults();
      return;
    }
    el('repo-search-clear-btn').hidden = true;

    if (!State.repositories.length) {
      el('repo-empty-hint').hidden = false;
      return;
    }
    el('repo-empty-hint').hidden = true;
    el('repo-empty-hint').textContent = I18n.t('repo.emptyHint');

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
        badge.textContent = I18n.t('repo.reauthorizeButton');
        badge.title = I18n.t('repo.reauthorizeTooltip');
        badge.addEventListener('click', async e => {
          e.stopPropagation();
          await reauthorize(repo);
        });
        item.appendChild(badge);
      }

      const actions = document.createElement('span');
      actions.className = 'repo-item-actions';

      const colorBtn = document.createElement('button');
      colorBtn.innerHTML = Icons.droplet();
      colorBtn.title = I18n.t('repo.colorTooltip');
      colorBtn.addEventListener('click', e => {
        e.stopPropagation();
        openColorPicker(repo);
      });
      actions.appendChild(colorBtn);

      const upBtn = document.createElement('button');
      upBtn.textContent = '↑';
      upBtn.title = I18n.t('repo.moveUpTooltip');
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await moveRepository(repo.id, -1);
        render();
      });
      actions.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.textContent = '↓';
      downBtn.title = I18n.t('repo.moveDownTooltip');
      downBtn.disabled = idx === State.repositories.length - 1;
      downBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await moveRepository(repo.id, 1);
        render();
      });
      actions.appendChild(downBtn);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.title = I18n.t('repo.removeTooltip');
      removeBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(I18n.t('repo.removeConfirm', { name: repo.name }))) return;
        await removeRepository(repo.id);
        render();
      });
      actions.appendChild(removeBtn);

      item.appendChild(actions);

      item.addEventListener('click', () => open(repo));
      list.appendChild(item);
    });
  }

  // --- Couleur d'identification par dépôt (round 22, port de
  // RepositoryColorPickerDialog Android) : palette fixe de 8 teintes +
  // "Aucune couleur" pour retirer la couleur en place. ------------------

  function renderColorSwatches() {
    const wrap = el('repo-color-swatches');
    wrap.innerHTML = '';
    for (const hex of REPOSITORY_COLOR_SWATCHES) {
      const swatch = document.createElement('button');
      swatch.className = 'repo-color-swatch';
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => pickColor(hex));
      wrap.appendChild(swatch);
    }
  }

  function openColorPicker(repo) {
    _colorTarget = repo;
    updateCustomColorSwatch(); // reflète _lastCustomColor s'il a survécu à un passage par une pastille prédéfinie
    el('repo-color-dlg').showModal();
  }

  function closeColorPicker() {
    el('repo-color-dlg').close();
    _colorTarget = null;
  }

  async function pickColor(hex) {
    const repo = _colorTarget;
    closeColorPicker();
    if (!repo) return;
    await setColorTag(repo, hex);
    render();
    // Round "inventaire d'UI comparable" : ce picker est maintenant aussi accessible depuis
    // "Options du dépôt" (`browser.js`, `Repositories.openColorPicker` exporté) — sans ce
    // second appel, la teinte de l'en-tête du navigateur (`applyRepoColorTint`, dans
    // `Browser.render()`) resterait périmée jusqu'au prochain changement de dossier. Sans
    // effet si `browser-screen` n'est pas affiché (mêmes éléments DOM, juste cachés).
    Browser.render();
  }

  // Couleur personnalisée (round 22, groupée à part sous "Aucune couleur",
  // round 26/27) — sélecteur natif `<input type="color">`, même choix que
  // l'éditeur de thèmes (theme-editor.js) plutôt qu'une roue teinte/
  // saturation personnalisée. `_colorTarget` reste valide pendant que le
  // picker natif est ouvert (le <dialog> derrière ne se ferme pas).
  //
  // Round 26 : cliquer en dehors du picker natif pour valider n'était pas
  // évident, donc plus d'application immédiate sur `change`/`input` —
  // `onCustomColorInput()` se contente de mémoriser `_lastCustomColor` et
  // de rafraîchir la pastille ; seul le bouton "Valider" explicite
  // (`confirmCustomColor()`) applique réellement la couleur.
  //
  // Round 27 (retour utilisateur : "je parlais d'avoir ça dans le color
  // picker, pas dans le menu couleur du dépôt") : la pastille de
  // prévisualisation EST maintenant elle-même le déclencheur du sélecteur
  // (`#repo-color-custom-swatch`, remplace l'ancien bouton texte "Couleur
  // personnalisée…") et "Valider" vit juste à côté dans le même groupe
  // (`#repo-color-custom-row`) plutôt que dans une ligne séparée de la
  // liste "Aucune couleur"/pastilles fixes — impossible d'aller plus loin
  // et de mettre "Valider" à l'INTÉRIEUR du sélecteur natif lui-même :
  // `<input type="color">` est un contrôle du navigateur/de l'OS, son
  // contenu n'est pas personnalisable depuis la page.
  function openCustomColorPicker() {
    const repo = _colorTarget;
    const input = el('repo-color-custom-input');
    input.value = _lastCustomColor || (repo && repo.colorTag) || '#808080';
    input.click();
  }

  // `input` (pas seulement `change`) : la pastille se met à jour en direct
  // pendant qu'on glisse dans le sélecteur natif, pas seulement à sa
  // fermeture — même choix que theme-editor.js pour ses propres
  // `<input type="color">`.
  function onCustomColorInput(e) {
    _lastCustomColor = e.target.value;
    updateCustomColorSwatch();
  }

  // Pastille + bouton "Valider" toujours visibles (le groupe garde sa forme
  // stable) — seul leur ÉTAT change : pastille vide (icône goutte en
  // overlay) + "Valider" désactivé tant qu'aucune couleur personnalisée n'a
  // été choisie cette session, pastille remplie + "Valider" actif ensuite.
  function updateCustomColorSwatch() {
    const swatch = el('repo-color-custom-swatch');
    const confirmBtn = el('repo-color-custom-confirm');
    if (_lastCustomColor) {
      swatch.style.background = _lastCustomColor;
      swatch.innerHTML = '';
      swatch.title = _lastCustomColor;
      confirmBtn.disabled = false;
    } else {
      swatch.style.background = 'transparent';
      swatch.innerHTML = Icons.droplet();
      swatch.title = I18n.t('repo.colorCustomPickTooltip');
      confirmBtn.disabled = true;
    }
  }

  function confirmCustomColor() {
    if (!_lastCustomColor) return;
    pickColor(_lastCustomColor);
  }

  async function reauthorize(repo) {
    const result = await reauthorizeRepository(repo);
    if (result !== 'granted') {
      alert(I18n.t('repo.permissionDenied'));
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
      alert(I18n.t('repo.fsaUnsupported'));
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
        alert(I18n.t('repo.alreadyRegistered'));
        return;
      }
    }
    const repo = await addRepository(dirHandle);
    await maybeRestoreDurableConfig(repo);
    render();
  }

  function showList() {
    State.activeRepositoryId = null;
    // Liste de fichiers épinglée (round 19) : quitter le dépôt referme
    // aussi l'éditeur (sinon `editor-screen` resterait visible à côté de
    // `repo-screen` dans un <body> encore en `display:flex`) — le garde-fou
    // "enregistrer avant de quitter" est déjà passé côté appelant
    // (`Browser.backOrUp()`, via `Editor.requestClose()`) avant d'arriver ici.
    el('browser-screen').hidden = true;
    el('editor-screen').hidden = true;
    document.body.classList.remove('sticky-workspace-active');
    el('repo-screen').hidden = false;
    render();
    // Recherche depuis l'accueil (round 28) : interroge Index.entriesAllRepos(),
    // qui ne connaît que les dépôts déjà indexés au moins une fois cette
    // session (Browser.openActive()/reindexAllRepos()) - sans ce déclenchement,
    // la recherche resterait silencieusement vide tant qu'aucun dépôt n'a
    // été ouvert. Pas attendu, même compromis "résultats partiels qui se
    // complètent" que reindexAllRepos()/reindexActive() côté navigateur.
    if (State.repositories.length > 1) Browser.reindexAllRepos();
  }

  // Rouvre la dernière note ouverte (au lancement). Silencieux si le dépôt n'est plus
  // autorisé (la demande de permission exige un geste de l'utilisateur) ou si la note a disparu.
  async function restoreLastNote() {
    let last;
    try { last = await Storage.getMeta('lastNote'); } catch (e) { return; }
    if (!last) return;
    const repo = State.repositories.find(r => r.id === last.repoId);
    if (!repo || repo.permission !== 'granted') return;
    try {
      const segments = last.path.split('/');
      segments.pop();
      let handle = repo.dirHandle;
      let path = '';
      const stack = [{ name: repo.name, handle, path }];
      for (const seg of segments) {
        handle = await handle.getDirectoryHandle(seg);
        path += seg + '/';
        stack.push({ name: seg, handle, path });
      }
      State.activeRepositoryId = repo.id;
      State.dirStack = stack;
      await scanActiveRepo();
      const file = State.repoFiles.find(f => f.path === last.path);
      if (!file) throw new Error('note introuvable');
      el('repo-screen').hidden = true;
      el('browser-screen').hidden = false;
      Browser.openActive(); // pas attendu : l'index se construit en arrière-plan
      await Editor.open(file);
    } catch (e) {
      State.activeRepositoryId = null;
      resetDirStack();
      el('browser-screen').hidden = true;
      el('repo-screen').hidden = false;
    }
  }

  function init() {
    el('repo-add-btn').addEventListener('click', addViaPicker);
    renderColorSwatches();

    el('repo-search-input').addEventListener('input', render);
    el('repo-search-clear-btn').addEventListener('click', () => {
      el('repo-search-input').value = '';
      el('repo-search-input').focus();
      render();
    });
    for (const btn of document.querySelectorAll('#repo-search-mode button')) {
      btn.addEventListener('click', () => {
        _searchMode = btn.dataset.mode;
        for (const b of document.querySelectorAll('#repo-search-mode button')) b.classList.toggle('active', b === btn);
        el('repo-search-input').placeholder = I18n.t(
          _searchMode === 'content' ? 'browser.searchPlaceholderContent'
          : _searchMode === 'tag' ? 'browser.searchPlaceholderTag'
          : 'browser.searchPlaceholderName');
        render();
      });
    }
    el('repo-color-close').addEventListener('click', closeColorPicker);
    el('repo-color-none').addEventListener('click', () => pickColor(null));
    el('repo-color-custom-swatch').addEventListener('click', openCustomColorPicker);
    el('repo-color-custom-input').addEventListener('input', onCustomColorInput);
    el('repo-color-custom-confirm').addEventListener('click', confirmCustomColor);
    render();
    // Les titres/libellés générés dynamiquement (ré-autoriser, monter,
    // descendre, retirer) sont reconstruits par render() lui-même — un
    // simple nouveau rendu suffit à les rafraîchir sur changement de langue.
    document.addEventListener('i18n:apply', render);
    // Recherche depuis l'accueil (round 28) - voir le même appel dans
    // showList() : nécessaire ici aussi pour le tout premier écran affiché
    // au chargement de l'appli (repo-screen, visible par défaut - showList()
    // n'est jamais appelée à ce moment-là).
    if (State.repositories.length > 1) Browser.reindexAllRepos();
  }

  // `openColorPicker` exporté (round "inventaire d'UI comparable", demande explicite de
  // l'utilisateur) — réutilisé depuis `browser.js` pour "Couleur du dépôt" dans "Options du
  // dépôt", en plus de son point d'entrée existant sur l'écran liste des dépôts.
  return { init, render, showList, openColorPicker, restoreLastNote };
})();
