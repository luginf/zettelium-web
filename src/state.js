'use strict';
// In-memory application state (phase 1 scope — see PLAN.md section 8).
const State = {
  // Repositories registry, loaded from Storage at startup.
  repositories: [],        // [{id, name, dirHandle, order, colorTag, permission}]
  activeRepositoryId: null,

  // Active repository's *currently browsed folder* — root when dirStack has
  // one entry, a subfolder when deeper (phase 6 subfolder navigation,
  // generalizing writhdeck-web's dirStack/scanDir pattern to "whichever
  // repository is active" instead of a single optional watched folder).
  dirStack: [],            // [{name, handle, path}] root..current (path: '' at root, else 'sub/sub2/')
  dirSubdirs: [],          // [{name, handle, path}] subfolders of the current folder
  repoFiles: [],           // NoteFile[] of the current folder — {path, name, fileHandle, lastModified, size}

  settings: {
    // Comma/space-separated suffixes, same convention and default as
    // zettelium-android's AppSettings.noteExtensions (round 21).
    noteExtensions: 'txt, t2t, md',
    noteExtensionsFilterDisabled: false,

    // Zettelkasten (phase 5) — detection pattern (regex) vs. generation
    // format (token string) are deliberately distinct settings, same
    // reasoning as AppSettings.idPattern/idGenerationFormat: a regex isn't
    // reversible into a generator in general (see zettelkasten.js).
    idPattern: ZettelkastenLinks.DEFAULT_ID_REGEX.source,
    idGenerationFormat: ZettelkastenLinks.DEFAULT_ID_FORMAT,

    // Sort order for the file browser — 'name' | 'modified', same choice
    // and persistence as AppSettings.noteSortOrder (Android round 3).
    noteSortOrder: 'name',

    // Theme (phase 6/9) — scheme name from schemes.js (SCHEMES/customSchemes)
    // + a tri-state mode ('system'|'light'|'dark', matching Android's
    // `ThemeMode` enum — round 9 unification, replaces the earlier plain
    // boolean `darkMode`), applied via applyTheme() in app.js.
    scheme: 'default',
    themeMode: 'system',

    // Langue de l'interface ('system'|'fr'|'en') — round 9, port de
    // `AppLanguage` (Android round 6). Appliquée par `I18n.apply()`
    // (i18n.js) ; 'system' résout la langue du navigateur au démarrage et à
    // chaque changement (`navigator.language`), retombant sur le français
    // si la langue système n'est pas supportée.
    language: 'system',

    // Editor typography (phase 6, "sur le modèle de zettelium-android" —
    // SettingsScreen.kt's "Éditeur" section: font family/size, margins,
    // line spacing). Applied via applyEditorTypography() in app.js. Font
    // family values are real CSS stacks (see settings.js's EDITOR_FONTS) —
    // Android's own list is generic *Android* type-face aliases
    // ("sans-serif-condensed" etc.), which don't mean anything in CSS, so
    // adapted rather than copied verbatim.
    editorFontFamily: 'monospace',
    editorFontSize: 16,
    editorMarginX: 40,
    editorMarginY: 24,
    editorLineSpacing: 1.5,

    // Sauvegarde automatique (round 10) — porté d'`AppSettings
    // .autosaveEnabled` : désactivée par défaut ("cela sauvegarde
    // régulièrement... n'est pas souhaité", décision explicite Android
    // round 3), reste un réglage disponible pour qui la veut. Voir
    // editor.js `scheduleAutosave()` pour le mécanisme (debounce 2s, même
    // durée qu'Android).
    autosaveEnabled: false,

    // Table des matières en panneau latéral (round 11), sur le modèle de
    // writhdeck-web (`toc.js`) — désactivé par défaut, conserve le
    // comportement historique (fenêtre modale `<dialog>`) tant qu'on ne
    // l'active pas explicitement. Le panneau reste ouvert après un clic
    // sur un titre (persistant), jusqu'à fermeture explicite (round 12 :
    // le mode "épingle" a été retiré, jugé redondant avec le bouton "✕").
    tocSidebarMode: false,

    // Liste des fichiers épinglée à gauche de l'éditeur (round 19), sur le
    // même principe que tocSidebarMode ci-dessus — désactivé par défaut.
    // Contrairement au panneau TOC, ne s'active qu'à l'ouverture d'une
    // note (voir editor.js `open()`/`close()` et la classe body
    // `sticky-workspace-active`), pas dès l'entrée dans un dépôt.
    fileListSidebarMode: false,
    // Largeur du panneau ci-dessus (round 19bis, retour utilisateur :
    // "pouvoir modifier la taille... même si c'est plus petit que la
    // longueur du titre de la plus longue note") — glissée à la souris via
    // #file-list-sidebar-resizer, pas de plancher lié au contenu
    // (`.file-item-name`/`.file-item-meta` tronquent déjà avec une
    // ellipse). Bornes en dur dans browser.js (FILE_LIST_SIDEBAR_MIN/MAX),
    // pas de champ Réglages dédié — le glisser-déposer suffit.
    fileListSidebarWidth: 320,

    // Titres agrandis dans l'éditeur (round 20bis, retour utilisateur) —
    // activé par défaut (comportement historique inchangé), réglage
    // permettant de désactiver l'agrandissement (`.hl-h1`..`.hl-h4`, voir
    // style.css `.heading-sizes`) tout en gardant la couleur des titres
    // (`.hl-heading`, jamais conditionnée par ce réglage). Cause racine
    // des bugs de curseur/sélection décalés (rounds 13/20/20bis) : un
    // agrandissement désactivé les élimine à la source plutôt que de
    // continuer à les corriger un par un à chaque nouvelle manifestation.
    headingSizesEnabled: true
  }
};

// Fichier de config durable (phase 6) — écrit dans le dépôt *primaire*
// (le premier par ordre d'affichage), pour survivre à une purge des
// données du navigateur qui viderait IndexedDB : les permissions File
// System Access sont de toute façon TOUJOURS révoquées dans ce cas
// (contrainte de la plateforme, non contournable, même limite qu'Android)
// — mais le fichier lui-même reste sur le disque réel de l'utilisateur, et
// peut donc être retrouvé et proposé en restauration dès que ce même
// dossier est ré-ajouté comme dépôt (voir maybeRestoreDurableConfig, appelé
// depuis repositories.js). Ne recrée jamais de dépôt automatiquement à
// partir de la liste "known" qu'il contient : un nom retrouvé sans
// permission FSA valide serait inutilisable, c'est purement informatif.
const DURABLE_CONFIG_FILENAME = 'zettelium.ini';
let _durableExportTimer = null;

function primaryRepository() {
  return State.repositories.length ? State.repositories[0] : null; // déjà trié par `order`
}

// Débounce 500 ms : plusieurs réglages peuvent changer coup sur coup (ex.
// frappe dans un champ Réglages) — même raisonnement qu'Android
// (AppSettings.scheduleDurableExport), qui a dû corriger un bug réel de
// fichiers dupliqués (`zettelium (1).ini`, etc.) causé par plusieurs
// écritures concurrentes sans debounce ni verrou.
function scheduleDurableExport() {
  if (_durableExportTimer) clearTimeout(_durableExportTimer);
  _durableExportTimer = setTimeout(writeDurableConfig, 500);
}

async function writeDurableConfig() {
  const repo = primaryRepository();
  if (!repo) return;
  const text = INI.stringify(State.settings, State.repositories.map(r => r.name));
  try {
    const handle = await repo.dirHandle.getFileHandle(DURABLE_CONFIG_FILENAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  } catch (e) {
    console.error('Échec de l\'écriture de la config durable', e);
  }
}

// Appelé après l'ajout d'un nouveau dépôt (repositories.js) : si ce dossier
// contient déjà un `zettelium.ini` (typiquement une reconnexion après une
// purge des données du navigateur), propose de restaurer les réglages.
async function maybeRestoreDurableConfig(repo) {
  let handle;
  try {
    handle = await repo.dirHandle.getFileHandle(DURABLE_CONFIG_FILENAME);
  } catch (_) {
    return; // pas de fichier de config ici, rien à faire
  }
  let text;
  try {
    text = await (await handle.getFile()).text();
  } catch (e) {
    console.error('Échec de lecture de la config durable', e);
    return;
  }
  const { settings, knownRepositories } = INI.parse(text);
  if (!Object.keys(settings).length) return;

  const knownHint = knownRepositories.length
    ? I18n.t('repo.restoreConfigKnownHint', { names: knownRepositories.join(', ') })
    : '';
  const restore = confirm(I18n.t('repo.restoreConfigFound') + knownHint);
  if (!restore) return;

  Object.assign(State.settings, settings);
  await Promise.all([
    setNoteExtensions(State.settings.noteExtensions),
    setNoteExtensionsFilterDisabled(State.settings.noteExtensionsFilterDisabled),
    setNoteSortOrder(State.settings.noteSortOrder),
    setIdPattern(State.settings.idPattern),
    setIdGenerationFormat(State.settings.idGenerationFormat),
    setScheme(State.settings.scheme),
    setThemeMode(State.settings.themeMode),
    setLanguage(State.settings.language),
    setEditorFontFamily(State.settings.editorFontFamily),
    setEditorFontSize(State.settings.editorFontSize),
    setEditorMarginX(State.settings.editorMarginX),
    setEditorMarginY(State.settings.editorMarginY),
    setEditorLineSpacing(State.settings.editorLineSpacing),
    setAutosaveEnabled(State.settings.autosaveEnabled),
    setTocSidebarMode(State.settings.tocSidebarMode),
    setFileListSidebarMode(State.settings.fileListSidebarMode),
    setFileListSidebarWidth(State.settings.fileListSidebarWidth),
    setHeadingSizesEnabled(State.settings.headingSizesEnabled)
  ]);
}

function noteExtensionsList() {
  const raw = State.settings.noteExtensions || '';
  const list = raw.split(/[,\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(ext => ext.startsWith('.') ? ext : '.' + ext);
  // Never filter out every file silently if the user empties the field by
  // mistake — same guard as the Android port.
  return list.length ? list : ['.txt', '.t2t', '.md'];
}

function activeRepository() {
  return State.repositories.find(r => r.id === State.activeRepositoryId) || null;
}

async function loadState() {
  const [repos, noteExtensions, filterDisabled, idPattern, idGenerationFormat, noteSortOrder, scheme, themeMode,
    language, editorFontFamily, editorFontSize, editorMarginX, editorMarginY, editorLineSpacing, autosaveEnabled,
    tocSidebarMode, fileListSidebarMode, fileListSidebarWidth, headingSizesEnabled] = await Promise.all([
    Storage.getAllRepositories(),
    Storage.getMeta('noteExtensions'),
    Storage.getMeta('noteExtensionsFilterDisabled'),
    Storage.getMeta('idPattern'),
    Storage.getMeta('idGenerationFormat'),
    Storage.getMeta('noteSortOrder'),
    Storage.getMeta('scheme'),
    Storage.getMeta('themeMode'),
    Storage.getMeta('language'),
    Storage.getMeta('editorFontFamily'),
    Storage.getMeta('editorFontSize'),
    Storage.getMeta('editorMarginX'),
    Storage.getMeta('editorMarginY'),
    Storage.getMeta('editorLineSpacing'),
    Storage.getMeta('autosaveEnabled'),
    Storage.getMeta('tocSidebarMode'),
    Storage.getMeta('fileListSidebarMode'),
    Storage.getMeta('fileListSidebarWidth'),
    Storage.getMeta('headingSizesEnabled')
  ]);
  State.repositories = (repos || []).sort((a, b) => a.order - b.order);
  if (noteExtensions !== undefined) State.settings.noteExtensions = noteExtensions;
  if (filterDisabled !== undefined) State.settings.noteExtensionsFilterDisabled = filterDisabled;
  // .trim() on load (not just on write) — a leading/trailing space in a
  // mobile-style text field is invisible but makes the pattern silently
  // match nothing (real bug already hit on Android, round 12ter).
  if (idPattern !== undefined) State.settings.idPattern = idPattern.trim();
  if (idGenerationFormat !== undefined) State.settings.idGenerationFormat = idGenerationFormat.trim();
  if (noteSortOrder !== undefined) State.settings.noteSortOrder = noteSortOrder;
  if (scheme !== undefined) State.settings.scheme = scheme;
  if (themeMode !== undefined) State.settings.themeMode = themeMode;
  if (language !== undefined) State.settings.language = language;
  if (editorFontFamily !== undefined) State.settings.editorFontFamily = editorFontFamily;
  if (editorFontSize !== undefined) State.settings.editorFontSize = editorFontSize;
  if (editorMarginX !== undefined) State.settings.editorMarginX = editorMarginX;
  if (editorMarginY !== undefined) State.settings.editorMarginY = editorMarginY;
  if (editorLineSpacing !== undefined) State.settings.editorLineSpacing = editorLineSpacing;
  if (autosaveEnabled !== undefined) State.settings.autosaveEnabled = autosaveEnabled;
  if (tocSidebarMode !== undefined) State.settings.tocSidebarMode = tocSidebarMode;
  if (fileListSidebarMode !== undefined) State.settings.fileListSidebarMode = fileListSidebarMode;
  if (fileListSidebarWidth !== undefined) State.settings.fileListSidebarWidth = fileListSidebarWidth;
  if (headingSizesEnabled !== undefined) State.settings.headingSizesEnabled = headingSizesEnabled;

  // Re-verify permission on every repository without prompting — a prompt
  // requires a user gesture, done on demand via reauthorizeRepository().
  await Promise.all(State.repositories.map(async repo => {
    repo.permission = await FSA.queryPermission(repo.dirHandle);
  }));
}

async function addRepository(dirHandle) {
  const repo = {
    id: crypto.randomUUID(),
    name: dirHandle.name,
    dirHandle,
    order: State.repositories.length,
    colorTag: null,
    includeExtensionInLinks: false, // Repository.includeExtensionInLinks (Android) — per-repo, see zettelkasten.js
    permission: 'granted' // just picked, permission was just granted by the browser
  };
  State.repositories.push(repo);
  await Storage.putRepository(repo);
  scheduleDurableExport(); // the "known repositories" list changed
  return repo;
}

async function setIncludeExtensionInLinks(repo, value) {
  repo.includeExtensionInLinks = value;
  await Storage.putRepository(repo);
}

// Renomme un dépôt (juste son nom d'affichage, `dirHandle` inchangé) — porté
// de BrowserViewModel.renameRepository (Android, round 4 côté web /
// "Options du dépôt"). `State.dirStack[0].name` est capturé une seule fois
// au moment du scan (`scanActiveRepo`), pas relu dynamiquement depuis
// `repo.name` — sans cette mise à jour, le fil d'Ariane du navigateur
// afficherait l'ancien nom jusqu'au prochain changement de dossier.
async function renameRepository(repo, newName) {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === repo.name) return;
  repo.name = trimmed;
  await Storage.putRepository(repo);
  if (State.dirStack.length) State.dirStack[0].name = trimmed;
  scheduleDurableExport();
}

async function removeRepository(id) {
  State.repositories = State.repositories.filter(r => r.id !== id);
  await Storage.deleteRepository(id);
  if (State.activeRepositoryId === id) State.activeRepositoryId = null;
  scheduleDurableExport(); // the "known repositories" list changed (and possibly the primary repo itself)
}

async function reauthorizeRepository(repo) {
  repo.permission = await FSA.requestPermission(repo.dirHandle);
  return repo.permission;
}

async function moveRepository(id, direction) {
  const idx = State.repositories.findIndex(r => r.id === id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= State.repositories.length) return;
  [State.repositories[idx], State.repositories[swapIdx]] =
    [State.repositories[swapIdx], State.repositories[idx]];
  State.repositories.forEach((r, i) => { r.order = i; });
  await Promise.all(State.repositories.map(r => Storage.putRepository(r)));
  scheduleDurableExport(); // reordering can change which repository is "primary" (order 0)
}

function resetDirStack() {
  State.dirStack = [];
  State.dirSubdirs = [];
  State.repoFiles = [];
}

function currentDirHandle() {
  return State.dirStack.length ? State.dirStack[State.dirStack.length - 1].handle : null;
}

function currentDirPath() {
  return State.dirStack.length ? State.dirStack[State.dirStack.length - 1].path : '';
}

// Descends into a subfolder listed in `State.dirSubdirs` and rescans.
async function dirEnter(subdir) {
  State.dirStack.push(subdir);
  await scanActiveRepo();
}

// Goes up one folder (no-op at the root, returns false) and rescans.
async function dirUp() {
  if (State.dirStack.length <= 1) return false;
  State.dirStack.pop();
  await scanActiveRepo();
  return true;
}

async function scanActiveRepo() {
  const repo = activeRepository();
  if (!repo) { resetDirStack(); return; }
  if (!State.dirStack.length) State.dirStack = [{ name: repo.name, handle: repo.dirHandle, path: '' }];
  const { files, subdirs } = await FSA.listChildren(
    currentDirHandle(), noteExtensionsList(), State.settings.noteExtensionsFilterDisabled, currentDirPath());
  State.repoFiles = files;
  State.dirSubdirs = subdirs;
}

async function setNoteExtensions(value) {
  State.settings.noteExtensions = value;
  await Storage.setMeta('noteExtensions', value);
  scheduleDurableExport();
}

async function setNoteExtensionsFilterDisabled(value) {
  State.settings.noteExtensionsFilterDisabled = value;
  await Storage.setMeta('noteExtensionsFilterDisabled', value);
  scheduleDurableExport();
}

// Changing the detection pattern invalidates every repository's index (a
// note indexed under the old pattern may keep a stale/null zkId until its
// file happens to change) — Index.indexRepository() compares against the
// pattern it last indexed with and forces a full pass on mismatch, mirroring
// AppSettings.needsIdPatternReindex/markIdPatternIndexed (Android rounds
// 12/12bis). No explicit "force reindex" call needed here: it's a passive
// comparison the indexer makes on its own next run.
async function setIdPattern(value) {
  State.settings.idPattern = value.trim();
  await Storage.setMeta('idPattern', State.settings.idPattern);
  scheduleDurableExport();
}

async function setIdGenerationFormat(value) {
  State.settings.idGenerationFormat = value.trim();
  await Storage.setMeta('idGenerationFormat', State.settings.idGenerationFormat);
  scheduleDurableExport();
}

async function setNoteSortOrder(value) {
  State.settings.noteSortOrder = value;
  await Storage.setMeta('noteSortOrder', value);
  scheduleDurableExport();
}

async function setScheme(value) {
  State.settings.scheme = value;
  await Storage.setMeta('scheme', value);
  applyTheme(State.settings.scheme, State.settings.themeMode);
  scheduleDurableExport();
}

async function setThemeMode(value) {
  State.settings.themeMode = value;
  await Storage.setMeta('themeMode', value);
  applyTheme(State.settings.scheme, State.settings.themeMode);
  scheduleDurableExport();
}

async function setLanguage(value) {
  State.settings.language = value;
  await Storage.setMeta('language', value);
  I18n.apply();
  scheduleDurableExport();
}

async function setEditorFontFamily(value) {
  State.settings.editorFontFamily = value;
  await Storage.setMeta('editorFontFamily', value);
  applyEditorTypography();
  scheduleDurableExport();
}

async function setEditorFontSize(value) {
  State.settings.editorFontSize = value;
  await Storage.setMeta('editorFontSize', value);
  applyEditorTypography();
  scheduleDurableExport();
}

async function setEditorMarginX(value) {
  State.settings.editorMarginX = value;
  await Storage.setMeta('editorMarginX', value);
  applyEditorTypography();
  scheduleDurableExport();
}

async function setEditorMarginY(value) {
  State.settings.editorMarginY = value;
  await Storage.setMeta('editorMarginY', value);
  applyEditorTypography();
  scheduleDurableExport();
}

async function setEditorLineSpacing(value) {
  State.settings.editorLineSpacing = value;
  await Storage.setMeta('editorLineSpacing', value);
  applyEditorTypography();
  scheduleDurableExport();
}

async function setAutosaveEnabled(value) {
  State.settings.autosaveEnabled = value;
  await Storage.setMeta('autosaveEnabled', value);
  scheduleDurableExport();
}

async function setTocSidebarMode(value) {
  State.settings.tocSidebarMode = value;
  await Storage.setMeta('tocSidebarMode', value);
  scheduleDurableExport();
}

async function setFileListSidebarMode(value) {
  State.settings.fileListSidebarMode = value;
  await Storage.setMeta('fileListSidebarMode', value);
  scheduleDurableExport();
}

async function setFileListSidebarWidth(value) {
  State.settings.fileListSidebarWidth = value;
  await Storage.setMeta('fileListSidebarWidth', value);
  applyFileListSidebarWidth();
  scheduleDurableExport();
}

async function setHeadingSizesEnabled(value) {
  State.settings.headingSizesEnabled = value;
  await Storage.setMeta('headingSizesEnabled', value);
  document.documentElement.classList.toggle('heading-sizes', value);
  scheduleDurableExport();
}
