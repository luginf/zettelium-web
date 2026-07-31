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
  }

  function init() {
    el('repo-add-btn').addEventListener('click', addViaPicker);
    renderColorSwatches();
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
  }

  return { init, render, showList };
})();
