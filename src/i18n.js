'use strict';
// Internationalisation FR/EN (round 9) — port du mécanisme d'Android
// (`AppLanguage` : Système/Français/English, round 6 zettelium-android),
// mais l'approche technique diffère forcément : pas de ressources
// `strings.xml`/recréation d'activité ici, un dictionnaire JS plat +
// re-balayage du DOM. 'system' résout `navigator.language` (retombe sur le
// français si ni fr ni en) plutôt que la langue système Android.
//
// Convention : chaque texte visible par l'utilisateur passe par une clé
// `section.nom` ; les valeurs paramétrées utilisent `{nom}` (remplacé par
// `t(key, {nom: valeur})`). Les noms propres (Zettelium, noms de polices
// génériques Monospace/Sans-serif/Serif/Cursive, noms de palettes de
// couleurs comme "solarized"/"nord") ne sont volontairement PAS traduits,
// même logique qu'Android qui ne traduit pas non plus ces éléments.
const I18n = (() => {
  const STRINGS = {
    fr: {
      'common.back': 'Retour',
      'common.cancel': 'Annuler',
      'common.close': 'Fermer',
      'common.create': 'Créer',
      'common.rename': 'Renommer',
      'common.delete': 'Supprimer',
      'common.save': 'Enregistrer',
      'common.settings': 'Réglages',
      'common.system': 'Système',
      'common.renameFailed': 'Échec du renommage : {error}',

      'repo.addButton': '+ Dépôt',
      'repo.addTooltip': 'Ajouter un dépôt (dossier)',
      'repo.emptyHint': 'Aucun dépôt enregistré. Un dossier est un dossier réel sur votre disque — cliquez sur « + Dépôt » pour en choisir un.',
      'repo.reauthorizeButton': 'Ré-autoriser',
      'repo.reauthorizeTooltip': 'La permission d\'accès à ce dossier a expiré ou a été révoquée',
      'repo.moveUpTooltip': 'Monter',
      'repo.moveDownTooltip': 'Descendre',
      'repo.removeTooltip': 'Retirer ce dépôt (le dossier réel n\'est pas supprimé)',
      'repo.removeConfirm': 'Retirer le dépôt "{name}" ? Le dossier lui-même n\'est pas supprimé.',
      'repo.permissionDenied': 'Permission refusée — le dépôt reste inaccessible.',
      'repo.fsaUnsupported': 'La File System Access API n\'est pas disponible dans ce navigateur — utilisez Chrome, Edge ou Brave.',
      'repo.fsaUnsupportedHint': 'La File System Access API n\'est pas disponible dans ce navigateur — utilisez Chrome, Edge ou Brave pour gérer des dépôts.',
      'repo.alreadyRegistered': 'Ce dossier est déjà enregistré comme dépôt.',
      'repo.restoreConfigFound': 'Un fichier de configuration Zettelium a été trouvé dans ce dossier.\nRestaurer les réglages ?',
      'repo.restoreConfigKnownHint': '\n\nDépôts connus (à ré-ajouter manuellement, un par un, via « + Dépôt ») : {names}',

      'settings.screenTitle': 'Réglages',
      'settings.sectionTheme': 'Thème',
      'settings.sectionEditor': 'Éditeur',
      'settings.sectionLanguage': 'Langue',
      'settings.sectionFiles': 'Fichiers',
      'settings.sectionZettelkasten': 'Zettelkasten',
      'settings.themeLight': 'Clair',
      'settings.themeDark': 'Sombre',
      'settings.paletteLabel': 'Palette de couleurs',
      'settings.editColors': 'Modifier les couleurs',
      'settings.fontLabel': 'Police',
      'settings.fontSizeLabel': 'Taille de police',
      'settings.marginXLabel': 'Marge horizontale',
      'settings.marginYLabel': 'Marge verticale',
      'settings.lineSpacingLabel': 'Interligne',
      'settings.extensionsLabel': 'Extensions reconnues',
      'settings.extensionsAllLabel': 'Tous les fichiers (ignorer le filtre)',
      'settings.extensionsAllDesc': 'Affiche tous les fichiers des dépôts, quelle que soit leur extension, et ignore la liste ci-dessus.',
      'settings.autosaveLabel': 'Sauvegarde automatique',
      'settings.autosaveDesc': 'Enregistre la note en cours d\'édition après quelques secondes d\'inactivité.',
      'settings.idPatternLabel': 'Motif de détection d\'ID (regex)',
      'settings.idFormatLabel': 'Format de génération d\'ID',
      'settings.idPreviewMatch': 'Exemple d\'ID généré : {id} (reconnu par le motif de détection)',
      'settings.idPreviewMismatch': 'Exemple d\'ID généré : {id} (⚠ NON reconnu par le motif de détection actuel)',

      'themes.listTitle': 'Thèmes',
      'themes.newTooltip': 'Nouveau thème',
      'themes.nameLabel': 'Nom',
      'themes.duplicateTitle': 'Dupliquer le thème',
      'themes.duplicateTooltip': 'Dupliquer',
      'themes.editTooltip': 'Modifier',
      'themes.deleteTooltip': 'Supprimer',
      'themes.deleteConfirm': 'Supprimer le thème "{name}" ?',
      'themes.nameEmptyError': 'Le nom ne peut pas être vide.',
      'themes.nameTakenError': 'Un thème "{name}" existe déjà.',
      'themes.editTitle': 'Modifier "{name}"',
      'themes.newTitle': 'Nouveau thème',
      'themes.colorBg': 'Fond',
      'themes.colorFg': 'Texte',
      'themes.colorBgSel': 'Sélection',
      'themes.colorHeading': 'Titre',
      'themes.colorComment': 'Commentaire',
      'themes.colorMarkup': 'Balisage',

      'browser.backTooltip': 'Dossier parent (ou retour aux dépôts à la racine)',
      'browser.repoOptionsTooltip': 'Options du dépôt',
      'browser.repoOptionsTitle': 'Options du dépôt',
      'browser.repairTooltip': 'Réparer les liens Zettelkasten de ce dépôt',
      'browser.newNoteTooltip': 'Nouvelle note dans ce dossier',
      'browser.refreshTooltip': 'Rafraîchir la liste',
      'browser.searchName': 'Nom',
      'browser.searchContent': 'Contenu',
      'browser.searchTag': '#Tag',
      'browser.searchPlaceholderName': 'Rechercher par nom…',
      'browser.searchPlaceholderContent': 'Rechercher dans le contenu…',
      'browser.searchPlaceholderTag': 'Rechercher un tag…',
      'browser.tagsTooltip': 'Parcourir les tags',
      'browser.sortByNameTooltip': 'Trier par nom (actuellement : dernière modification)',
      'browser.sortByModifiedTooltip': 'Trier par dernière modification (actuellement : nom)',
      'browser.emptyHintNoFiles': 'Aucun fichier reconnu comme note dans ce dépôt.',
      'browser.emptyHintNoFolder': 'Aucun fichier ni sous-dossier ici.',
      'browser.emptyHintNoResults': 'Aucun résultat.',
      'browser.includeExtensionLabel': 'Inclure l\'extension dans les liens',
      'browser.includeExtensionDesc': 'Certains outils Zettelkasten (QOwnNotes, Zettelnotes) attendent des liens sans extension de fichier.',
      'browser.actionsTooltip': 'Actions (renommer, déplacer, supprimer)',
      'browser.deleteConfirm': 'Supprimer "{name}" ? Cette action est irréversible.',
      'browser.deleteFailed': 'Échec de la suppression : {error}',
      'browser.moveTitle': 'Déplacer',
      'browser.moveFailed': 'Échec du déplacement : {error}',
      'browser.moveWriteFailed': 'Échec du déplacement (écriture de la destination) : {error}',
      'browser.movePartialFailure': 'La note a été copiée vers la destination, mais la suppression de l\'original a échoué : {error}\nLa note existe maintenant en double.',
      'browser.moveRepoLabel': 'Dépôt',
      'browser.moveHereButton': 'Déplacer ici',
      'browser.moveNoSubfolderHint': 'Aucun sous-dossier ici.',
      'browser.moveNoteFileLabel': 'Note : {name}',
      'browser.newNoteTitle': 'Nouvelle note',
      'browser.newNoteInputPlaceholder': 'Nom du fichier',
      'browser.newNoteAlreadyExists': '"{name}" existe déjà dans ce dossier.',
      'browser.newNoteFailed': 'Échec de la création : {error}',
      'browser.repairDone': '{count} note(s) mise(s) à jour.',
      'browser.repairNothing': 'Aucun lien à réparer.',
      'browser.tagsDlgTitle': 'Tags',
      'browser.tagsEmptyHint': 'Aucun tag dans ce dépôt.',

      'editor.closeTooltip': 'Fermer (retour au dépôt)',
      'editor.tocTooltip': 'Table des matières',
      'editor.backlinksTooltip': 'Notes qui font un lien vers celle-ci',
      'editor.previewTooltip': 'Aperçu',
      'editor.editTooltip': 'Édition',
      'editor.saveTooltip': 'Enregistrer (Ctrl+S)',
      'editor.moreTooltip': 'Plus d\'actions',
      'editor.insertId': 'Insérer un ID Zettelkasten',
      'editor.insertLink': 'Insérer un lien',
      'editor.createBackup': 'Créer une sauvegarde',
      'editor.restoreBackup': 'Restaurer une sauvegarde',
      'editor.openFailed': 'Impossible d\'ouvrir "{name}" : {error}',
      'editor.saveFailed': 'Échec de l\'enregistrement : {error}',
      'editor.saveConfirmMsg': 'Enregistrer les modifications de "{name}" avant de fermer ?',
      'editor.saveAndClose': 'Enregistrer et fermer',
      'editor.closeWithoutSaving': 'Fermer sans enregistrer',
      'editor.insertLinkTitle': 'Insérer un lien',
      'editor.linkFilterPlaceholder': 'Filtrer par nom, titre ou ID…',
      'editor.linkEmptyHint': 'Aucune note avec un ID Zettelkasten ne correspond.',
      'editor.backlinksEmptyHint': 'Aucune note ne référence celle-ci pour l\'instant.',
      'editor.tocEmptyHint': 'Aucun titre détecté dans cette note.',
      'editor.tocUntitled': '(sans titre)',
      'editor.backupCreated': 'Sauvegarde créée : {name}',
      'editor.backupFailed': 'Échec de la sauvegarde.',
      'editor.backupRestoreTitle': 'Restaurer une sauvegarde',
      'editor.backupEmptyHint': 'Aucune sauvegarde pour cette note.',
      'editor.conflictMsg': 'Le fichier "{name}" a été modifié en dehors de Zettelium depuis son ouverture.',
      'editor.conflictOverwrite': 'Écraser avec mes modifications',
      'editor.conflictReload': 'Recharger',
      'settings.tocSidebarLabel': 'Table des matières en panneau latéral',
      'settings.tocSidebarDesc': 'Affiche la table des matières dans un panneau à droite de l\'éditeur plutôt que dans une fenêtre temporaire.',
    },
    en: {
      'common.back': 'Back',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.create': 'Create',
      'common.rename': 'Rename',
      'common.delete': 'Delete',
      'common.save': 'Save',
      'common.settings': 'Settings',
      'common.system': 'System',
      'common.renameFailed': 'Rename failed: {error}',

      'repo.addButton': '+ Repository',
      'repo.addTooltip': 'Add a repository (folder)',
      'repo.emptyHint': 'No repository registered. A repository is a real folder on your disk — click "+ Repository" to choose one.',
      'repo.reauthorizeButton': 'Reauthorize',
      'repo.reauthorizeTooltip': 'Access permission for this folder has expired or been revoked',
      'repo.moveUpTooltip': 'Move up',
      'repo.moveDownTooltip': 'Move down',
      'repo.removeTooltip': 'Remove this repository (the real folder is not deleted)',
      'repo.removeConfirm': 'Remove repository "{name}"? The folder itself is not deleted.',
      'repo.permissionDenied': 'Permission denied — the repository remains inaccessible.',
      'repo.fsaUnsupported': 'The File System Access API is not available in this browser — use Chrome, Edge, or Brave.',
      'repo.fsaUnsupportedHint': 'The File System Access API is not available in this browser — use Chrome, Edge, or Brave to manage repositories.',
      'repo.alreadyRegistered': 'This folder is already registered as a repository.',
      'repo.restoreConfigFound': 'A Zettelium configuration file was found in this folder.\nRestore the settings?',
      'repo.restoreConfigKnownHint': '\n\nKnown repositories (re-add manually, one by one, via "+ Repository"): {names}',

      'settings.screenTitle': 'Settings',
      'settings.sectionTheme': 'Theme',
      'settings.sectionEditor': 'Editor',
      'settings.sectionLanguage': 'Language',
      'settings.sectionFiles': 'Files',
      'settings.sectionZettelkasten': 'Zettelkasten',
      'settings.themeLight': 'Light',
      'settings.themeDark': 'Dark',
      'settings.paletteLabel': 'Color palette',
      'settings.editColors': 'Edit colors',
      'settings.fontLabel': 'Font',
      'settings.fontSizeLabel': 'Font size',
      'settings.marginXLabel': 'Horizontal margin',
      'settings.marginYLabel': 'Vertical margin',
      'settings.lineSpacingLabel': 'Line spacing',
      'settings.extensionsLabel': 'Recognized extensions',
      'settings.extensionsAllLabel': 'All files (ignore filter)',
      'settings.extensionsAllDesc': 'Shows every file in each repository regardless of extension, and ignores the list above.',
      'settings.autosaveLabel': 'Autosave',
      'settings.autosaveDesc': 'Saves the note being edited after a few seconds of inactivity.',
      'settings.idPatternLabel': 'ID detection pattern (regex)',
      'settings.idFormatLabel': 'ID generation format',
      'settings.idPreviewMatch': 'Generated ID example: {id} (recognized by the detection pattern)',
      'settings.idPreviewMismatch': 'Generated ID example: {id} (⚠ NOT recognized by the current detection pattern)',

      'themes.listTitle': 'Themes',
      'themes.newTooltip': 'New theme',
      'themes.nameLabel': 'Name',
      'themes.duplicateTitle': 'Duplicate theme',
      'themes.duplicateTooltip': 'Duplicate',
      'themes.editTooltip': 'Edit',
      'themes.deleteTooltip': 'Delete',
      'themes.deleteConfirm': 'Delete theme "{name}"?',
      'themes.nameEmptyError': 'Name cannot be empty.',
      'themes.nameTakenError': 'A theme named "{name}" already exists.',
      'themes.editTitle': 'Edit "{name}"',
      'themes.newTitle': 'New theme',
      'themes.colorBg': 'Background',
      'themes.colorFg': 'Text',
      'themes.colorBgSel': 'Selection',
      'themes.colorHeading': 'Heading',
      'themes.colorComment': 'Comment',
      'themes.colorMarkup': 'Markup',

      'browser.backTooltip': 'Parent folder (or back to repositories at the root)',
      'browser.repoOptionsTooltip': 'Repository options',
      'browser.repoOptionsTitle': 'Repository options',
      'browser.repairTooltip': 'Repair this repository\'s Zettelkasten links',
      'browser.newNoteTooltip': 'New note in this folder',
      'browser.refreshTooltip': 'Refresh the list',
      'browser.searchName': 'Name',
      'browser.searchContent': 'Content',
      'browser.searchTag': '#Tag',
      'browser.searchPlaceholderName': 'Search by name…',
      'browser.searchPlaceholderContent': 'Search in content…',
      'browser.searchPlaceholderTag': 'Search a tag…',
      'browser.tagsTooltip': 'Browse tags',
      'browser.sortByNameTooltip': 'Sort by name (currently: last modified)',
      'browser.sortByModifiedTooltip': 'Sort by last modified (currently: name)',
      'browser.emptyHintNoFiles': 'No file recognized as a note in this repository.',
      'browser.emptyHintNoFolder': 'No file or subfolder here.',
      'browser.emptyHintNoResults': 'No results.',
      'browser.includeExtensionLabel': 'Include file extension in links',
      'browser.includeExtensionDesc': 'Some Zettelkasten tools (QOwnNotes, Zettelnotes) expect links without a file extension.',
      'browser.actionsTooltip': 'Actions (rename, move, delete)',
      'browser.deleteConfirm': 'Delete "{name}"? This action is irreversible.',
      'browser.deleteFailed': 'Deletion failed: {error}',
      'browser.moveTitle': 'Move',
      'browser.moveFailed': 'Move failed: {error}',
      'browser.moveWriteFailed': 'Move failed (writing to destination): {error}',
      'browser.movePartialFailure': 'The note was copied to the destination, but deleting the original failed: {error}\nThe note now exists twice.',
      'browser.moveRepoLabel': 'Repository',
      'browser.moveHereButton': 'Move here',
      'browser.moveNoSubfolderHint': 'No subfolder here.',
      'browser.moveNoteFileLabel': 'Note: {name}',
      'browser.newNoteTitle': 'New note',
      'browser.newNoteInputPlaceholder': 'File name',
      'browser.newNoteAlreadyExists': '"{name}" already exists in this folder.',
      'browser.newNoteFailed': 'Creation failed: {error}',
      'browser.repairDone': '{count} note(s) updated.',
      'browser.repairNothing': 'No links to repair.',
      'browser.tagsDlgTitle': 'Tags',
      'browser.tagsEmptyHint': 'No tag in this repository.',

      'editor.closeTooltip': 'Close (back to repository)',
      'editor.tocTooltip': 'Table of contents',
      'editor.backlinksTooltip': 'Notes linking to this one',
      'editor.previewTooltip': 'Preview',
      'editor.editTooltip': 'Edit',
      'editor.saveTooltip': 'Save (Ctrl+S)',
      'editor.moreTooltip': 'More actions',
      'editor.insertId': 'Insert a Zettelkasten ID',
      'editor.insertLink': 'Insert a link',
      'editor.createBackup': 'Create a backup',
      'editor.restoreBackup': 'Restore a backup',
      'editor.openFailed': 'Could not open "{name}": {error}',
      'editor.saveFailed': 'Save failed: {error}',
      'editor.saveConfirmMsg': 'Save changes to "{name}" before closing?',
      'editor.saveAndClose': 'Save and close',
      'editor.closeWithoutSaving': 'Close without saving',
      'editor.insertLinkTitle': 'Insert a link',
      'editor.linkFilterPlaceholder': 'Filter by name, title, or ID…',
      'editor.linkEmptyHint': 'No note with a Zettelkasten ID matches.',
      'editor.backlinksEmptyHint': 'No note references this one yet.',
      'editor.tocEmptyHint': 'No heading detected in this note.',
      'editor.tocUntitled': '(untitled)',
      'editor.backupCreated': 'Backup created: {name}',
      'editor.backupFailed': 'Backup failed.',
      'editor.backupRestoreTitle': 'Restore a backup',
      'editor.backupEmptyHint': 'No backup for this note.',
      'editor.conflictMsg': 'The file "{name}" was modified outside Zettelium since it was opened.',
      'editor.conflictOverwrite': 'Overwrite with my changes',
      'editor.conflictReload': 'Reload',
      'settings.tocSidebarLabel': 'Table of contents as a side panel',
      'settings.tocSidebarDesc': 'Shows the table of contents in a panel to the right of the editor instead of a temporary window.',
    },
  };

  // 'system' résout `navigator.language` — retombe sur le français si ni
  // anglais ni français (l'app n'a que ces deux traductions, comme
  // l'énumération volontairement ouverte d'Android le permettrait pour de
  // futures langues, mais seules FR/EN existent ici pour l'instant).
  function effectiveLanguage() {
    const lang = State.settings.language;
    if (lang === 'fr' || lang === 'en') return lang;
    const nav = (navigator.language || 'fr').toLowerCase();
    return nav.startsWith('en') ? 'en' : 'fr';
  }

  function t(key, params) {
    const dict = STRINGS[effectiveLanguage()] || STRINGS.fr;
    let str = dict[key] !== undefined ? dict[key] : (STRINGS.fr[key] !== undefined ? STRINGS.fr[key] : key);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.split(`{${k}}`).join(v);
      }
    }
    return str;
  }

  // Locale pour le formatage des dates (`Date.toLocaleString`) — suit la
  // langue choisie dans l'app, pas seulement la langue système, même esprit
  // qu'Android (changer la langue in-app change aussi le format de date).
  function locale() {
    return effectiveLanguage() === 'en' ? 'en-US' : 'fr-FR';
  }

  // Balaie le DOM statique (`template.html`) : `data-i18n` (textContent),
  // `data-i18n-title` (attribut title), `data-i18n-placeholder` (attribut
  // placeholder). Le contenu généré dynamiquement par chaque module
  // (browser.js/editor.js/...) n'est PAS couvert ici — chaque module
  // écoute l'évènement `i18n:apply` pour se rafraîchir lui-même (labels
  // construits avec une icône, listes actuellement affichées, etc.), un
  // couplage plus léger qu'un sweep DOM générique pour ce contenu-là.
  function apply() {
    for (const elx of document.querySelectorAll('[data-i18n]')) {
      elx.textContent = t(elx.dataset.i18n);
    }
    for (const elx of document.querySelectorAll('[data-i18n-title]')) {
      elx.title = t(elx.dataset.i18nTitle);
    }
    for (const elx of document.querySelectorAll('[data-i18n-placeholder]')) {
      elx.placeholder = t(elx.dataset.i18nPlaceholder);
    }
    document.documentElement.lang = effectiveLanguage();
    document.dispatchEvent(new CustomEvent('i18n:apply'));
  }

  return { t, apply, effectiveLanguage, locale };
})();
