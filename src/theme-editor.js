'use strict';
// Theme list + color editor — faithful port of zettelium-android's
// `EditorThemesScreen.kt` (list: swatches/name/active-check/duplicate/edit/
// delete; editor: name field, Sombre/Clair tabs, 6 color rows, Annuler/
// Enregistrer). Reached from Settings ("Modifier les couleurs" button).
//
// Deliberate deviation: each color row's swatch opens the browser's native
// `<input type="color">` picker instead of Android's custom hue-wheel
// `ColorPickerDialog` — every browser already ships an equivalent
// hue/saturation picker for free, reimplementing one in canvas would be
// pure duplication for the same end result (pick a color, get its hex).
const ThemeEditor = (() => {
  function el(id) { return document.getElementById(id); }

  const COLOR_FIELDS = [
    { key: 'bg', altKey: 'bgAlt', label: 'Fond' },
    { key: 'fg', altKey: 'fgAlt', label: 'Texte' },
    { key: 'bgSel', altKey: 'bgSelAlt', label: 'Sélection' },
    { key: 'heading', altKey: 'headingAlt', label: 'Titre' },
    { key: 'comment', altKey: 'commentAlt', label: 'Commentaire' },
    { key: 'markup', altKey: 'markupAlt', label: 'Balisage' }
  ];

  let _onReturnToSettings = null;
  let _editing = null; // { originalName, colors, tab } while the editor sub-screen is open

  function isCustom(name) {
    return Object.prototype.hasOwnProperty.call(customSchemes, name);
  }

  // --- Liste des thèmes ------------------------------------------------------

  function openList(onReturn) {
    _onReturnToSettings = onReturn;
    el('settings-screen').hidden = true;
    el('theme-editor-screen').hidden = true;
    el('theme-list-screen').hidden = false;
    renderList();
  }

  function backToSettings() {
    el('theme-list-screen').hidden = true;
    el('settings-screen').hidden = false;
    if (_onReturnToSettings) _onReturnToSettings();
  }

  function swatch(hex) {
    const span = document.createElement('span');
    span.className = 'scheme-swatch';
    span.style.background = hex;
    return span;
  }

  function renderList() {
    const list = el('theme-list');
    list.innerHTML = '';
    for (const name of getAllSchemeNames()) {
      const scheme = getScheme(name);
      const row = document.createElement('div');
      row.className = 'theme-row';

      const swatches = document.createElement('span');
      swatches.className = 'theme-row-swatches';
      swatches.appendChild(swatch(scheme.bg));
      swatches.appendChild(swatch(scheme.heading));
      swatches.appendChild(swatch(scheme.bgAlt));
      row.appendChild(swatches);

      const label = document.createElement('span');
      label.className = 'theme-row-name';
      label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      row.appendChild(label);

      if (name === State.settings.scheme) {
        const check = document.createElement('span');
        check.className = 'theme-row-active';
        check.textContent = '✓';
        row.appendChild(check);
      }

      row.addEventListener('click', async () => {
        await setScheme(name);
        renderList();
      });

      const actions = document.createElement('span');
      actions.className = 'theme-row-actions';

      const dupBtn = document.createElement('button');
      dupBtn.textContent = '⧉';
      dupBtn.title = 'Dupliquer';
      dupBtn.addEventListener('click', e => { e.stopPropagation(); openDuplicateDialog(name, scheme); });
      actions.appendChild(dupBtn);

      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.title = 'Modifier';
      editBtn.addEventListener('click', e => { e.stopPropagation(); openEditor(name, scheme); });
      actions.appendChild(editBtn);

      if (isCustom(name)) {
        const delBtn = document.createElement('button');
        delBtn.textContent = '✕';
        delBtn.title = 'Supprimer';
        delBtn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm(`Supprimer le thème "${name}" ?`)) return;
          await deleteCustomScheme(name);
          renderList();
        });
        actions.appendChild(delBtn);
      }
      row.appendChild(actions);

      list.appendChild(row);
    }
  }

  // --- Dupliquer (dialogue nom) -----------------------------------------------

  function openDuplicateDialog(name, scheme) {
    el('theme-dup-name').value = `${name}_copy`;
    el('theme-dup-error').textContent = '';
    el('theme-dup-dlg').dataset.sourceScheme = JSON.stringify(Themes.sixColorsFromScheme(scheme));
    el('theme-dup-dlg').showModal();
    el('theme-dup-name').focus();
    el('theme-dup-name').select();
  }

  async function confirmDuplicate() {
    const dlg = el('theme-dup-dlg');
    const name = el('theme-dup-name').value.trim();
    if (!name) { el('theme-dup-error').textContent = 'Le nom ne peut pas être vide.'; return; }
    if (getAllSchemeNames().includes(name)) { el('theme-dup-error').textContent = `Un thème "${name}" existe déjà.`; return; }
    const colors = JSON.parse(dlg.dataset.sourceScheme);
    await saveCustomScheme(name, colors);
    dlg.close();
    renderList();
  }

  // --- Éditeur d'un thème ------------------------------------------------------

  function openEditor(originalName, scheme) {
    _editing = {
      originalName,
      colors: Themes.sixColorsFromScheme(scheme),
      tab: State.settings.darkMode ? 0 : 1 // même résolution que le mode sombre/clair actif — voir theme-editor.js header
    };
    el('theme-editor-title').textContent = originalName ? `Modifier "${originalName}"` : 'Nouveau thème';
    el('theme-editor-name').value = originalName;
    el('theme-list-screen').hidden = true;
    el('theme-editor-screen').hidden = false;
    renderTabs();
    renderColorFields();
    updateSaveEnabled();
  }

  function newTheme() {
    openEditor('', getScheme('default'));
  }

  function renderTabs() {
    el('theme-tab-dark').classList.toggle('active', _editing.tab === 0);
    el('theme-tab-light').classList.toggle('active', _editing.tab === 1);
  }

  function renderColorFields() {
    const container = el('theme-editor-colors');
    container.innerHTML = '';
    const dark = _editing.tab === 0;
    for (const field of COLOR_FIELDS) {
      const key = dark ? field.key : field.altKey;
      const value = _editing.colors[key];

      const row = document.createElement('div');
      row.className = 'theme-color-row';

      const label = document.createElement('span');
      label.className = 'theme-color-label';
      label.textContent = field.label;
      row.appendChild(label);

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.className = 'theme-color-hex';
      hexInput.value = value;

      function setValue(v) {
        _editing.colors[key] = v;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) {
          hexInput.classList.remove('invalid');
          colorInput.value = v;
        } else {
          hexInput.classList.add('invalid');
        }
      }

      colorInput.addEventListener('input', e => { hexInput.value = e.target.value; setValue(e.target.value); });
      hexInput.addEventListener('input', e => setValue(e.target.value));

      row.appendChild(colorInput);
      row.appendChild(hexInput);
      container.appendChild(row);
    }
  }

  function updateSaveEnabled() {
    el('theme-editor-save').disabled = el('theme-editor-name').value.trim() === '';
  }

  function switchTab(tab) {
    _editing.tab = tab;
    renderTabs();
    renderColorFields();
  }

  async function saveTheme() {
    const newName = el('theme-editor-name').value.trim();
    if (!newName) return;
    const { originalName, colors } = _editing;
    // Même règle qu'Android : renommer un thème personnalisé (pas un des 8
    // intégrés) supprime l'ancienne entrée sous son ancien nom.
    if (originalName && isCustom(originalName) && originalName !== newName) {
      await deleteCustomScheme(originalName);
    }
    await saveCustomScheme(newName, colors);
    backToList();
  }

  function backToList() {
    _editing = null;
    el('theme-editor-screen').hidden = true;
    el('theme-list-screen').hidden = false;
    renderList();
  }

  function init() {
    el('theme-list-back-btn').addEventListener('click', backToSettings);
    el('theme-list-new-btn').addEventListener('click', newTheme);

    el('theme-dup-create').addEventListener('click', confirmDuplicate);
    el('theme-dup-cancel').addEventListener('click', () => el('theme-dup-dlg').close());

    el('theme-editor-back-btn').addEventListener('click', backToList);
    el('theme-editor-name').addEventListener('input', updateSaveEnabled);
    el('theme-tab-dark').addEventListener('click', () => switchTab(0));
    el('theme-tab-light').addEventListener('click', () => switchTab(1));
    el('theme-editor-cancel').addEventListener('click', backToList);
    el('theme-editor-save').addEventListener('click', saveTheme);
  }

  return { init, openList };
})();
