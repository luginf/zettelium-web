'use strict';
// In-memory search/Zettelkasten index — one entry per note, keyed by
// repo-relative path. Ported in spirit from zettelium-android's
// `data/storage/Indexer.kt`/`LinkRepair.kt`, adapted to the "in-memory, no
// SQL/FTS" model decided in PLAN.md section 2: the index is a
// **reconstructible projection**, never the source of truth — the repo's
// files are. Recursive (covers subfolders) even though the browser UI
// itself stays flat until phase 6 (see fsa.js).
const Index = (() => {
  const byRepo = new Map(); // repositoryId -> { entries: Map<path, entry>, lastIdPattern }

  function ensure(repositoryId) {
    if (!byRepo.has(repositoryId)) byRepo.set(repositoryId, { entries: new Map(), lastIdPattern: null });
    return byRepo.get(repositoryId);
  }

  // Premier titre (Heading txt2tags/markdown) *détecté*, sans repli sur un
  // paragraphe ni sur le nom de fichier — distinct de `title` (utilisé pour
  // l'indexation/recherche par nom, qui a ce repli). Sert à l'affichage
  // dans le sélecteur de lien / panneau de backlinks (demande explicite :
  // "affiche le nom du fichier de la note, et ensuite seulement le premier
  // titre détecté" — jamais une valeur de repli qui dupliquerait le nom).
  function firstHeadingText(blocks) {
    for (const b of blocks) {
      if (b.type !== 'Heading') continue;
      const t = Txt2TagsSummary.plainText(b.inlines).trim();
      if (t) return t;
    }
    return null;
  }

  function buildEntry(file, content, indexedAt, idRegex) {
    const blocks = Txt2TagsParser.parse(content);
    const title = Txt2TagsSummary.extractTitle(blocks, file.name);
    const heading = firstHeadingText(blocks);
    const tags = TagExtractor.extract(content);
    const zkId = ZettelkastenLinks.extractId(file.name, content, idRegex);
    const links = ZettelkastenLinks.findLinks(content);
    return {
      path: file.path, name: file.name, fileHandle: file.fileHandle,
      title, heading, tags, zkId, links, content,
      lastModified: file.lastModified, lastIndexed: indexedAt,
    };
  }

  /**
   * Scan complet d'un dépôt : ne relit/reparse que les fichiers nouveaux ou
   * modifiés depuis la dernière indexation (comparaison sur `lastModified`)
   * — même raisonnement qu'Android (`Indexer.indexRepository`) : rouvrir un
   * gros dépôt sans ce filtre reparse tout à chaque fois.
   *
   * `forceFull` contourne ce cache — nécessaire (et déclenché automatiquement
   * ici, pas seulement sur demande explicite) quand `idPattern` a changé
   * depuis la dernière passe complète *de ce dépôt* : sinon une note déjà
   * indexée garderait un `zkId` figé, calculé avec l'ancien motif, tant que
   * son fichier ne change pas (bug réel côté Android, rounds 12/12bis/12ter
   * — motif personnalisé silencieusement "ignoré").
   */
  async function indexRepository(repo, { forceFull = false } = {}) {
    const state = ensure(repo.id);
    const idPatternChanged = state.lastIdPattern !== State.settings.idPattern;
    const effectiveForceFull = forceFull || idPatternChanged;

    let files;
    try {
      files = await FSA.listNoteFilesRecursive(
        repo.dirHandle, noteExtensionsList(), State.settings.noteExtensionsFilterDisabled);
    } catch (e) {
      console.error(`Impossible de lister les fichiers du dépôt "${repo.name}"`, e);
      return;
    }

    const idRegex = ZettelkastenLinks.compileIdRegex(State.settings.idPattern);
    const now = Date.now();
    const currentPaths = new Set(files.map(f => f.path));

    for (const file of files) {
      const existing = state.entries.get(file.path);
      if (!effectiveForceFull && existing && existing.lastModified === file.lastModified) continue;
      let content;
      try {
        content = await FSA.readFileText(file.fileHandle);
      } catch (e) {
        // Une note illisible ne doit jamais faire échouer l'indexation des
        // autres — on l'ignore et on continue (même principe qu'Android).
        console.error(`Échec d'indexation de "${file.path}"`, e);
        continue;
      }
      state.entries.set(file.path, buildEntry(file, content, now, idRegex));
    }

    for (const path of [...state.entries.keys()]) {
      if (!currentPaths.has(path)) state.entries.delete(path);
    }

    state.lastIdPattern = State.settings.idPattern;
  }

  /** Réindexation incrémentale d'une seule note (après une sauvegarde réussie), sans rescanner tout le dépôt. */
  async function indexNote(repositoryId, file, content) {
    const state = ensure(repositoryId);
    const idRegex = ZettelkastenLinks.compileIdRegex(State.settings.idPattern);
    let lastModified = file.lastModified;
    try {
      lastModified = (await file.fileHandle.getFile()).lastModified;
    } catch (_) {
      // conserve la valeur fournie par l'appelant
    }
    state.entries.set(file.path, buildEntry({ ...file, lastModified }, content, Date.now(), idRegex));
  }

  function entries(repositoryId) {
    const state = byRepo.get(repositoryId);
    return state ? [...state.entries.values()] : [];
  }

  function findByPath(repositoryId, path) {
    const state = byRepo.get(repositoryId);
    return state ? state.entries.get(path) : undefined;
  }

  function findByZkId(repositoryId, zkId) {
    if (!zkId) return undefined;
    return entries(repositoryId).find(e => e.zkId === zkId);
  }

  function backlinksFor(repositoryId, zkId, excludePath) {
    return entries(repositoryId).filter(e => e.path !== excludePath && e.links.some(l => l.zkId === zkId));
  }

  async function repairEntry(repositoryId, entry, transform) {
    const newContent = transform(entry.content);
    if (newContent === entry.content) return false;
    try {
      const writable = await entry.fileHandle.createWritable();
      await writable.write(newContent);
      await writable.close();
    } catch (e) {
      console.error(`Échec de réparation de "${entry.path}"`, e);
      return false;
    }
    await indexNote(repositoryId, entry, newContent);
    return true;
  }

  /**
   * Réécrit, dans les autres notes du dépôt, les liens `[[ancienNom|zkId]]`
   * obsolètes pointant vers `zkId` — appelé à l'ouverture d'une note pour
   * rattraper un renommage fait hors de l'app depuis la dernière fois
   * (`excludePath` = la note qu'on est en train d'ouvrir, jamais réécrite
   * elle-même). Suppose l'index déjà à jour (appeler après indexRepository).
   */
  async function repairBacklinksFor(repositoryId, zkId, currentTarget, excludePath) {
    for (const entry of backlinksFor(repositoryId, zkId, excludePath)) {
      await repairEntry(repositoryId, entry, content => ZettelkastenLinks.repairLinks(content, zkId, currentTarget));
    }
  }

  /**
   * Scan complet d'un dépôt : reconstruit la table zkId -> nom courant,
   * réécrit tous les liens obsolètes. Retourne le nombre de notes
   * modifiées. Un seul scan générique du contenu par note (pas une
   * compilation de regex + un scan complet par zkId connu du dépôt, soit
   * O(notes × zkId) au total) — ne tente de réparer que les zkId
   * réellement référencés dans CETTE note (même optimisation qu'Android,
   * round 16 : la version naïve était la cause probable des lenteurs déjà
   * "corrigées" par un simple indicateur de chargement).
   */
  async function repairAllLinks(repositoryId, repo) {
    const extensions = noteExtensionsList();
    const includeExtension = !!(repo && repo.includeExtensionInLinks);
    const all = entries(repositoryId);
    const currentTargetByZkId = new Map();
    for (const e of all) {
      if (e.zkId) currentTargetByZkId.set(e.zkId, ZettelkastenLinks.linkTarget(e.name, includeExtension, extensions));
    }
    let repairedCount = 0;
    for (const entry of all) {
      const repaired = await repairEntry(repositoryId, entry, content => {
        const referenced = new Set(ZettelkastenLinks.findLinks(content).map(l => l.zkId));
        let newContent = content;
        for (const zkId of referenced) {
          const target = currentTargetByZkId.get(zkId);
          if (target === undefined) continue;
          newContent = ZettelkastenLinks.repairLinks(newContent, zkId, target);
        }
        return newContent;
      });
      if (repaired) repairedCount++;
    }
    return repairedCount;
  }

  return { indexRepository, indexNote, entries, findByPath, findByZkId, backlinksFor, repairBacklinksFor, repairAllLinks };
})();
