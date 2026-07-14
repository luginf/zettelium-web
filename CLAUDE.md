# Zettelium-web

Portage web de [`zettelium-android`](../zettelium-android/), sur le principe
de portage déjà utilisé par la famille writerdeck (voir
[`../../writerdeck/writhdeck-web/`](../../../writerdeck/writhdeck-web/)
pour le portage web frère).

Voir `PLAN.md` pour le plan d'action complet (décisions d'architecture,
modèle de données, réutilisation de writhdeck-web, portage du parseur
txt2tags, phasage) et `SKILLS.md` (à créer au démarrage de la phase 1)
pour la référence développeur.

## Statut

**Phase 1 implémentée (2026-07-14)** — squelette + stockage multi-dépôts
(voir PLAN.md section 8) :
- Build : `build.py` + `Makefile` → `zettelium.html` (fichier unique, pas de
  bundler), sur le modèle exact de writhdeck-web. `src/schemes.js` repris
  tel quel (verbatim) ; `app.js` applique déjà la palette "default" sombre
  via `applyTheme()` — le sélecteur de thème complet reste phase 6.
- `src/storage.js` : IndexedDB (`zettelium`, stores `repositories` +
  `meta`), adapté de `db.js` writhdeck-web.
- `src/fsa.js` : wrapper File System Access API (picker, vérification/
  demande de permission, énumération de fichiers reconnus comme notes —
  extensions configurables, réglage global comme
  `AppSettings.noteExtensions` côté Android).
- `src/state.js` : registre des dépôts (ajout/retrait/réordonnancement/
  ré-autorisation), liste de fichiers du dépôt actif (plate, pas de
  sous-dossiers — phase 6).
- `src/repositories.js` / `src/browser.js` : écran liste des dépôts et
  écran navigateur de fichiers par dépôt, plus un aperçu **lecture seule**
  du contenu d'un fichier (`<pre>`, pas l'éditeur réel — ça, c'est la
  phase 2) servant à vérifier la couche de stockage de bout en bout avant
  de construire l'éditeur.
- **Mise à jour (2026-07-14)** : les phases 2 à 6 sont maintenant toutes
  implémentées — voir plus bas pour le détail complet, phase par phase,
  ainsi que les rounds de retours utilisateur qui ont suivi. Ne pas se fier
  à cette phrase (phase 1 uniquement) pour évaluer l'état global du projet.

**Phase 2 implémentée (2026-07-14, même session)** — éditeur :
- `src/editor.js` : reprend la technique textarea+overlay de writhdeck-web
  (`#ed-input`/`#ed-highlight`), lecture/écriture réelle via
  `FileSystemFileHandle.createWritable()`, suivi `dirty` + confirmation à
  3 boutons avant fermeture (Enregistrer et fermer / Fermer sans
  enregistrer / Annuler — `#close-confirm-dlg`, même raisonnement que
  writhdeck-web : un `confirm()` natif à 2 boutons ne permet pas d'annuler
  la fermeture). `Ctrl+S` pour enregistrer.
- **Volontairement pas repris** de writhdeck-web à ce stade : l'optimisation
  de repaint incrémental ligne par ligne (`_tryIncrementalRepaint`,
  justifiée là-bas par des documents de 90k mots), le mode typewriter, le
  curseur bloc, le mode commande/menu ≡ complet — `rehighlight()` complet à
  chaque frappe suffit à l'échelle d'une note de zettelkasten ; à
  reconsidérer si un besoin réel se présente.
- Le navigateur de fichiers (phase 1) ouvre désormais directement l'éditeur
  au clic sur un fichier — l'aperçu lecture-seule temporaire de la phase 1
  (`#preview-dlg`) a été retiré (superflu maintenant que l'éditeur existe).

**Phase 3 implémentée (2026-07-14, même session)** — parseur txt2tags
complet + aperçu réel :
- `src/txt2tags/regexes.js` / `ast.js` / `inline.js` / `parser.js` : port
  JS fidèle des 4 fichiers Kotlin `zettelium-android/.../parser/Txt2Tags*.kt`
  (regex bank, AST à `type` discriminant plutôt que sealed class,
  parseur inline récursif, machine à états bloc) — mêmes simplifications
  assumées (pas de bloc quote, pas de continuation multi-ligne dans les
  listes, tableaux sans colspan, pas de macros). Les chaînes de regex
  composées (URL/email/liens) utilisent `String.raw` pour éviter le piège
  du double-échappement (une chaîne JS normale interprète `\b`/`\d` comme
  des séquences d'échappement de *chaîne*, pas du regex).
- `src/txt2tags/render.js` (nouveau, pas d'équivalent Kotlin — Android rend
  l'AST nativement en Compose) : AST → HTML pour l'aperçu réel. **Déviation
  délibérée de la sémantique txt2tags d'origine** : les blocs
  `"""raw"""`/`'''tagged'''`/```` ```verbatim``` ```` et les inlines
  `""raw""`/`''tagged''` sont rendus en texte échappé, jamais injectés tels
  quels dans le DOM — l'original txt2tags les traite comme du passe-plat
  vers la syntaxe native de la cible (HTML brut non échappé pour une cible
  HTML), mais ici la "cible" est le DOM de l'appli elle-même : un fichier de
  dépôt reste une entrée non fiable (partagée/synchronisée depuis ailleurs),
  l'injecter tel quel serait un risque d'auto-XSS.
- `src/highlight.js` réécrit pour piloter la coloration syntaxique de
  l'éditeur par `Txt2TagsRegexes` (titres txt2tags/markdown ATX, `%`
  commentaire, gras/italique/souligné/barré) — mêmes règles que le
  parseur, pas de banque de regex dupliquée (même principe que
  `SyntaxHighlighting.kt` côté Android). `ZkLink` rendu comme `<span
  class="zk-link">` non cliquable (résolution par zkId = phase 5, index
  Zettelkasten pas encore construit) ; `Image` rendu comme espace réservé
  textuel (résolution réelle via FSA = raffinement ultérieur, même
  séquencement qu'Android où le rendu d'image n'est arrivé qu'au round 17).
- Bouton "Aperçu"/"Édition" dans l'éditeur bascule entre `#ed-wrap`
  (édition) et `#ed-preview` (rendu HTML).

**Tests** : `test/cases.js` + `test/run.js` (`make test`) — 46 cas dérivés
1:1 de `Txt2TagsParserTest.kt`/`Txt2TagsInlineTest.kt` (zettelium-android)
plus quelques cas propres à `render.js`/`highlight.js` (sans équivalent
Kotlin). `run.js` concatène les sources txt2tags + `highlight.js` +
`cases.js` en une seule chaîne puis l'exécute via `eval` direct dans le
scope du runner (même convention "un seul scope global, pas de modules ES"
que `build.py` ; permet à `require('node:test')`/`require('node:assert')`
dans `cases.js` de résoudre normalement malgré le mode strict du code
concaténé — un `eval` direct strict isole seulement ses propres
déclarations, pas la résolution des noms venant d'une portée englobante).
Tous ces modules sont indépendants du DOM (texte en, texte/objets en sortie)
donc testables en pur Node sans jsdom/navigateur.

**Phase 4 implémentée (2026-07-14, même session)** — recherche :
- `src/index.js` : index en mémoire, une entrée par note, clé = chemin
  relatif au dépôt (`path`, sous-dossiers inclus — `FSA.listNoteFilesRecursive`,
  nouveau dans `fsa.js`). `Index.indexRepository(repo, {forceFull})` scanne
  tout le dépôt mais ne reparse que les fichiers dont `lastModified` a
  changé depuis la dernière passe (même optimisation qu'Android,
  `Indexer.kt` — évite de tout reparser à chaque ouverture). Force
  automatiquement une passe complète si `State.settings.idPattern` a changé
  depuis la dernière passe *de ce dépôt* (comparaison passive à chaque
  appel, pas besoin d'un déclencheur explicite séparé — même résultat que
  le mécanisme à deux volets d'Android rounds 12/12bis, en plus simple ici
  car pas de cache Room à invalider séparément). `Index.indexNote(...)`
  réindexe une seule note après une sauvegarde réussie, sans rescanner tout
  le dépôt.
- **Recherche indexée récursivement dès la phase 4**, même si le navigateur
  de fichiers reste plat jusqu'à la phase 6 — décision déjà actée dans
  PLAN.md section 8 (la recherche doit couvrir tout l'arbre) ; Android avait
  fait la même chose (son indexeur a eu la récursivité, round 11bis, avant
  que `BrowserScreen` sache naviguer dans les sous-dossiers).
- Recherche à 3 modes (nom, contenu, `#tag`), scopée au dépôt actif — la
  recherche multi-dépôts (ajoutée côté Android au round 17, après une base
  déjà solide) est délibérément laissée de côté pour l'instant, comme prévu
  par PLAN.md ("à revalider une fois la base posée"). Initialement un écran
  `search.js` séparé, **fusionné dans `browser.js` au round 1** (retour
  utilisateur, voir plus bas) en une barre de recherche permanente.
  `Browser.reindexActive()` réindexe le dépôt actif en arrière-plan à
  l'ouverture/au rafraîchissement du navigateur (pas attendue — le bouton
  réparer est désactivé pendant qu'elle tourne).

**Phase 5 implémentée (2026-07-14, même session)** — fonctions Zettelkasten :
- `src/zettelkasten.js` : port 1:1 de `parser/ZettelkastenLinks.kt`
  (génération d'ID à tokens, détection par motif configurable avec
  `.trim()` au chargement ET à l'écriture — piège round 12ter Android, un
  espace de tête invisible dans un champ de saisie rendait le motif
  silencieusement inopérant —, `[[cible|zkId]]`, réparation de liens,
  extension de fichier optionnelle dans le lien). `src/tags.js` (port de
  `TagExtractor.kt`, `#tag` inline via regex Unicode `\p{L}`, flag `u`
  requis en JS). `src/txt2tags/summary.js` (port de `Txt2TagsSummary.kt`,
  `plainText`/`extractTitle` — nécessaires pour le titre indexé).
- `Index.repairBacklinksFor`/`repairAllLinks` (dans `index.js`) : port de
  `LinkRepair.kt`, **déjà optimisé** dès l'écriture (un seul scan générique
  du contenu par note, pas une compilation de regex par zkId connu du dépôt
  × chaque note — l'inverse, O(N×M), était la cause probable des lenteurs
  qu'Android n'a vraiment corrigée qu'au round 16, après coup).
  `repairBacklinksFor` tourne automatiquement à l'ouverture d'une note (si
  elle a un zkId) pour rattraper un renommage fait hors de l'app ;
  `repairAllLinks` est une action manuelle par dépôt (bouton 🔗 dans
  `browser.js`).
- `editor.js` : boutons "ID" (insertion directe), "🔗" (sélecteur de lien
  filtrable par nom/titre/ID — `#zklink-picker-dlg`, filtre déjà étendu à
  l'ID dès le départ, pas seulement le nom : piège round 19 Android évité
  d'emblée), "⛓" (panneau backlinks — `#backlinks-dlg`). Les `ZkLink`
  résolus dans l'aperçu (`render.js`, `opts.resolveZkLink`) sont désormais
  cliquables (`<a data-zk-path>`, délégation d'événement sur `#ed-preview`).
- **Garde-fou "enregistrer avant de quitter" généralisé dès le départ à
  toute sortie de note** (fermeture, suivre un backlink, cliquer un ZkLink
  résolu dans l'aperçu) via `requestLeave()`/`openOther()` — Android n'avait
  ce garde-fou que sur le bouton retour au début, et perdait silencieusement
  des modifications en suivant un lien jusqu'à son round 19 ; corrigé ici
  dès l'implémentation plutôt que redécouvert plus tard.
- Réglage par dépôt `Repository.includeExtensionInLinks` (case à cocher
  dans la barre d'extensions du navigateur) et réglages globaux
  `idPattern`/`idGenerationFormat` (pas encore d'écran Réglages dédié —
  phase 6 ; en attendant, `idPattern`/`idGenerationFormat` sont dans
  `State.settings` avec leurs valeurs par défaut, modifiables uniquement en
  base IndexedDB pour l'instant s'il fallait les changer avant la phase 6).

**Tests** : 85 cas au total (`make test`) — 46 de phases 2/3 plus 39
nouveaux dérivés 1:1 de `Txt2TagsSummaryTest.kt`/`TagExtractorTest.kt`/
`ZettelkastenLinksTest.kt` (zettelium-android). `index.js`/`browser.js`/
`settings.js`/`editor.js` ne sont pas dans la suite de tests Node (ils
touchent le DOM réel, pas de jsdom dans ce projet) — seuls les modules
purs (texte/objets en entrée-sortie) sont couverts.

Vérifié : `node --check` sur tous les fichiers JS + tests, build sans
placeholder `{{...}}` résiduel, 85/85 tests passent (`make test`).
**Non vérifié en conditions réelles** (limite déjà rencontrée en phase 1,
toujours vraie) : tout ce qui touche au DOM réel — `showDirectoryPicker()`,
le rendu effectif de l'éditeur/aperçu/recherche/backlinks dans un
navigateur, l'indexation d'un vrai dépôt — n'a pas pu être exercé de bout
en bout ici. Le Chrome headless disponible dans cet environnement (v99,
sandboxé, sans profil/dbus fonctionnel) ne fait même pas aboutir un
`indexedDB.open()` isolé, et `showDirectoryPicker()` exige de toute façon
un geste utilisateur réel. À tester par l'utilisateur dans un vrai
Chrome/Edge/Brave desktop — même principe que zettelium-android (tests sur
device réel, pas d'émulateur/environnement interactif côté Claude). Point
à surveiller en particulier : le temps de première indexation sur un vrai
dépôt de plusieurs centaines de fichiers (Android avait rapporté ~20s sur
360 fichiers avant son cache incrémental — le cache existe ici dès le
départ, mais la toute première passe complète reste à mesurer en réel).

**Round 1 (2026-07-14, retour utilisateur) — écran Réglages, recherche
permanente, tri** :
- **Nouvel écran `#settings-screen`** (module `settings.js`), accessible
  via l'icône ⚙ de l'écran liste des dépôts (`#repo-settings-btn`) — même
  emplacement que `SettingsScreen` côté Android ("accessible depuis l'icône
  réglages de RepositoryPickerScreen"). Contient les réglages globaux
  auparavant coincés dans la barre du navigateur : section "Fichiers"
  (extensions reconnues, bascule "tous les fichiers") et section
  "Zettelkasten" (motif de détection d'ID, format de génération), avec un
  aperçu en direct de l'ID que produirait le format actuel et s'il est
  reconnu par le motif actuel — aide visuelle portée du round 18 Android.
- **`Repository.includeExtensionInLinks` déplacé dans un dialogue "Options
  du dépôt"** (`#repo-options-dlg`, icône ⚙ dans l'en-tête du navigateur de
  fichiers) plutôt que dans les réglages globaux — c'est un réglage *par
  dépôt*, pas global, contrairement aux extensions/motif d'ID ; suit le même
  découpage qu'Android (options de dépôt vs. écran réglages global).
- **Barre "extensions" du navigateur remplacée par une recherche
  permanente** (`#browser-search-bar`, module `Browser` fusionné —
  `search.js` et son écran séparé sont retirés) : contrairement à Android
  où l'espace écran est compté, le web a la place pour garder la recherche
  visible en permanence plutôt que derrière un bouton 🔍 séparé. Le champ
  vide affiche la liste plate habituelle (racine du dépôt, triée) ; dès
  qu'une requête est tapée, la liste bascule sur `Index.entries()` (portée
  récursive, sous-dossiers inclus) filtrée par le mode actif (Nom/Contenu/
  #Tag) — un `setTimeout` de 150 ms débounce la frappe pour la recherche en
  contenu (parcourt le texte intégral de chaque note à chaque appel, pas
  d'index inversé — coût déjà assumé en phase 4, le débounce évite juste de
  le payer à chaque caractère tapé).
- **Icône de tri** (`#browser-sort-btn`, 🔤 ↔ 🕒) faisant basculer
  `AppSettings.noteSortOrder`-équivalent (`State.settings.noteSortOrder`,
  `'name'`/`'modified'`, persisté) — même réglage qu'Android round 3,
  absent jusqu'ici côté web. S'applique à la fois à la liste plate et aux
  résultats de recherche, pour un comportement prévisible peu importe le
  mode d'affichage.

**Round 2 (2026-07-14, retour utilisateur) — deux bugs** :
- **Le bandeau du haut de l'éditeur (`#ed-header`) disparaissait en
  scrollant** : `html, body` n'avaient pas `overflow: hidden` — chaque
  écran est censé être son propre conteneur flex `height: 100vh` avec sa
  propre zone défilante interne (`#ed-input`, `#browser-list`, etc.), mais
  sans cette règle, un défilement qui atteint la limite de la zone interne
  "chaîne" (scroll chaining) vers le document lui-même, qui a alors de la
  place pour défiler et pousse tout — y compris le bandeau, pourtant
  `flex-shrink: 0` dans son propre conteneur — hors de vue. Corrigé en
  ajoutant `overflow: hidden` sur `html, body` (la page elle-même ne doit
  jamais défiler) et `overscroll-behavior: contain` sur toutes les zones
  défilantes réelles (`#ed-input`, `#ed-preview`, `#repo-list`,
  `#browser-list`, `#settings-body`, `#zklink-list`/`#backlinks-list`) en
  défense en profondeur contre le rebond/chaînage sur trackpad ou tactile.
- **`Ctrl+Z` n'annulait pas l'insertion d'un ID/lien Zettelkasten** :
  `insertAtCursor()` (utilisée par les boutons "ID" et "Insérer un lien")
  réassignait `input.value` en entier (`value.slice(...) + text +
  value.slice(...)`) — réassigner `.value` par script efface l'historique
  d'annulation natif du textarea dans Chrome/Firefox, contrairement à une
  frappe réelle. Corrigé avec `document.execCommand('insertText', false,
  text)` : le navigateur traite alors l'insertion comme une vraie frappe
  (événements `beforeinput`/`input` natifs), intégrée à l'historique
  annuler/rétablir, sans effacer ce qui précède. Nécessite de redonner le
  focus au textarea avant l'appel (le bouton cliqué l'avait volé), ce qui
  ne modifie pas `selectionStart`/`selectionEnd` — l'insertion atterrit
  donc toujours au bon endroit. Repli sur l'ancienne méthode (fonctionnelle
  mais sans historique d'annulation pour cette frappe) si `execCommand`
  n'est pas disponible.

**Round 3 (2026-07-14, retour utilisateur) — table des matières, affichage
des liens entre notes** :
- **Table des matières** (`src/txt2tags/toc.js`, port de `Txt2TagsToc.kt`) :
  nouveau bouton 📑 dans l'éditeur ouvrant `#toc-dlg`, liste des titres
  indentée par niveau. Même détection de titre que le parseur (banque
  `Txt2TagsRegexes`, même ordre title/numtitle/markdownHeading, **aucun
  filtre sur un titre vide** — même piège d'origine évité qu'Android round
  16 : diverger sur ce point casserait la correspondance 1-pour-1 entre
  entrées de TOC et titres réellement rendus). Clic sur une entrée : en
  édition, place le curseur et fait défiler jusqu'à la ligne via la
  technique du "mirror div" (`pixelTopForOffset()`, portée de
  `linePixelTop()` de writhdeck-web — mesure la position pixel réelle en
  tenant compte du retour à la ligne automatique) ; en aperçu, les entrées
  correspondent 1 pour 1 et dans l'ordre aux `<h1>`-`<h6>` du DOM rendu,
  donc `querySelectorAll('#ed-preview h1,h2,h3,h4,h5,h6')[index]` suffit
  pour cibler le bon `scrollIntoView()`.
- **Affichage nom-puis-titre dans le sélecteur de lien et le panneau de
  backlinks** (demande explicite) : `index.js` calcule désormais un champ
  `heading` distinct de `title` — `title` (utilisé pour l'indexation/
  recherche par nom) a un repli sur le premier paragraphe puis sur le nom
  de fichier ; `heading` n'a **aucun repli** (premier `Heading` non vide
  détecté, ou `null`). `editor.js` : `renderNoteItem()` (factorisée, utilisée
  par les deux panneaux) affiche toujours le nom de fichier en premier, puis
  `entry.heading` seulement s'il existe — jamais une valeur dupliquant le
  nom. Le zkId reste disponible en info-bulle (`title` HTML de l'élément)
  pour le débogage, mais n'est plus affiché en clair dans la liste.

**Phase 6 implémentée (2026-07-14, même session)** — finitions :
- **Navigation par sous-dossiers** dans le navigateur de fichiers,
  généralisant le couple `dirStack`/`scanDir` de writhdeck-web (jusque-là
  pensé pour un unique dossier surveillé optionnel) au dépôt actif
  quelconque : `FSA.listChildren()` (nouveau, remplace `listNoteFiles`)
  liste fichiers ET sous-dossiers d'UN niveau ; `State.dirStack`/
  `dirEnter()`/`dirUp()` (state.js) maintiennent la position ; `browser.js`
  affiche `..` (si pas à la racine) puis les dossiers puis les fichiers,
  façon gestionnaire de fichiers classique. Le bouton retour de l'éditeur de
  fichiers remonte d'abord d'un niveau, ne quitte le dépôt qu'à la racine
  (même comportement que `BrowserScreen` côté Android). La recherche reste
  volontairement non affectée : elle interroge toujours `Index.entries()`
  (portée récursive) quel que soit le dossier navigué, comme sur Android.
- **Config durable** (`zettelium.ini`, écrit dans le dépôt *primaire* — le
  premier par ordre d'affichage) : **déviation assumée par rapport au plan
  initial**, qui prévoyait de réutiliser `ini.js` de writhdeck-web "tel
  quel" — en pratique, ce fichier est entièrement spécifique aux réglages
  de writhdeck (thèmes/profils/minuteur/marges...), aucun ne s'applique à
  zettelium ; le réutiliser aurait importé du code mort et des tables de
  correspondance trompeuses. `src/ini.js` a donc été réécrit, minimal,
  propre à zettelium (extensions, motif/format d'ID, tri, thème), en gardant
  le même *format* (`[section]` + `clé = valeur`) pour cohérence stylistique
  avec la famille writerdeck et lisibilité humaine. Écriture débouncée
  500 ms (`state.js` `scheduleDurableExport()`, même raisonnement qu'Android
  round 18 : plusieurs réglages modifiés coup sur coup ne doivent déclencher
  qu'une seule écriture). À l'ajout d'un nouveau dépôt, `maybeRestoreDurableConfig()`
  détecte un `zettelium.ini` déjà présent dans le dossier choisi (typiquement
  après une purge des données du navigateur — IndexedDB vidée, donc plus
  aucun `FileSystemDirectoryHandle`) et propose de restaurer les réglages ;
  la liste de noms de dépôts connus qu'il contient reste **purement
  informative**, aucun dépôt n'est recréé automatiquement (limite non
  contournable : un nom retrouvé sans permission FSA valide serait
  inutilisable — même contrainte de plateforme qu'Android).
- **Thèmes** : sélecteur de palette (les 8 déjà portées dans `schemes.js`
  depuis la phase 1 : `default`, `solarized`, `gruvbox`, `everforest`,
  `nord`, `alt01`, `alt02`, `retro`) + bascule sombre/clair, dans l'écran
  Réglages, persistés et appliqués via `applyTheme()`. L'éditeur de thème
  personnalisé (édition des couleurs) est arrivé au round 4 ci-dessous, sur
  demande explicite — voir plus bas, ne pas se fier au paragraphe qui
  précédait celui-ci dans une version antérieure de ce fichier.

Ceci clôt le phasage initial de `PLAN.md` (section 8, phases 1 à 6).

**Round 4 (2026-07-14, retour utilisateur) — réglages accessibles partout,
éditeur de thèmes, menu "⋮" de l'éditeur (portage au plus juste
d'Android)** :
- **Réglages accessibles depuis n'importe quel écran** : `Settings.open(returnScreenId)`
  retient l'écran d'où on vient (dépôts, navigateur, éditeur) et y retourne
  à la fermeture — l'éditeur en particulier garde tout son état (fichier
  ouvert, modifications non enregistrées) pendant l'aller-retour, puisqu'il
  n'est que masqué (`hidden`), jamais fermé (`Editor.close()` n'est pas
  appelé) : même principe que le "⋮ > Réglages" d'Android round 19
  ("le menu réglages n'est disponible que sur la page d'accueil" — corrigé
  en empilant simplement l'écran Réglages sans quitter l'éditeur). Icône ⚙
  ajoutée dans l'en-tête du navigateur de fichiers (`#browser-settings-btn`)
  en plus de celle déjà présente sur l'écran des dépôts et de l'entrée dans
  le menu "⋮" de l'éditeur.
- **Correction d'icône au passage** : le bouton "Options du dépôt" du
  navigateur utilisait ⚙, alors que l'icône réelle d'Android pour cette
  action précise est `Icons.Filled.MoreVert` (⋮) — `BrowserScreen.kt` a
  changé cette icône AVANT le round où les réglages globaux ont eu leur
  propre icône ⚙ dédiée (`RepositoryPickerScreen`/désormais aussi éditeur/
  navigateur). Corrigé pour ne plus avoir deux icônes ⚙ dans le même écran
  avec des significations différentes.
- **Menu "⋮" de l'éditeur** (`#editor-menu`), portage fidèle de la
  `DropdownMenu` d'`EditorScreen.kt` — même contenu, même ordre, icônes
  équivalentes : "🔢 Insérer un ID"/"🔗 Insérer un lien" (masqués en mode
  aperçu, comme le `if (!previewMode)` d'Android), "✏️ Renommer", "🕘 Créer
  une sauvegarde", "♻️ Restaurer une sauvegarde", "⚙ Réglages" — retirées de
  la barre d'outils, qui ne garde que TOC/backlinks (avec pastille du
  nombre de backlinks, comme le `BadgedBox` d'Android)/bascule aperçu
  (icônes 👁/✏️, plus un simple bouton texte "Aperçu")/Enregistrer/"⋮".
- **Renommer une note** (nouveau) : `FSA.renameFile()` utilise
  `FileSystemHandle.move(newName)` (stable dans les Chromium récents,
  renomme en place, même identité de fichier) avec repli copie+suppression
  pour les Chromium plus anciens. Réindexation complète du dépôt après
  renommage (`forceFull: true`, comme `EditorViewModel.renameNote`
  Android : l'ancien chemin doit disparaître de l'index, pas seulement le
  nouveau apparaître), puis réouverture de l'éditeur sur le fichier
  renommé. Conserve l'extension reconnue si le nouveau nom n'en a pas déjà
  une, même logique que `createNoteFile`/`renameNoteFile` Android.
- **Créer/restaurer une sauvegarde** (nouveau, `backup.js`, port de
  `BackupManager.kt`) : copie horodatée dans `<dépôt>/backups/`
  (`<base>_<timestamp><ext>`, même format de date qu'Android), dossier
  exclu de la navigation et de l'indexation (`FSA.BACKUPS_DIR_NAME`,
  matches Android's `SafRepositoryAccess.BACKUPS_DIR_NAME`) pour ne jamais
  apparaître comme une note normale. Restaurer charge le contenu choisi
  comme une frappe normale (`replaceAllContent()`, undo-safe — sélectionne
  tout puis "tape" par-dessus via `execCommand('insertText')`) plutôt que
  d'écraser directement le fichier : l'utilisateur garde la main via
  "Enregistrer", même choix qu'Android ("pas un remplacement irréversible
  en un tap").
- **Éditeur de thèmes** (`theme-editor.js`, `themes.js`), port de
  `EditorThemesScreen.kt` : écran liste (3 pastilles + nom + coche si actif
  + dupliquer/modifier/supprimer, "+" nouveau) et écran éditeur (champ nom,
  onglets Sombre/Clair, 6 couleurs éditables par onglet — fond/texte/
  sélection/titre/commentaire/balisage, mêmes libellés qu'Android —
  Annuler/Enregistrer). Thèmes personnalisés persistés en JSON
  (`meta.customSchemes`), mutant l'objet `customSchemes` de `schemes.js` en
  place (même scope global partagé que `State`, pas de plomberie d'export).
  **Déviation délibérée** : chaque pastille de couleur ouvre le sélecteur
  natif `<input type="color">` du navigateur plutôt que la roue teinte/
  saturation personnalisée d'Android (`ColorPickerDialog.kt`) — tout
  navigateur fournit déjà l'équivalent gratuitement, en réimplémenter un en
  canvas aurait été une pure duplication pour un résultat identique (choisir
  une couleur, obtenir son hexadécimal). Les 6 couleurs éditées ne couvrent
  pas `bgBar`/`fgBar`/`bg2` (champs de barre d'outils thématisée de
  writhdeck-web, absents du modèle à 6 couleurs d'Android — zettelium n'a
  pas de barre thématisée séparément) : dérivés de `bg`/`fg` à la sauvegarde
  plutôt qu'exposés à l'édition, pour que `applyTheme()` ait quand même
  toutes ses variables CSS sans un éditeur à 12 champs.

**Tests** : toujours 94 (`make test`) — aucun cas nouveau pour ce round, les
fonctionnalités ajoutées (renommage, sauvegardes, éditeur de thème, accès
aux réglages) touchent toutes le DOM ou l'API File System Access réelle,
pas de logique pure nouvelle à isoler. **Non vérifié en conditions
réelles**, même limite que documentée pour toutes les phases précédentes.

## Décisions structurantes (ne pas revenir dessus sans discussion)

- **Stockage = File System Access API**, un `FileSystemDirectoryHandle` par
  dépôt (persisté en IndexedDB), généralisation multi-dépôts du dossier
  surveillé optionnel de writhdeck-web — pas le store IndexedDB plat de
  `db.js` (writhdeck-web) qui ne convient qu'à un usage sans dépôts
  multiples.
- **Chromium uniquement** pour la gestion de dépôts (contrainte de la File
  System Access API) — assumé, pas de mode dégradé complexe pour
  Firefox/Safari.
- **Le parseur txt2tags est porté depuis `zettelium-android` (Kotlin)**, pas
  depuis writhdeck-web (qui n'en a pas de vrai) ni réécrit de zéro —
  `lionwiki-t2t/txt2tags.js` sert de cross-check pendant le portage, pas de
  source de conception.
- **L'index de recherche (nom/contenu/tag) est en mémoire**, reconstruit par
  scan du dépôt avec cache par `lastModified` — pas de SQL/FTS, les fichiers
  texte restent l'unique source de vérité (projection reconstructible, même
  principe que Room/FTS côté Android).
- **La technique d'éditeur (textarea+overlay), les thèmes, le menu ≡, le
  mode commande et la navigation sous-dossiers sont repris de
  writhdeck-web** — voir PLAN.md section 4 pour le détail exact de ce qui
  est copié tel quel vs. adapté.
- **Les blocs/inlines "raw"/"tagged"/"verbatim" sont toujours rendus en
  texte échappé dans l'aperçu HTML**, jamais injectés tels quels — déviation
  volontaire de la sémantique txt2tags d'origine, pour éviter l'auto-XSS
  via un fichier de dépôt non fiable (voir `render.js`).
- **L'index Zettelkasten est recalculé récursivement dès la phase 4**
  (`FSA.listNoteFilesRecursive`), même si le navigateur de fichiers reste
  plat jusqu'à la phase 6 — la recherche/les backlinks doivent couvrir tout
  l'arbre, pas seulement la racine.
- **Le garde-fou "enregistrer avant de quitter" couvre toute sortie de
  note** (fermeture, suivre un backlink/ZkLink), pas seulement le bouton
  retour — voir `editor.js`, `requestLeave()`/`openOther()`.
- **`ini.js` est une réécriture propre à zettelium, pas une réutilisation de
  celui de writhdeck-web** — celui-ci est entièrement lié aux réglages de
  writhdeck (thèmes/profils/minuteur), aucun ne s'applique ici ; seul le
  *format* (`[section]` + `clé = valeur`) est repris pour cohérence
  stylistique. Ne pas tenter de "vraiment" réutiliser le fichier d'origine.
- **Le sélecteur de lien et le panneau de backlinks affichent toujours le
  nom de fichier en premier, puis le premier titre détecté seulement s'il y
  en a un** (`entry.heading`, jamais un repli comme `entry.title`) — demande
  explicite de l'utilisateur, voir `index.js`/`editor.js` `renderNoteItem()`.
- **Les réglages globaux sont accessibles depuis tout écran**
  (`Settings.open(returnScreenId)`), pas seulement depuis l'écran des
  dépôts — icône ⚙ sur les dépôts, le navigateur, et entrée dans le menu
  "⋮" de l'éditeur. Ne pas régresser vers "accessible depuis un seul
  endroit" si l'écran des dépôts est retravaillé.
- **L'éditeur de couleurs de thème utilise `<input type="color">` natif,
  pas une roue teinte/saturation personnalisée** — équivalent fonctionnel
  déjà fourni par tout navigateur, voir `theme-editor.js`.
- **La barre d'outils de l'éditeur ne garde que TOC/backlinks/aperçu/
  enregistrer — tout le reste (insérer ID/lien, renommer, sauvegardes,
  réglages) vit dans le menu "⋮"**, portage fidèle de la `DropdownMenu`
  d'`EditorScreen.kt` (même contenu, même ordre). Ne pas remettre
  d'icônes dédiées dans la barre pour ces actions sans redemander à
  l'utilisateur — c'est explicitement ce qu'il a demandé de changer.

## Ne jamais faire

- Ne jamais commiter au nom de l'utilisateur sans demande explicite.
- Ne pas réintroduire les fonctionnalités hors-périmètre de writhdeck-web
  (minuteur, stats d'écriture quotidiennes, mode typewriter par défaut) sans
  demande explicite.
- Ne pas redécouvrir les pièges déjà résolus côté `zettelium-android`
  (motif d'ID vs format de génération, cache d'index à invalider si le
  motif change, `.trim()` sur le motif d'ID, `LinkRepair` en O(N) par note
  pas O(N×M)) — le journal `../zettelium-android/CLAUDE.md` (rounds
  12/12bis/12ter/16) documente ces corrections en détail.
