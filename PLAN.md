# Zettelium-web — plan d'action

Portage web de [`zettelium-android`](../zettelium-android/) (application
Android de Zettelkasten en syntaxe txt2tags, dépôts multiples, liens/
backlinks, recherche) sur le même principe de portage que la famille
writerdeck : appli autonome, fichier HTML unique, sans bundler ni npm.

Inspiration technique principale :
[`../../writerdeck/writhdeck-web/`](../../../writerdeck/writhdeck-web/)
(portage web du même éditeur txt2tags, JS vanilla partagé sans modules ES,
build via `build.py` → un seul `.html`). Voir la section "Réutilisation"
pour ce qui est repris tel quel, adapté, ou volontairement laissé de côté.

---

## 1. Décision de fond : projet frère, pas un fork de writhdeck-web

`zettelium-web` sera un **projet JS autonome**, construit avec la même
chaîne d'outils que `writhdeck-web` (`build.py` + `Makefile`, un seul
fichier HTML de sortie, JS partageant un scope global sans modules ES), mais
avec un **modèle de données différent** :

- **writhdeck-web** stocke des documents dans un store IndexedDB **plat**
  (`documents`, un seul espace) ; un dossier réel lié via la File System
  Access API est une fonctionnalité *secondaire et optionnelle*
  (`State.dirHandle`, Chromium seulement).
- **zettelium-web** a besoin de **dépôts multiples**, chacun un vrai dossier
  sur disque (équivalent du modèle SAF/`Repository` de zettelium-android) —
  ici, la File System Access API n'est plus une option annexe, elle est
  **le mécanisme de stockage central**. Voir section 2.

Pas de vrai parseur txt2tags ni de liens/tags/recherche côté writhdeck-web
(juste de la coloration syntaxique par regex isolées) : ce moteur est à
porter depuis `zettelium-android`, pas depuis writhdeck-web — voir
section 6.

**Réutilisation par copie/adaptation de code**, comme pour
`zettelium-android` vis-à-vis de `writhdeck-android` — pas de dépendance de
module entre les deux projets.

---

## 2. Décisions d'architecture

| Sujet | Décision | Justification |
|---|---|---|
| Langage / build | JS vanilla, un seul scope global, `build.py`+`Makefile` → fichier HTML unique | Cohérent avec writhdeck-web, pas de bundler/npm à maintenir |
| Stockage des dépôts | **File System Access API** (`window.showDirectoryPicker()`, `FileSystemDirectoryHandle`) — un handle par dépôt, persistés dans IndexedDB (les handles sont structurellement clonables) | Seul mécanisme web donnant un accès dossier réel multi-instances, équivalent du SAF Android ; writhdeck-web l'utilise déjà pour son dossier surveillé optionnel (`State.dirHandle`) — ici généralisé à N dépôts nommés |
| Support navigateur | **Chromium uniquement** (Chrome/Edge/Brave) pour la gestion de dépôts — assumé, pas de repli silencieux | La File System Access API n'existe pas sur Firefox/Safari ; writhdeck-web a déjà ce même renoncement pour ses propres fonctionnalités liées (police système, dossier surveillé) — cohérent de l'assumer aussi pour le cœur de zettelium-web plutôt que de bâtir un mode dégradé complexe |
| Persistance des permissions | `IndexedDB` stocke les `FileSystemDirectoryHandle` (store `repositories`) ; `handle.queryPermission()`/`requestPermission()` revérifiés à l'ouverture de chaque dépôt (jamais garantis silencieusement valides d'une session à l'autre) | Contrainte de la plateforme, pas contournable ; UX : un dépôt dont la permission a expiré affiche un bouton "ré-autoriser" plutôt que de disparaître |
| Recherche | **Index en mémoire** (structures JS, `Map`/tableaux) reconstruit par scan du dépôt (nom, contenu, tags), pas de SQL/FTS en base | Pas de moteur SQL raisonnable dans un navigateur sans SQLite-wasm (jugé disproportionné, comme `Room`/FTS4 l'était déjà un choix "lourd" côté Android justifié par des milliers de notes — le web n'a pas ce même horizon de volume par défaut) ; même principe qu'Android : l'index est une **projection reconstructible**, jamais la source de vérité |
| Indexation incrémentale | Cache par `File.lastModified()` (équivalent du mtime SAF Android), comparé au scan précédent, pour éviter de reparser tout le dépôt à chaque ouverture | Reproduit directement la leçon apprise côté Android (`Indexer`, correctifs post-phase-6 : ~20s sur 360 fichiers sans ce cache) — éviter de redécouvrir le même problème |
| Parseur txt2tags | Port JS de **`zettelium-android/app/src/main/java/com/zettelium/app/parser/`** (`Txt2TagsRegexes.kt`, `Txt2TagsAst.kt`, `Txt2TagsInline.kt`, `Txt2TagsParser.kt`) — pas depuis `writhdeck-web` (aucun vrai parseur là-bas) ni repartant de zéro sur `lionwiki-t2t/txt2tags.js` (bon cross-check de regex mais pas taillé aux besoins Zettelkasten : pas de `ZkLink`, pas de titres markdown ATX) | Le moteur Android encode déjà toutes les décisions/simplifications assumées pour zettelium (voir SKILLS.md android : pas de bloc quote, pas de continuation multi-ligne dans les listes, tableaux sans colspan, pas de macros, `ZkLink` comme inline distinct) — reporter à zéro ce travail de conception serait pur gaspillage |
| Rendu preview | **Rendu HTML réel** depuis l'AST porté (`renderAstToHtml(ast)`), pas juste de la coloration comme writhdeck-web | Contrairement à writhdeck-web (pas de vrai parseur, donc pas de vraie preview HTML), zettelium-android a déjà un vrai AST → ici la cible naturelle est le DOM/HTML, pas `AnnotatedString` Compose |
| Coloration syntaxique de l'éditeur | Reprend la **technique** textarea+overlay de writhdeck-web (`#ed-input`/`#ed-highlight`, voir section 4) mais pilotée par la **même banque de regex que le parseur** porté, pas des regex isolées | Reproduit la décision déjà prise côté Android ("la coloration syntaxique de l'éditeur est désormais pilotée par la même banque de regex que le parseur, plus de duplication ad-hoc") |
| Liens Zettelkasten | Port JS de `ZettelkastenLinks.kt` (génération d'ID à tokens, détection par motif configurable, `[[cible\|zkId]]`, réparation) + `LinkRepair.kt` | Logique pure, déjà stabilisée et testée côté Android (rounds 12/12bis/12ter : pièges déjà rencontrés — motif de détection vs format de génération distincts, `.trim()` sur le motif, cache de réindexation à invalider si le motif change) |
| Tags | Port de `TagExtractor.kt` (`#tag` inline) | Même convention que Android, cohérence multi-plateforme du même dépôt de notes |
| Config | Fichier INI à la racine du dépôt **primaire**, format compatible avec l'INI de writhdeck-web/Tcl (`ini.js` déjà présent et réutilisable tel quel) | writhdeck-web a déjà un parseur/writer INI compatible desktop ; zettelium-android a la même contrainte de durabilité (`DurableConfigSync`/`IniConfigStore.kt`) — même format, remplace le rôle de `SharedPreferences`/`IniConfigStore` par un fichier réel écrit dans le dépôt primaire via la File System Access API |

---

## 3. Modèle de données (esquisse)

```
Repository (persisté dans IndexedDB, store "repositories")
  id: string (uuid généré côté client)
  name: string
  dirHandle: FileSystemDirectoryHandle   -- clonable, persisté directement
  order: number
  colorTag?: string                      -- comme Repository.colorTag Android

État en mémoire, reconstruit au scan d'un dépôt (jamais persisté tel quel) :
NoteIndexEntry
  path: string            -- chemin relatif dans le dépôt (sous-dossiers inclus)
  fileHandle: FileSystemFileHandle
  fileName: string
  zkId: string | null
  title: string           -- 1er titre trouvé, sinon 1er paragraphe, sinon fileName
  tags: string[]
  lastModified: number    -- File.lastModified(), pour le cache incrémental
  content?: string        -- chargé paresseusement, pas gardé pour tout le dépôt

  Index dérivés (Map en mémoire, recalculés à chaque scan/note modifiée) :
  - par nom/mot (recherche "nom")
  - par contenu (recherche "contenu", scan simple des content en cache — pas
    un vrai FTS, acceptable au volume attendu d'un dépôt web)
  - par tag (recherche "#tag", panneau tags)
  - par zkId → path (résolution de lien, backlinks)

Link (backlinks, dérivé, jamais persisté)
  fromPath: string
  toZkId: string
  rawTarget: string        -- "[[fichier|id]]" tel qu'écrit
```

Comme côté Android : **les fichiers texte du dépôt sont la seule source de
vérité.** L'index en mémoire (et son cache `lastModified` en IndexedDB, s'il
s'avère utile de le persister pour accélérer le scan initial d'un gros
dépôt) est une **projection reconstructible** — jamais de donnée métier
critique gardée uniquement en mémoire/IndexedDB.

---

## 4. Réutilisation concrète de writhdeck-web

À reprendre **tel quel ou quasi tel quel** :

- **Technique éditeur textarea+overlay** — `#ed-input` (textarea invisible,
  reçoit la saisie) + `#ed-highlight` (`<pre>` en superposition, rendu via
  `innerHTML = highlight(...)`), scroll synchronisé
  (`writhdeck-web/src/editor.js:4-5` pour les accesseurs, technique décrite
  en détail dans `writhdeck-web/CLAUDE.md` section "Editor: textarea +
  overlay technique"). Rebranchée sur le nouveau `highlight()` piloté par
  les regex du parseur porté (voir section 2).
- **Positionnement pixel-exact** (`linePixelTop`, mirror div caché) pour
  aller-à-la-ligne, recherche, TOC — technique déjà utilisée à l'identique
  côté Android (`FlingEditText.setSelection` y joue un rôle équivalent, mais
  ici la technique DOM de writhdeck-web s'applique directement, pas de
  portage nécessaire).
- **`schemes.js`** (thèmes de couleurs, 18 clés + variantes `*Alt`) — repris
  tel quel comme base, à recouper avec `EditorColorSchemes.kt`
  (zettelium-android) qui porte les **mêmes 8 palettes** (`default`,
  `solarized`, `gruvbox`, `everforest`, `nord`, `alt01`, `alt02`, `retro`) :
  s'assurer que les trois plateformes (Tcl, Android, web) restent
  synchronisées sur les valeurs de couleur.
- **`fonts.js`** (police système détectée/uploadée/dossier) — repris tel
  quel, aucune spécificité Zettelkasten ici.
- **`ini.js`** (parseur/writer INI compatible desktop) — repris tel quel
  pour le fichier de config du dépôt primaire (voir section 2, ligne
  "Config").
- **`toc.js`** — repris presque tel quel ; adapter la détection de titre
  pour accepter aussi les titres markdown ATX (comme
  `Txt2TagsToc.kt`/`Txt2TagsParser.matchHeading` côté Android — même banque
  de regex que le parseur, pas une détection dupliquée).
- **Navigation sous-dossiers** (`State.dirStack`/`State.dirSubdirs`,
  `scanDir()`/`dirEnter()`/`dirUp()` — `writhdeck-web/src/state.js:238-293`,
  câblage UI dans `browser.js:403-483`) — généralisée de "un seul dossier
  surveillé optionnel" à "navigation à l'intérieur du dépôt actif", un des
  N dépôts enregistrés. La recherche reste scopée à **tout le dépôt**, pas
  au dossier navigué (même décision qu'Android, round 11bis).
- **Menu `≡` unique, mode commande (`Alt+C`), raccourcis clavier centralisés,
  barre de statut à tokens, recherche/remplacement, aller-à-la-ligne,
  menu contextuel clic droit** — repris comme squelette UX (voir section 7
  pour ce que zettelium-web y ajoute côté Zettelkasten).

Explicitement **non repris** (hors périmètre zettelkasten, même décision que
`zettelium-android` vis-à-vis de `writhdeck-android`) :
- `timer.js` (minuteur d'écriture).
- `stats.js` (statistiques d'écriture quotidiennes, high-water mark).
- Mode typewriter (`toggleTypewriter`, `writhdeck-web/src/editor.js:567`) —
  à reconsidérer plus tard si utile, pas prioritaire pour un zettelkasten.
- Le store IndexedDB `documents` **plat** de `db.js` — remplacé par le
  modèle multi-dépôts de la section 2 (le `backend.js` pluggable de
  writhdeck-web, qui permet d'substituer `window.WRITHDECK_BACKEND` à
  l'implémentation par défaut, montre que ce genre de substitution est déjà
  un pattern connu de cette base de code — utile à noter, pas forcément à
  reprendre littéralement).

---

## 5. Fonctions Zettelkasten — port direct depuis zettelium-android

Toute la logique métier suivante est déjà conçue et stabilisée côté Android
(des pièges concrets déjà rencontrés et corrigés, rounds 12/12bis/12ter du
`CLAUDE.md` android) — port direct en JS pur, pas de redécouverte :

- **Génération d'ID** à tokens (`%Y%M%D%h%m%s`), configurable
  (`idGenerationFormat`), **distincte** du motif de détection.
- **Détection d'ID** par motif configurable (`idPattern`, défaut `\d{14}`),
  d'abord sur le nom de fichier puis sur le corps **après avoir retiré les
  liens `[[cible|id]]` existants** (piège déjà identifié côté Android :
  confondre l'ID référencé avec l'ID propre).
- **`.trim()` systématique** du motif d'ID au chargement et à l'écriture —
  piège concret déjà rencontré (round 12ter) : un espace de tête invisible
  dans un champ de saisie rend le motif silencieusement inopérant sur
  toutes les notes.
- **Invalidation du cache d'index si le motif d'ID change** (round 12/12bis :
  un changement de motif doit forcer une réindexation complète, sinon les
  notes déjà indexées gardent un `zkId` figé à `null`/obsolète).
- **Format de lien** `[[fichier|zkid]]`, extension de fichier optionnelle
  dans le lien selon réglage par dépôt (`includeExtensionInLinks`, comme
  `Repository.includeExtensionInLinks` Android).
- **Réparation de liens** au renommage/déplacement d'une note et via une
  action manuelle "réparer les liens" scopée dépôt — port de
  `LinkRepair.kt` (attention à la complexité : la version Android a été
  optimisée d'un O(N×M) accidentel vers un scan unique par note régex
  générique, round 16 — reproduire directement la version optimisée, pas
  la naïve).
- **Panneau de backlinks** — notes référençant le zkId de la note courante.
- **Extensions de fichier reconnues comme notes**, configurables (défaut
  `txt, t2t, md`), avec option "désactiver tout filtre" (round 21/22
  Android) — mêmes réglages, même défaut.

---

## 6. Portage du parseur txt2tags

Source **unique et prioritaire** : `zettelium-android/app/src/main/java/com/zettelium/app/parser/`
- `Txt2TagsRegexes.kt` → `regexes.js`
- `Txt2TagsAst.kt` (types `Block`/`Inline`, dont `ZkLink` distinct de
  `Link`) → structures JS (objets `{type, ...}` plutôt que des classes
  scellées Kotlin — JS n'a pas de `sealed class`, un simple champ
  discriminant `type` suffit)
- `Txt2TagsInline.kt` (parseur inline récursif) → `inline.js`
- `Txt2TagsParser.kt` (machine à états ligne par ligne : titres,
  paragraphes, commentaires, listes imbriquées, tableaux, blocs de code,
  liens/images) → `parser.js`

Cross-check pendant le portage : `lionwiki-t2t/txt2tags.js` (~1560 lignes,
implémentation JS complète, contrôle de flux déjà proche de ce qu'on écrit
ici) et la suite de tests Perl `txt2tags_perl/t/0N_*.t` (mêmes cas que ceux
déjà utilisés pour valider le portage Kotlin) — mais **la structure et les
simplifications assumées viennent du Kotlin**, pas de ces deux sources.

Nouveau par rapport au Kotlin : un module `render.js`
(`renderAstToHtml(ast)`) — zettelium-android n'en a pas besoin (rendu natif
Compose direct depuis l'AST), zettelium-web si (cible = DOM/HTML). Les
liens `ZkLink` se rendent comme `<a>` avec un gestionnaire de clic qui
résout par `zkId` via l'index en mémoire du dépôt actif (pas par nom,
même principe qu'Android).

Simplifications explicitement héritées du Kotlin (à ne pas re-décider) :
pas de bloc quote, pas de continuation multi-ligne dans les listes,
tableaux sans colspan, pas de macros.

---

## 7. Structure de projet envisagée

```
zettelium-web/
  build.py
  Makefile
  src/
    schemes.js           -- repris de writhdeck-web (thèmes)
    fonts.js              -- repris de writhdeck-web
    ini.js                -- repris de writhdeck-web (config INI dépôt primaire)
    storage.js            -- NOUVEAU : IndexedDB (dépôts + handles + cache mtime)
    fsa.js                 -- NOUVEAU : wrapper File System Access API
                              (showDirectoryPicker, permissions, lecture/écriture
                              fichier, énumération récursive)
    txt2tags/
      regexes.js          -- port de Txt2TagsRegexes.kt
      ast.js              -- port de Txt2TagsAst.kt
      inline.js           -- port de Txt2TagsInline.kt
      parser.js           -- port de Txt2TagsParser.kt
      render.js           -- NOUVEAU : AST -> HTML (pas d'équivalent Kotlin,
                              Android rend nativement en Compose)
    zettelkasten.js       -- port de ZettelkastenLinks.kt + LinkRepair.kt
    tags.js                -- port de TagExtractor.kt
    index.js               -- NOUVEAU : indexeur en mémoire (scan dépôt,
                              cache par mtime, recherche nom/contenu/tag)
    state.js               -- adapté de writhdeck-web (State.repositories,
                              State.activeRepository, State.dirStack par dépôt)
    highlight.js           -- adapté : pilotée par txt2tags/regexes.js
    editor.js               -- adapté de writhdeck-web (textarea+overlay)
    browser.js              -- adapté : sélecteur de dépôt + sous-dossiers
    backlinks.js            -- NOUVEAU : panneau backlinks
    toc.js                  -- repris de writhdeck-web, détection de titre
                              déléguée à txt2tags/regexes.js
    search.js                -- NOUVEAU : écran recherche nom/contenu/tag
    settings.js               -- adapté (+ réglages Zettelkasten : motif ID,
                                format génération, extensions de fichier)
    style.css
    template.html
  zettelium.html            -- sortie du build, fichier autonome
  CLAUDE.md
  SKILLS.md
```

---

## 8. Phasage

### Phase 1 — Squelette + stockage multi-dépôts (File System Access API)
- `fsa.js` : `showDirectoryPicker()`, persistance du handle en IndexedDB
  (`storage.js`), revérification de permission à l'ouverture.
- Écran "gestion des dépôts" : ajouter/retirer un dépôt, ordonner,
  couleur d'identification (`colorTag`).
- Navigateur de fichiers par dépôt (liste des fichiers reconnus comme notes
  via extensions configurables), sans sous-dossiers dans un premier temps.

### Phase 2 — Éditeur
- Reprise directe de la technique textarea+overlay de writhdeck-web
  (`editor.js` adapté), lecture/écriture de fichier via
  `FileSystemFileHandle.createWritable()`.
- Coloration syntaxique de base (titres txt2tags + markdown ATX limité,
  gras/italique/souligné/barré, commentaires) — regex provisoires, à
  rebrancher sur le vrai parseur en phase 3.

### Phase 3 — Parseur txt2tags complet + rendu preview
- Port `regexes.js`/`ast.js`/`inline.js`/`parser.js` depuis le Kotlin
  d'`zettelium-android` (section 6).
- `render.js` : AST → HTML, preview réelle (pas juste de la coloration).
- Coloration de l'éditeur rebranchée sur `txt2tags/regexes.js` (fin de la
  duplication provisoire de la phase 2).
- Tests unitaires dérivés des mêmes cas que les tests Kotlin/Perl.

### Phase 4 — Recherche
- `index.js` : scan dépôt (récursif), cache par `lastModified`,
  réindexation incrémentale.
- Écran de recherche à 3 modes (nom, contenu, `#tag`), scopée dépôt (et
  éventuellement "tous les dépôts", comme la recherche multi-dépôts
  ajoutée côté Android round 17 — à revalider une fois la base posée).

### Phase 5 — Fonctions Zettelkasten
- `zettelkasten.js` : génération/détection d'ID, `[[cible|zkId]]`,
  réparation de liens.
- `backlinks.js` : panneau backlinks.
- Insertion ID/lien depuis l'éditeur (sélecteur filtrable, comme Android).

### Phase 6 — Finitions
- Sous-dossiers dans le navigateur (généralisation de `scanDir`/
  `dirStack` de writhdeck-web à un dépôt actif quelconque).
- Config durable : fichier INI dans le dépôt primaire (`ini.js` réutilisé).
- Thèmes (recoupement avec les 8 palettes Android), réglages par dépôt.
- Build final (`build.py`/`Makefile`), un seul `zettelium.html`.

---

## 9. Points ouverts / à trancher avant ou pendant l'implémentation

- **Persistance des permissions FSA entre sessions** : Chrome autorise en
  principe la ré-autorisation silencieuse (`queryPermission` renvoie
  `'granted'`) si l'utilisateur a coché "toujours autoriser" au premier
  accès, mais ce n'est pas garanti sur tous les profils/politiques — prévoir
  systématiquement un état "dépôt en attente de ré-autorisation" dans l'UI,
  jamais une erreur silencieuse.
  - **Note (2026-07-14)** : les tests seront faits en priorité sur l'appareil
    de bureau de l'utilisateur (Linux Mint "saraswati", RTX 3060) plutôt
    qu'un profil mobile — Chromium desktop a le comportement de permission
    le plus prévisible pour cette API, cf. [[reference_pcdoctor_docs]] pour
    le contexte matériel de cette machine si un souci de profil Chrome s'y
    présente.
- **Volume de notes raisonnable pour un index en mémoire** : à valider
  empiriquement une fois la phase 4 posée (le dépôt réel de l'utilisateur
  fait ~360 fichiers d'après les tests Android — probablement sans souci en
  mémoire JS, mais à mesurer, pas supposer).
- **PWA / installabilité** : hors périmètre de ce plan initial (writhdeck-web
  ne semble pas en être une non plus) — à reconsidérer si l'usage hors-ligne
  s'avère souhaité.

---

## 10. Références externes consultées

- [[project_writerdeck_family]] — famille de portages du même éditeur,
  convention de documentation (`CLAUDE.md`/`SKILLS.md` par sous-système).
- `../../writerdeck/writhdeck-web/CLAUDE.md` — architecture détaillée du
  portage web de référence (technique éditeur, thèmes, menu/raccourcis,
  navigation sous-dossiers).
- `../zettelium-android/PLAN.md` et `CLAUDE.md` — plan d'origine et journal
  chronologique complet des décisions/corrections du portage Android,
  source de vérité pour toute la logique Zettelkasten/parseur à porter ici.
- [[reference_txt2tags_implementations]] — implémentations txt2tags
  portables disponibles sur le disque, dont `lionwiki-t2t/txt2tags.js`
  (cross-check JS pendant le portage, voir section 6).
