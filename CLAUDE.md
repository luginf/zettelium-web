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

**Round 5 (2026-07-14, retour utilisateur) — recherche par tag avec ou sans
`#`, navigateur de tags** :
- **`matchesQuery()` (mode `#Tag`, `browser.js`) retire maintenant un `#` de
  tête de la requête tapée** avant de comparer aux tags indexés (stockés
  sans `#`, voir `tags.js`) — `#voiture` et `voiture` matchent désormais
  pareil. Même règle qu'Android (`SearchViewModel` : `raw.removePrefix("#")`,
  un seul `#` de tête retiré, pas tous les `#` de la chaîne).
- **Navigateur de tags** (`#browser-tags-btn` 🏷, visible seulement en mode
  `#Tag` — même condition qu'Android, `if (viewModel.mode ==
  SearchMode.TAG)`) : `Browser.computeTagCounts()` agrège les tags de
  toutes les entrées de l'index du dépôt (portée globale, pas limitée au
  dossier navigué — comme la recherche elle-même), triés du plus fréquent
  au moins fréquent puis alphabétique, porté de `SearchViewModel
  .loadTagCounts`/`TagBrowserPanel` (round 17 Android). Tap un tag remplit
  le champ de recherche avec ce tag (sans `#`) et relance la recherche —
  même comportement qu'Android (`updateQuery(tag)`).
- **Pas de base de données pour les tags** (question explicite de
  l'utilisateur) : chaque entrée de `Index` (in-memory, voir index.js)
  porte déjà un `Set` de tags extraits par `TagExtractor.extract()` au
  moment de l'indexation (scan du dépôt/sauvegarde d'une note) — la
  recherche par tag et le navigateur de tags ne font que filtrer/agréger
  ces `Set` déjà en mémoire, aucune requête disque ni base au moment de la
  frappe. Ce n'est ni une vraie base de données interrogeable, ni un
  balayage des fichiers en temps réel à chaque recherche : c'est une
  projection déjà construite (même principe que tout `Index`, PLAN.md
  section 2 — reconstructible par réindexation, jamais la source de
  vérité).

## Décisions structurantes (ne pas revenir dessus sans discussion)

- **Stockage = File System Access API**, un `FileSystemDirectoryHandle` par
  dépôt (persisté en IndexedDB), généralisation multi-dépôts du dossier
  surveillé optionnel de writhdeck-web — pas le store IndexedDB plat de
  `db.js` (writhdeck-web) qui ne convient qu'à un usage sans dépôts
  multiples.
- **Chromium uniquement** pour la gestion de dépôts (contrainte de la File
  System Access API) — assumé, pas de mode dégradé complexe pour
  Firefox/Safari.
- **Brave désactive la File System Access API par défaut** (réglage propre
  à Brave, réduction de la surface de fingerprinting — vérifié en
  inspectant le binaire installé : `window.showDirectoryPicker` est
  `undefined` par défaut, présent avec `--enable-features=FileSystemAccessAPI`).
  Message d'erreur affiché par l'appli ("The File System Access API is not
  available in this browser") identique à Firefox/Safari alors que la cause
  est différente (réglage désactivable, pas une absence d'implémentation) —
  piste à donner : `brave://flags/#file-system-access-api` → Enabled →
  relancer Brave. Documenté dans README.md.
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
- **La recherche par tag ignore un `#` de tête** (`#voiture` ≡ `voiture`),
  et les tags eux-mêmes ne sont jamais stockés avec leur `#` — voir
  `tags.js`/`browser.js` `matchesQuery()`.
- **Pas d'icônes colorées** : toute icône (hors symboles texte déjà
  monochromes comme ← ✕ ⋮ + ⟳) vient de `icons.js` (SVG `currentColor`).
  Ne pas réintroduire d'emoji coloré pour une nouvelle action — ajouter
  l'icône à `icons.js` à la place, quitte à en dessiner une simple si
  aucun glyphe Feather/Material connu ne convient.
- **Les réglages de typographie de l'éditeur (police/taille/marges/
  interligne) vivent dans l'écran Réglages global, pas dans l'éditeur
  lui-même** — demande explicite de l'utilisateur, cohérent avec
  `SettingsScreen.kt` (section "Éditeur" avant "Thème").

**Round 6 (2026-07-14, retour utilisateur) — pastille "0" backlinks
affichée à tort** : la pastille du nombre de backlinks (`#editor-backlinks-badge`)
s'affichait comme "0" en rouge au lieu de disparaître complètement quand une
note n'a aucun backlink — contrairement à Android, qui n'affiche rien du
tout dans ce cas (`if (count > 0) BadgedBox(...) else Icon(...)`, pas de
badge à zéro). Cause : `.editor-badge { display: inline-block; ... }`
(règle d'auteur) a la **même spécificité** que la règle par défaut du
navigateur `[hidden] { display: none }`, et vient APRÈS dans la cascade —
elle gagnait donc systématiquement, y compris quand `hidden` était bien
posé par `updateBacklinksBadge()`. Corrigé avec un `.editor-badge[hidden]
{ display: none; }` explicite. Piège générique à retenir : tout élément
qui combine un attribut `hidden` ET une règle d'auteur définissant sa
propre `display` a besoin de ce genre de règle de secours — sinon
`hidden` peut silencieusement ne plus rien faire.

**Round 7 (2026-07-14, retour utilisateur) — icônes monochromes partout,
réglages de typographie de l'éditeur** :
- **Icône TOC exacte** : demande précise de l'utilisateur ("3 lignes
  parallèles, avec un point à la fin de chaque ligne") — remplacé l'emoji
  📑 par le vrai glyphe Material `Icons.AutoMirrored.Filled.Toc` (chemin
  SVG reproduit directement, pas une approximation).
- **"De façon générale ne mets pas d'icône colorée si possible"** :
  nouveau module `icons.js`, fonctions retournant des SVG monochromes
  (`fill`/`stroke: currentColor`, suivent la couleur du bouton) — remplace
  tous les emoji colorés (🔗💾👁✏️🔢🕘♻️⚙📁🏷🔤🕒). Priorité à des icônes
  Feather simples et bien connues (link, save, eye/eye-off, edit-2, clock,
  rotate-ccw, tool, tag) plutôt qu'à des tentatives risquées de reproduire
  des tracés Material complexes de mémoire ; deux icônes dessinées à la
  main (gear = anneau + 8 dents, hash = 4 traits) faute d'équivalent simple
  connu. Les symboles unicode déjà utilisés ailleurs (← ✕ ⋮ + ↑ ↓ ⟳) n'ont
  **pas** été touchés : ce sont des glyphes texte à présentation par défaut
  non colorée (pas des emoji), donc déjà conformes à la demande.
  Corrections de fidélité au passage, découvertes en confirmant les icônes
  Android exactes :
  - Bascule aperçu/édition : utilisait 👁/✏️ (œil/crayon) — Android utilise
    en réalité `Visibility`/`VisibilityOff` (deux variantes du **même**
    glyphe œil, barré ou non) ; corrigé pour utiliser `Icons.eye()`/
    `Icons.eyeOff()` au lieu d'un mélange œil+crayon.
  - Backlinks et "Insérer un lien" réutilisent maintenant la **même** icône
    lien (`Icons.link()`), comme Android réutilise `Icons.Filled.Link` pour
    les deux — au lieu de deux glyphes visuellement différents (⛓ vs 🔗)
    choisis par erreur lors d'un round précédent.
  - Les lignes de dossier du navigateur n'ont plus d'icône 📁 du tout :
    déjà distinguées des fichiers par `.folder-item` (couleur d'accent +
    gras), une icône supplémentaire aurait été redondante en plus d'être
    colorée.
  - Le bouton de tri (nom/date) utilise un seul glyphe "trier" (deux
    triangles empilés) quel que soit l'état, plutôt que deux emoji
    distincts (🔤/🕒 sans équivalent monochrome simple et clairement
    distinct à cette taille) — l'infobulle indique l'ordre actif.
  - **Écart de fidélité identifié mais volontairement pas corrigé cette
    session** : `browser-repair-btn` ("réparer les liens") reste un bouton
    dédié dans la barre du navigateur, alors que l'Android *actuel* range
    cette action comme simple ligne texte à l'intérieur du dialogue
    "Options du dépôt" (`RepositoryOptionsDialog`, `BrowserScreen.kt`), qui
    permet aussi de renommer le *dépôt* lui-même — fonctionnalité absente
    ici. Non demandé cette session, juste noté (`repo.name` existe déjà
    côté web, ce serait bon marché à ajouter si demandé).
- **Réglages de typographie de l'éditeur** (police, taille, marges,
  interligne), sur le modèle de `SettingsScreen.kt` ("Éditeur", avant la
  section Thème dans l'ordre Android — replacé pareil ici) :
  `State.settings.editorFontFamily/editorFontSize/editorMarginX/
  editorMarginY/editorLineSpacing`, appliqués en direct via les variables
  CSS `--ed-*` déjà existantes (`applyEditorTypography()` dans `app.js`,
  jusque-là figées à des valeurs par défaut). Bornes identiques à Android
  (`MIN/MAX_FONT_SIZE_SP` 10-32, `MIN/MAX_MARGIN_DP` 0-200 pas 4,
  `MIN/MAX_LINE_SPACING` 0.8-3.0 pas 0.1), sp/dp Android devenant simplement
  des px. **Adaptation, pas portage littéral** : la liste `EDITOR_FONTS`
  d'Android est composée d'alias de familles de police *Android*
  (`sans-serif-condensed`, etc.) qui ne veulent rien dire en CSS — remplacée
  par une liste de vraies familles CSS (`settings.js`, même esprit : une
  poignée de choix monospace/sans-serif/serif, pas un gestionnaire de
  polices personnalisées). Persistés en IndexedDB **et** dans le
  `zettelium.ini` durable (`ini.js` étendu avec les types `int`/`float`,
  jusque-là seulement `str`/`bool`).

**Tests** : 95 (`make test`, +1 pour le round-trip INI int/float des
réglages de typographie). Les icônes/steppers de réglages touchent tous le
DOM, non testables en Node — vérifié à la place que chaque SVG produit par
`icons.js` est un XML bien formé (aucune coquille de tracé/attribut), et que
les IDs référencés en JS existent tous dans `template.html`. **Non vérifié
visuellement en conditions réelles** (rendu effectif des icônes/de la
typographie dans un navigateur) — même limite que toutes les phases/rounds
précédents.

**Round 8 (2026-07-14) — comblement des écarts majeurs identifiés par
comparaison directe avec zettelium-android** (voir mémoire
`project_zettelium_web_gaps.md`, cinq lacunes qualifiées de fonctionnalité
de base, pas de polish) :
- **Créer une nouvelle note** : bouton "+" dans la barre du navigateur
  (à côté de "réparer les liens"), crée dans le dossier actuellement
  affiché (`currentDirHandle()`), ouvre directement dans l'éditeur — même
  comportement qu'Android round 10 ("contrairement à writhdeck-android,
  qui ne fait que rafraîchir la liste"). `FSA.createNoteFile` ajoute la
  première extension configurée si le nom saisi n'en porte pas déjà une
  reconnue, même règle que le renommage. Garde-fou supplémentaire (pas
  d'équivalent Android explicite) : refuse si un fichier de même nom existe
  déjà dans le dossier courant, plutôt que de silencieusement réutiliser/
  écraser le handle existant (`getFileHandle(..., {create:true})` renvoie
  le handle existant sans le vider — seule une écriture l'écraserait).
- **Supprimer / renommer / déplacer une note depuis le navigateur** :
  pas d'équivalent web au clic long Android — chaque ligne de fichier a
  maintenant un petit bouton "⋮" (`file-item-actions-btn`, `stopPropagation`
  pour ne pas déclencher l'ouverture de la note) ouvrant un menu
  Renommer/Déplacer/Supprimer, même ordre que `fileForActions`
  (`BrowserScreen.kt`). Suppression = `confirm()` natif (cohérent avec le
  reste de l'app, ex. retrait d'un dépôt) puis réindexation complète du
  dépôt (projection reconstructible, pas de purge ciblée). Renommer depuis
  le navigateur est un chemin **distinct** du renommage déjà existant côté
  éditeur (`editor.js`'s `confirmRename`, qui renomme la note *actuellement
  ouverte*) — mêmes IDs de dialogue évités exprès (`note-rename-dlg` vs
  `rename-note-dlg`) pour ne pas faire porter deux gestionnaires
  d'événements différents sur les mêmes éléments.
- **Déplacer une note (sous-dossier ou autre dépôt)** : `note-move-dlg`,
  porté de `MoveNoteDialog.kt` — sélecteur de dépôt destination (masqué
  s'il n'y en a qu'un), navigation dans son arborescence (".." + sous-
  dossiers, `Icons.folder()` par ligne — seule vue de cette app à afficher
  une icône de dossier, réplique fidèle de l'apparence réelle de ce
  dialogue précis chez Android, ne pas généraliser au navigateur principal
  qui reste volontairement sans icône de dossier), bouton "Déplacer ici"
  désactivé si la cible = emplacement actuel. **Détail de fidélité
  délibérément reproduit** : comme Android, le dialogue démarre TOUJOURS à
  la racine du dépôt sélectionné, jamais au dossier actuellement parcouru
  — naviguer jusqu'au dossier déjà affiché désactive alors le bouton,
  sinon "Déplacer ici" est actif dès l'ouverture si la racine diffère du
  dossier courant. Implémenté en copie (`FSA.writeNewFile` vers la
  destination) PUIS suppression de la source seulement après écriture
  réussie — jamais l'inverse — même précaution qu'Android
  (`moveNote`/`MoveOutcome`, pas d'équivalent FSA à
  `DocumentsContract.moveDocument`, de toute façon non fiable entre deux
  arborescences distinctes côté Android non plus). Réindexe le dépôt
  source ET destination (réindexation unique si c'est le même dépôt).
- **Détection de modification externe** : `_baselineMtime` (mtime réel du
  `FileSystemFileHandle` au moment de l'ouverture/dernière écriture),
  comparé avant chaque sauvegarde ET au retour de focus de l'onglet/fenêtre
  (`window.addEventListener('focus', ...)` +
  `document.visibilitychange` — équivalent web le plus proche de
  `LifecycleEventEffect(ON_RESUME)`, un navigateur n'ayant pas de notion de
  "reprise d'application"). Sans modification locale non enregistrée :
  rechargement silencieux depuis le disque (rien à perdre, `reloadFromDisk`
  réindexe aussi la note rechargée). Avec modification locale en cours :
  dialogue `external-conflict-dlg` à trois choix (Écraser/Recharger/
  Annuler), même pattern Promise-based que `confirmSaveBeforeClose`
  existant. Garde `_checkingExternal` contre un chevauchement focus+save.
- **Position du curseur restaurée à l'ouverture d'une note** : nouvel
  object store IndexedDB `cursors` (`storage.js`, `DB_VER` 1 → 2, migration
  additive non destructive — `onupgradeneeded` ne touche que les stores
  manquants), clé `${repositoryId}::${path}` → offset de caractère, même
  raisonnement qu'Android `NoteCursorStore.kt` ("offset de caractère, pas
  ligne/colonne — la contrainte ligne/colonne d'un moteur externe ne
  s'applique pas ici non plus qu'à zettelium-android lui-même", cette
  appli travaillant directement sur une `string` JS). Sauvegardée en
  quittant la note (`close()`) et implicitement à chaque changement de note
  affichée (`open()` sauvegarde d'abord la position de la note
  précédente si l'éditeur était déjà ouvert) — jamais en continu, même
  déclenchement ponctuel qu'Android (`onDispose`). Repli sur la fin du
  contenu si aucune position connue (comportement historique conservé,
  même repli qu'Android). Réutilise la technique du mirror-div déjà en
  place (`pixelTopForOffset`, TOC round 7) pour faire défiler jusqu'à la
  position restaurée.

**Tests** : 95 (`make test`, inchangé — tout ce round touche FSA/IndexedDB/
DOM, comme les rounds précédents de cette nature ; aucune nouvelle fonction
pure ajoutée à porter aux tests `eval()`-based existants). Vérifié :
`node --check` sur les 5 fichiers touchés, `make clean && make` (0 espace
réservé `{{...}}` restant), cross-check de tous les `getElementById(...)`
JS contre les `id="..."` de `template.html` (aucun manquant). **Non testé
fonctionnellement dans un navigateur réel** (même limite IndexedDB/Chrome
headless que documentée en début de session) — en particulier la
détection de modification externe (dépend du timing réel focus/mtime du
système de fichiers) et le dialogue de déplacement, à confirmer par
l'utilisateur.

**Round 9 (2026-07-14) — unification des réglages web/Android + i18n
complet** : demande explicite ("il faut pouvoir entrer une valeur... faire
pareil pour la version android... il faudra unifier les réglages des 2
modes"), avec un ordre de section précis fourni par l'utilisateur. Voir
aussi `zettelium-android/CLAUDE.md` round 23 pour le miroir côté Android.
- **Saisie numérique directe** (taille de police, marges, interligne) :
  `wireStepper()` (settings.js) gère maintenant un vrai `<input
  type="number">` (plus un `<span>` en lecture seule) — validé sur
  `change` (blur/Entrée), clampé aux mêmes bornes que les boutons -/+.
  Flèches natives du navigateur masquées en CSS (redondantes avec les
  boutons existants).
- **Thème passé d'un booléen `darkMode` à un mode tri-état
  `themeMode`** ('system'/'light'/'dark', aligné sur l'énum `ThemeMode`
  d'Android) : `resolveDarkMode()` (app.js) résout 'system' via
  `window.matchMedia('(prefers-color-scheme: dark)')`, avec un listener de
  changement en direct (l'OS peut changer de thème pendant que l'app est
  ouverte, sans recharger la page). Réglage exposé comme 3 boutons radio
  (Système/Clair/Sombre), même wiring générique (`wireRadioGroup`/
  `syncRadioGroup`) réutilisé pour la langue ci-dessous. `ini.js` :
  `dark_mode` (bool) remplacé par `theme_mode` (str) — pas de shim de
  compatibilité (aucune donnée réelle utilisateur documentée sur un
  `zettelium.ini` existant à ce stade du projet).
- **Réordonnancement des sections Réglages** pour correspondre exactement à
  l'ordre demandé et au nouvel ordre Android (round 23) : **Thème** (mode +
  palette + aperçu + "Modifier les couleurs" — déplacé ici depuis Éditeur)
  → **Éditeur** (police/taille/marges/interligne) → **Langue** (nouveau) →
  **Fichiers** → **Zettelkasten**.
- **Internationalisation FR/EN complète** (nouveau `src/i18n.js`, 131 clés
  `section.nom`, dictionnaires FR+EN strictement synchronisés) — port du
  principe d'Android (`AppLanguage`, round 6 zettelium-android) mais
  mécanisme différent : pas de ressources `strings.xml`/recréation
  d'activité, un dictionnaire JS plat + balayage du DOM.
  - `I18n.t(key, params)` : résout la langue effective (`State.settings
    .language` = 'system'/'fr'/'en' ; 'system' retombe sur `navigator
    .language`, anglais sinon français) et substitue les `{param}` dans la
    chaîne.
  - `I18n.apply()` : balaie `[data-i18n]`/`[data-i18n-title]`/
    `[data-i18n-placeholder]` dans `template.html` (contenu STATIQUE —
    tous les libellés de sections/boutons/dialogues) et émet un évènement
    `i18n:apply` sur `document`.
  - Le contenu généré dynamiquement (labels icône+texte construits en JS,
    listes actuellement affichées, aperçus) n'est PAS couvert par le
    balayage : chaque module (browser.js/editor.js/repositories.js/
    theme-editor.js/settings.js) écoute `i18n:apply` et se rafraîchit
    lui-même via sa propre fonction `refreshI18nLabels()`/`render()` —
    couplage volontairement plus léger qu'un sweep DOM générique pour ce
    contenu-là.
  - **Volontairement non traduits** (même choix qu'Android) : le nom
    "Zettelium", les noms de police génériques (Monospace/Sans-serif/
    Serif/Cursive — identiques ou quasi dans les deux langues), les noms
    de palettes de couleurs (solarized/nord/gruvbox/...), et les noms de
    langue eux-mêmes dans le sélecteur ("Français"/"English" toujours
    affichés dans leur propre langue, jamais traduits — `AppLanguage
    .nativeLabel` côté Android).
  - `I18n.locale()` (fr-FR/en-US) utilisée par les formatages de date
    (`toLocaleString`) qui existaient déjà (liste des sauvegardes) — la
    langue choisie dans l'app doit aussi changer le format de date, pas
    seulement la langue système, même esprit qu'Android.
  - Nouveau réglage `State.settings.language`, section Réglages > Langue
    (3 boutons radio), persisté en IndexedDB et dans `zettelium.ini`
    (`language`, type `str`).
- Correctif de test au passage : `INI.parse round-trips what INI.stringify
  wrote` et `INI.stringify omits settings that are undefined` référençaient
  encore l'ancienne clé `darkMode`/`dark_mode` — mis à jour vers
  `themeMode`/`theme_mode`.

`make clean && make` (0 espace réservé restant), cross-check de tous les
`getElementById(...)` JS contre `template.html` (aucun manquant),
vérification croisée que les 70 clés `data-i18n*` utilisées dans
`template.html` existent bien dans le dictionnaire FR et que FR/EN portent
exactement les 131 mêmes clés (script Node jetable, pas conservé). `make
test` passe (95/95, 2 corrigés). **Non testé visuellement dans un
navigateur réel** (limite habituelle de cet environnement) — en
particulier le changement de langue en direct (bascule Système/Français/
English pendant que plusieurs écrans/dialogues sont déjà affichés) et la
réaction au changement de thème système pendant que l'app est ouverte.

**Round 10 (2026-07-14) — sauvegarde automatique + interrupteurs à bascule
style Android** : deux demandes liées.
- **Sauvegarde automatique** (`State.settings.autosaveEnabled`, défaut
  `false` — même décision qu'Android round 3, "cela sauvegarde
  régulièrement... n'est pas souhaité") : porté d'`EditorViewModel
  .scheduleAutosave()` après recherche exacte du mécanisme Android
  (agent dédié, pour ne pas deviner un timing) — **vrai debounce de 2000ms**
  (`AUTOSAVE_DELAY_MS`), pas un intervalle fixe : chaque frappe
  (`onInput()` → `scheduleAutosave()`) annule le minuteur en attente et en
  reprogramme un nouveau, donc l'enregistrement ne se déclenche qu'après 2s
  d'inactivité. Appelle exactement le même `save()` que le bouton manuel
  (donc soumis à la même détection de modification externe, pas de chemin
  simplifié) — `save()` annule lui-même tout minuteur en attente en premier
  (`cancelAutosave()`), pour qu'une sauvegarde manuelle ne se fasse jamais
  doubler par un autosave venant de se déclencher juste après. Annulé aussi
  explicitement avant un renommage (`confirmRename`) et à la fermeture de
  l'éditeur (`close()`) — même précaution qu'Android
  (`EditorViewModel.renameNote`, commentaire : "sinon un autosave en
  attente peut se déclencher... et écrire sur une baselineMtime/URI
  devenue périmée"). Réglage exposé dans Réglages > Éditeur (juste après
  l'interligne, même emplacement qu'Android round 23), persisté en
  IndexedDB et dans `zettelium.ini` (`autosave_enabled`, bool).
- **Interrupteurs à bascule (style Android `Switch`)** : demande explicite
  ("met le label en premier et la coche ensuite, sur la même ligne...
  mettre une sorte de slider comme sous Android") pour la case "Tous les
  fichiers (ignorer le filtre)", étendue par cohérence à TOUTES les cases à
  cocher de réglage (Android utilise `Switch` partout pour ses booléens,
  vérifié dans `BrowserScreen.kt`/`SettingsScreen.kt` avant de généraliser)
  : nouveau composant CSS `.switch`/`.switch-track` (une vraie `<input
  type="checkbox">` cachée sous un rendu visuel de piste+curseur — le JS de
  changement existant continue de fonctionner sans modification, seul le
  rendu diffère d'une case native). Appliqué à `settings-extensions-all`,
  `repo-options-include-extension`, et le nouveau `settings-autosave`.
  Au passage, ajout des textes de description qui existaient déjà côté
  Android pour ces trois réglages mais n'avaient jamais été portés côté web
  (`settings.extensionsAllDesc`, `browser.includeExtensionDesc`,
  `settings.autosaveDesc` — textes repris tels quels de
  `strings.xml`/`values-en/strings.xml` pour la fidélité) ; au passage,
  corrigé `browser.includeExtensionLabel` qui portait un suffixe `[[…]]`
  ajouté par erreur lors d'un round précédent, absent du libellé Android
  réel ("Inclure l'extension dans les liens").
- 4 nouvelles clés i18n × 2 langues (135 au total, toujours strictement
  synchronisées FR/EN). `make clean && make`, cross-check des IDs,
  vérification que les 74 clés `data-i18n*` utilisées résolvent toutes,
  `make test` (95/95, inchangé — ce round ne touche aucune logique pure).
  **Non testé visuellement dans un navigateur réel.**

**Round 11 (2026-07-14) — panneau TOC latéral épinglable, sur le modèle de
writhdeck-web** : demande explicite ("rajoute une option (désactivable)
permettant d'afficher le TOC à droite... au lieu d'en surimpression
temporaire... un mode 'pin'... pour le coller ou le décoller"). Envoyé un
agent lire `writhdeck-web/src/toc.js`/`style.css`/`app.js` avant
d'implémenter plutôt que de deviner — découverte importante qui a
recadré la conception : **writhdeck-web n'a pas deux modes de mise en page**
(surimpression vs panneau) — son panneau `#toc-panel` est *toujours* une
colonne flex (`display:none`↔`flex`, jamais de position absolue/flottante).
Son "pin" ne contrôle qu'une chose : si un clic sur un titre referme le
panneau ensuite ou non — ce n'est même pas un réglage persistant, juste une
variable de fermeture JS qui retombe à `false` au rechargement. zettelium-web
n'avait jusqu'ici que le mode fenêtre modale `<dialog>` ; le "choix entre
les deux" que l'utilisateur demande est donc une combinaison propre à ce
port (l'option bascule bien réellement entre les deux mises en page,
contrairement à writhdeck qui n'en a qu'une), le comportement du pin lui
étant repris à l'identique de writhdeck (contrôle l'auto-fermeture après
clic, état de session non persisté).
- **Nouveau réglage `State.settings.tocSidebarMode`** (bool, défaut `false`
  — conserve le comportement historique tant qu'on ne l'active pas),
  Réglages > Éditeur, interrupteur style Switch (round 10) avec
  description. Persisté en IndexedDB et `zettelium.ini`
  (`toc_sidebar_mode`).
- **`#ed-body` restructuré en ligne flex** : les anciens enfants
  absolument positionnés (`#ed-wrap`/`#ed-preview`, bascule édition/aperçu)
  déplacés dans un nouveau `#ed-main` (`flex:1; position:relative`, reprend
  le rôle que jouait `#ed-body` seul avant ce round) ; `#toc-panel`
  (nouveau, `width:240px; flex-shrink:0`) devient le second enfant flex de
  `#ed-body` — l'affichage du panneau rétrécit donc réellement la colonne
  de l'éditeur, ce n'est jamais une surimpression, exactement le
  comportement demandé et celui de writhdeck-web.
- **`renderTocList(container, onNavigate)`** (nouveau, editor.js) factorise
  la construction des lignes de titres, partagée entre `openTocDialog()`
  (comportement historique inchangé) et `openTocSidebar()` (nouveau) — même
  fonction `navigateToToc()` derrière les deux, aucune duplication de la
  logique de défilement édition/aperçu.
- **`_tocPinned`** : variable de session pure dans `editor.js`, PAS dans
  `State.settings` (fidélité délibérée à writhdeck-web — jamais persisté,
  retombe à `false` à la fermeture de l'éditeur). Bouton épingle
  (`Icons.pin()`, nouvelle icône dessinée à la main faute de glyphe simple
  dans le sous-ensemble Feather déjà utilisé) dans l'en-tête du panneau,
  stylé `.active` (couleur d'accent) quand épinglé — même logique de style
  que le bouton pin de writhdeck (`.toc-pin-btn.active`), pas de changement
  d'icône, seulement de couleur.
- Ouvrir une autre note pendant que le panneau est déjà affiché (lien
  suivi, backlink) rafraîchit son contenu pour la nouvelle note au lieu de
  laisser des titres périmés visibles — cas non couvert par writhdeck-web
  (pas de navigation lien-à-lien là-bas) mais nécessaire ici. Fermer
  l'éditeur masque le panneau et réinitialise l'épinglage sans condition
  (même choix que writhdeck-web : "Closing the document forcibly hides it,
  ignores pin").
- 4 nouvelles clés i18n × 2 langues (139 au total, toujours strictement
  synchronisées). `make clean && make`, cross-check des IDs, vérification
  que les 76 clés `data-i18n*` résolvent, `make test` (95/95, inchangé).
  **Non testé visuellement dans un navigateur réel** — en particulier le
  redimensionnement réel de la colonne éditeur à l'ouverture/fermeture du
  panneau, et le comportement du pin en combinaison avec la bascule
  aperçu/édition.

**Round 12 (2026-07-14) — retrait du mode "épingle" du panneau TOC** :
retour immédiat de l'utilisateur sur le round 11 ("le pin... ne sert à
rien, on peut retirer facilement en cliquant sur l'icône"). Retiré
entièrement : `_tocPinned`, `toggleTocPin()`, `updateTocPinButton()`
(editor.js), le bouton `#toc-panel-pin-btn` (template.html/style.css),
l'icône `Icons.pin()` (devenue inutilisée, supprimée plutôt que laissée en
code mort) et les 2×2 clés i18n `editor.tocPin`/`editor.tocUnpin`. Le
panneau latéral est maintenant **persistant par défaut** : un clic sur un
titre navigue sans jamais refermer le panneau ; seul le bouton "✕" (déjà
existant) ou une nouvelle bascule via l'icône TOC de la barre d'outils le
ferment. `openTocSidebar()` simplifié en conséquence (plus de branche
conditionnelle sur un état épinglé). 137 clés i18n (FR/EN toujours
synchronisées, -2 par rapport au round 11). `make clean && make`,
cross-check des IDs, `make test` (95/95) — tous propres après retrait.

**Round 13 (2026-07-14) — texte sélectionné visuellement décalé par rapport
au texte non sélectionné** : signalé via capture d'écran ("le texte surligné
est décalé par rapport au texte d'origine"). Diagnostiqué par reproduction
en Chrome headless avec le vrai `highlight.js`/`style.css`/`app.js`
(mesure pixel par pixel des bandes de texte, pas de simple relecture de
code) :
- **Cause réelle** : `#ed-input::selection { color: var(--fg) }` rend
  visibles les *propres* glyphes du `<textarea>` réel pour la portion
  sélectionnée (nécessaire sinon un fond de sélection opaque masquerait
  totalement le texte de l'overlay en dessous). Or le `<textarea>` et le
  `<pre>` `#ed-highlight`, même avec un CSS strictement identique, n'ont
  pas exactement la même hauteur de ligne dès qu'une ligne de titre
  précédente est agrandie (`hl-h1`..`hl-h4`, `font-size` en `em`) : la
  boîte de ligne du titre dans l'overlay peut être de 1 à quelques px plus
  haute que ce que son `line-height` `calc()` compensé prévoit sur le
  papier, à cause des métriques réelles de la police (ascendant/descendant)
  à cette taille de police précise — le `<textarea>`, lui, ne peut de toute
  façon rendre AUCUNE ligne plus haute qu'une autre (pas de style par
  ligne dans un contrôle de formulaire natif). Confirmé par mesure directe
  (`getBoundingClientRect().height`) : un `.hl-line` contenant un `hl-h2`
  (agrandissement ×1.6) avec un `line-height` calculé pour valoir
  exactement 24px mesure en réalité 26px. Ce léger surplus s'accumule après
  chaque titre traversé, et devient visible **uniquement** là où
  `::selection` révèle les glyphes du textarea (qui restent, eux, sur les
  positions non affectées par ce surplus) — d'où l'impression que "le texte
  sélectionné" spécifiquement est décalé.
- **Piste explorée et écartée** : compenser plus rigoureusement le
  `line-height` des titres (`--ed-line-height-px` calculé en JS plutôt que
  `calc()`) ne change rien à la mesure (`getBoundingClientRect` identique
  avant/après) — la dérive vient des métriques de police à la taille
  agrandie, pas d'un arrondi de calcul CSS. Forcer `height` fixe +
  `overflow:hidden` sur `.hl-line` supprime bien la dérive mais **rogne
  visiblement les glyphes** dès `hl-h1` (×1.8) — inacceptable. `transform:
  scale()` (n'affecte pas la mise en page, donc aucune dérive) a été testé
  aussi mais fait chevaucher visuellement le titre agrandi sur la ligne
  suivante sans retouche supplémentaire de marges — pas retenu ici.
- **Premier correctif (incomplet) et régression signalée par l'utilisateur** :
  ne plus jamais rendre visibles les glyphes du `<textarea>` lui-même —
  `#ed-input::selection` sans `color` (texte transparent même sélectionné),
  fond de sélection rendu translucide (`rgba(var(--bg-sel-rgb), 0.65)`)
  plutôt qu'opaque, pour laisser transparaître le texte de l'overlay en
  dessous. Corrigeait bien l'alignement, mais l'utilisateur a signalé que le
  texte sélectionné apparaissait "recouvert"/plus clair — cause : ce fond
  translucide est peint PAR-DESSUS les glyphes déjà rendus de l'overlay
  (`#ed-input` a `z-index:1`, au-dessus de `#ed-highlight`), donc il les
  délave au lieu de servir de fond DERRIÈRE eux comme le fait une vraie
  sélection de texte (fond peint d'abord, glyphe peint par-dessus, pleine
  opacité).
- **Pourquoi ni vu ni signalé côté writhdeck-web** : vérifié — l'agrandissement
  des titres dans l'éditeur (`hl-h1`..`hl-h4`, la cause racine de toute la
  dérive) y est un réglage **désactivé par défaut**
  (`State.settings.headingSizes = false`, `state.js`), gating CSS via une
  classe `.heading-sizes` posée seulement si l'utilisateur l'active
  (`app.js`). zettelium-web, en portant le modèle d'affichage d'Android
  ("titre → classe de taille", `SyntaxHighlighting.kt`), a rendu cet
  agrandissement **permanent, sans réglage** — d'où une exposition
  systématique à ce bug ici, contrairement à writhdeck-web où il faut
  explicitement activer un réglage rarement touché pour même pouvoir le
  déclencher. Le bug existe probablement aussi côté writhdeck-web dès que
  `heading_sizes = true`, mais non vérifié ni corrigé dans cette session
  (hors périmètre, pas demandé).
- **Fix définitif** : la sélection visible n'est plus du tout celle du
  `<textarea>` réel — `#ed-input::selection` devient totalement invisible
  (`background: transparent; color: transparent`), et la sélection est
  reconstruite comme un `Highlight` (**CSS Custom Highlight API**,
  `CSS.highlights`/`Highlight`/`Range` — Chromium seulement, cohérent avec
  la contrainte déjà assumée pour la File System Access API) posé
  directement sur le texte du `<pre>` #ed-highlight lui-même
  (`editor.js` : `domPositionForOffset()` convertit un offset de caractère
  du texte brut en `{node, offset}` DOM en parcourant les nœuds texte du
  pre via `TreeWalker` — leur concaténation en ordre de document reconstruit
  exactement le texte brut, `Highlight.highlight()` n'ajoutant/ne retirant
  jamais de caractère à l'intérieur d'une ligne ; `updateSelectionHighlight()`
  construit un `Range` entre les deux positions et l'enregistre via
  `CSS.highlights.set('ed-selection', new window.Highlight(range))`).
  Résultat : le fond ET les glyphes sont peints dans la MÊME passe sur le
  MÊME texte (celui de l'overlay, jamais décalé par rapport à lui-même) —
  texte net, pleine opacité, alignement garanti quelle que soit la dérive
  résiduelle overlay/textarea. Écouteur `document.addEventListener
  ('selectionchange', ...)` filtré à `document.activeElement === ta()`
  (couvre glisser-déposer, clavier+Maj, sélectionner tout, en un seul point) ;
  effacé sur `blur` et dans `close()`. `updateSelectionHighlight()` aussi
  rappelée à la fin de `rehighlight()` (les nœuds DOM sont recréés à chaque
  frappe, un `Range` sur d'anciens nœuds détachés serait silencieusement
  invalide). **Repli explicite** pour un navigateur sans l'API
  (`.custom-highlight-supported`, classe posée sur `<html>` par `app.js`
  init() selon `!!(window.CSS && CSS.highlights)`) : le fond de sélection
  natif translucide (le "premier correctif") reste actif dans ce cas — pas
  parfait mais mieux que rien.
- **Piège rencontré pendant l'implémentation** : `new Highlight(range)`
  levait `TypeError: Highlight is not a constructor`. Cause : ce fichier
  (`highlight.js`) déclare déjà un `const Highlight = (() => {...})()` de
  plus haut niveau (le module de coloration syntaxique, `Highlight.highlight
  (text)`) — dans le scope global partagé de ce projet (pas de modules ES,
  tout concaténé par `build.py`), cette déclaration masque le constructeur
  natif `Highlight` de la CSS Custom Highlight API pour tout bare-identifier
  `Highlight` référencé ailleurs dans le fichier. Corrigé en écrivant
  explicitement `new window.Highlight(range)` (contourne le masquage lexical
  en passant par la propriété de l'objet global). Piège à surveiller pour
  toute future utilisation de la CSS Custom Highlight API dans ce fichier ou
  un fichier chargé après lui.
- Diagnostiqué et vérifié par reproduction en Chromium headless avec le vrai
  `highlight.js`/`style.css`/`app.js`/`editor.js` (mesure pixel par pixel des
  bandes de texte, pas de simple relecture de code) — `google-chrome`
  installé ici est une v99 trop ancienne pour la CSS Custom Highlight API
  (support Chromium depuis la v105) et ne pouvait valider que le repli ;
  `brave-browser` (Chromium 149 dans cet environnement) a servi à valider le
  chemin `CSS.highlights` réel. Après fix : bandes de texte identiques de
  part et d'autre de la frontière de sélection, texte net (pas délavé) dans
  les deux cas.
- `make clean && make`, `make test` (95/95, inchangé — aucune logique pure
  touchée ; `updateSelectionHighlight()`/`domPositionForOffset()` touchent
  le DOM réel, non testables dans la suite Node existante).

**Round 14 (2026-07-16) — recherche dans le texte en cours d'édition +
saut à la première occurrence depuis une recherche de contenu** : demande
explicite, appliquée aux deux plateformes à la fois (voir aussi
zettelium-android/CLAUDE.md round 24 pour le miroir côté Android).
- **Barre de recherche dans l'éditeur** (`#ed-search-bar`, nouveau),
  ouverte via Ctrl+F ou le menu ⋮ -> "Rechercher dans la note" (masquée en
  mode aperçu, comme insérer ID/lien — fermée automatiquement en y entrant
  puisqu'elle opère sur `#ed-input`, alors caché). Porte le mécanisme de
  writhdeck-web/src/editor.js (`searchOpen`/`searchUpdate`/`searchNext`/
  `searchPrev`/`selectMatch`), sans le remplacement (non demandé ici,
  "pour retrouver des passages"). `Highlight.highlight(text, searchTerm)`
  (nouveau 2e paramètre) injecte les surlignages `.hl-search` en
  post-traitement du HTML déjà rendu — ne marche que sur les nœuds texte,
  jamais à l'intérieur d'un `<span class="hl-...">` existant, même
  technique que writhdeck-web/src/highlight.js. La correspondance
  courante est en plus peinte via la sélection `CSS.highlights` déjà en
  place pour l'édition normale (round 13) — `selectSearchMatch` appelle
  `updateSelectionHighlight()` explicitement (pas seulement via le
  listener `selectionchange` filtré sur le focus du textarea) car le
  focus peut être sur `#ed-search-input` pendant qu'on navigue les
  résultats.
- **Recherche de CONTENU (mode `#browser-search-mode`) -> saut direct à la
  première occurrence** : `renderFileRow(file, searchTerm)` gagne un 2e
  paramètre (le texte de la requête telle que tapée, seulement en mode
  `content`) ; au clic, `Editor.open(file, { searchTerm })` — `open()`
  gagne un 2e paramètre `options` optionnel, et appelle
  `searchOpenWithTerm(term)` en toute fin (après la restauration normale
  de la position du curseur, qu'il écrase intentionnellement — l'intention
  explicite du clic est de retrouver CE passage-là). `searchOpenWithTerm`
  n'appelle pas `.focus()` sur le champ de recherche : le focus reste sur
  le textarea (déjà donné par `open()`), la recherche ne fait qu'afficher
  la barre + le compteur + surligner/sélectionner la première
  correspondance.
- `make clean && make` (0 espace réservé restant), cross-check des IDs
  `getElementById`/clés `data-i18n*` contre `template.html` (142 clés
  FR/EN toujours strictement synchronisées, +5 par rapport à avant ce
  round), `make test` (95/95, inchangé — `highlight.js` reste couvert par
  les 4 tests existants + vérification manuelle de l'échappement HTML/
  regex sur des termes de recherche contenant des caractères spéciaux, pas
  ajoutée à la suite Node car `editor.js`/`browser.js` touchent le DOM
  réel comme le reste de ce module). **Non testé visuellement dans un
  navigateur réel** (limite habituelle de cet environnement) — en
  particulier le focus du champ de recherche par rapport au textarea, et
  le rendu de la sélection `CSS.highlights` sur une correspondance lointaine
  dans un document long.

**Round 15 (2026-07-17) — "Dupliquer" dans le menu d'actions par note** :
demande explicite, pas d'équivalent Android (à ne pas porter là-bas sans
demande séparée).
- Nouveau bouton `#note-actions-duplicate` entre "Déplacer" et "Supprimer"
  (`note-actions-dlg`, `template.html`), icône `Icons.copy()` (Feather
  "copy", nouvelle). `duplicateFromActions()` (browser.js) copie le
  fichier dans son dossier d'origine sous `<base>_copy<ext>` (suffixe
  inséré juste avant la dernière extension, ex. "note.txt" ->
  "note_copy.txt") ; si ce nom existe déjà, bloque avec une alerte
  (`browser.duplicateAlreadyExists`) plutôt que d'écraser silencieusement
  — `FSA.writeNewFile`/`getFileHandle({create:true})` n'auto-suffixe pas
  en cas de collision comme le fait SAF côté Android (piège documenté
  côté zettelium-android, `feedback_saf_createfile_collision` — vérifié
  ici avant d'écrire plutôt que supposé). Vérifie la collision via
  `parentDir.getFileHandle(newName)` (sans `create`) plutôt que via
  `State.repoFiles` : `_actionsFile` peut venir des résultats de
  recherche (portée récursive), pas seulement du dossier actuellement
  affiché, donc `State.repoFiles` (dossier courant seul) ne suffirait pas
  à détecter une collision dans un sous-dossier différent. Réindexation
  complète du dépôt après la copie (nouvelle note à indexer), puis
  `rescan()` — n'ouvre pas la copie dans l'éditeur (même comportement que
  Renommer/Déplacer/Supprimer sur ce menu, contrairement au bouton "+" qui
  ouvre bien la nouvelle note).
- 2 nouvelles clés i18n × 2 langues (`common.duplicate`,
  `browser.duplicateAlreadyExists`, `browser.duplicateFailed` — 3 en
  réalité, 145 au total FR/EN toujours strictement synchronisées).
  `make clean && make` (0 espace réservé restant), cross-check des IDs,
  `make test` (95/95, inchangé — nouvelle fonction touche FSA/DOM réel,
  pas de logique pure à isoler). **Non testé visuellement dans un
  navigateur réel** (limite habituelle de cet environnement).

**Round 16 (2026-07-17) — "Nouvelle note" dans le menu ⋮ par note** :
demande explicite, juste après le round 15 — crée une note dans le dossier
de la note ciblée sans avoir besoin de remonter à la barre d'outils.
- `_newNoteTarget` (browser.js, nouveau) remplace la supposition implicite
  "toujours le dossier actuellement affiché" de `confirmNewNote()` —
  `openNewNoteDialog()` (bouton "+"/menu ⋮ du navigateur) le fixe au
  dossier courant, `openNewNoteDialogFromActions()` (nouveau, menu ⋮ d'une
  note) le résout via `FSA.getParentDirHandle(repo.dirHandle, file.path)` —
  nécessaire parce que `_actionsFile` peut venir d'un résultat de
  recherche (portée récursive), donc pas forcément du dossier affiché.
- Vérification de collision de nom durcie au passage : remplace le test
  contre `State.repoFiles` (snapshot du seul dossier affiché, donc faux
  quand la cible diffère) par une vraie lecture du dossier cible
  (`FSA.listChildren(target.handle, [], true)`, tous fichiers confondus —
  pas seulement les notes reconnues, pour ne jamais silencieusement
  réutiliser/écraser un fichier existant via `getFileHandle(create:true)`).
- Icône `Icons.filePlus()` (nouvelle, Feather "file-plus"). Réutilise le
  libellé existant `browser.newNoteTitle` ("Nouvelle note") plutôt que
  d'ajouter une clé dupliquée.
- `make clean && make`, cross-check des IDs, `make test` (95/95, inchangé).
  **Non testé visuellement dans un navigateur réel.**

**Round 17 (2026-07-17) — en-tête du navigateur : un seul menu "⋮"** :
demande explicite, sur le modèle exact d'Android (`BrowserScreen.kt`,
`RepositoryOptionsDialog`) — avec une précision supplémentaire de
l'utilisateur : aucune action potentiellement perturbatrice ("réparer les
liens") ne doit rester une icône cliquable en accès direct, tout doit vivre
dans un menu/dialogue explicite.
- **En-tête simplifié** : `browser-options-btn`/`browser-repair-btn`/
  `browser-new-btn`/`browser-settings-btn` (4 icônes séparées) remplacés
  par un seul bouton `#browser-menu-btn` ("⋮") ouvrant `#browser-menu`
  (même mécanisme ouvrir/fermer/clic-extérieur/Échap que le menu ⋮ de
  l'éditeur, `editor.js` — sélecteurs `#editor-menu`/`#browser-menu`
  fusionnés dans `style.css` pour ne pas dupliquer la présentation du
  dropdown) avec 3 entrées : "Options du dépôt", "Nouvelle note",
  "Réglages" (`Settings.open('browser-screen')`, appelé directement —
  `settings.js` ne câble plus rien sur l'écran navigateur, son ancien
  `browser-settings-btn` a disparu). `browser-refresh-btn`/`browser-sort-btn`
  restent des icônes directes (non destructifs, fréquents — même logique
  que le tri/la recherche qui restent des icônes sur Android).
- **"Options du dépôt" augmenté** (`repo-options-dlg`) : ajout d'un champ
  "Nom du dépôt" (renommage, nouveau `renameRepository(repo, newName)`
  dans `state.js` — met aussi à jour `State.dirStack[0].name`, capturé une
  seule fois par `scanActiveRepo()` et jamais relu depuis `repo.name`,
  sinon le fil d'Ariane du navigateur afficherait l'ancien nom jusqu'au
  prochain changement de dossier) et de la ligne "Réparer les liens"
  (déplacée depuis son ancienne icône dédiée dans la barre — désormais une
  ligne de texte explicite dans ce dialogue, jamais une icône isolée,
  demande explicite de l'utilisateur ; toujours désactivée + relabellisée
  "Réparation en cours…" pendant l'exécution, même retour visuel que
  `isRepairingLinks` côté Android).
- **Nouvelle classe CSS `.action-row`** généralisée à partir de l'ancien
  bloc `#note-actions-body button` (ligne cliquable pleine largeur, icône +
  texte) — réutilisée par le nouveau menu ⋮ du navigateur ET la ligne
  "Réparer les liens", au lieu de dupliquer ces déclarations par ID comme
  l'aurait fait une copie directe du bloc existant.
- 3 clés i18n retirées (`browser.repoOptionsTooltip`, `browser.repairTooltip`,
  `browser.newNoteTooltip` — devenues mortes, plus aucune icône à
  survoler) et 4 ajoutées (`browser.moreTooltip`, `browser.repoNameLabel`,
  `browser.repairLinksLabel`, `browser.repairingLabel`), 146 au total FR/EN
  toujours strictement synchronisées. `make clean && make`, cross-check
  des IDs, `make test` (95/95, inchangé — nouvelle logique touche
  FSA/DOM/dialogues réels). **Non testé visuellement dans un navigateur
  réel** (limite habituelle de cet environnement) — en particulier le
  positionnement du dropdown `#browser-menu` et le renommage de dépôt en
  situation réelle (plusieurs dépôts, dossier profondément imbriqué).

**Round 18 (2026-07-17) — "Aller à l'ID Zettelkasten" dans le menu ⋮ de
l'éditeur** : demande explicite ("pour y accéder directement, et si l'id
n'existe pas, indique qu'il n'y en a pas").
- `ZettelkastenLinks.findBodyIdOccurrence(content, idRegex)` (nouveau,
  `zettelkasten.js`, fonction pure testée) : localise la première
  occurrence de l'ID **dans le corps** (offsets réels dans `content`, pas
  dans une version tronquée) en sautant celles qui chevauchent un lien
  `[[cible|id]]` existant — même précédence que `extractId` (première
  correspondance de haut en bas, hors liens), mais ne peut pas réutiliser
  `stripLinks` (qui décale les offsets) puisqu'ici la POSITION compte, pas
  seulement la sous-chaîne trouvée.
- `editor.js` : `goToId()` reproduit d'abord la précédence "nom de fichier
  gagne outright" (`detectZkId`/`extractId` partout ailleurs dans l'app) —
  si l'ID vient du nom, rien à localiser dans le texte, message dédié
  (`editor.goToIdNotInBody`) plutôt que de chercher quand même dans le
  corps. Sinon, `findBodyIdOccurrence` ; si `null`, message
  `editor.goToIdNone`. Trouvé : place le curseur + défile dessus via
  `pixelTopForOffset` (même technique que `navigateToToc`/la recherche en
  note). Nouvel item `#editor-menu-goto-id` masqué en mode aperçu, même
  condition que insérer ID/lien/rechercher (rien à sélectionner dans le
  textarea, caché dans ce mode) — ajouté à `updateEditorMenuVisibility`.
- Icône `Icons.crosshair()` (nouvelle, Feather "crosshair") — distincte du
  hash déjà utilisé pour "Insérer un ID", pour ne pas suggérer la même
  action.
- 2 tests (`findBodyIdOccurrence` : trouve la bonne occurrence en sautant
  celle dans un lien ; renvoie `null` sans ID dans le corps). `make clean
  && make`, cross-check des IDs, `make test` (95 -> 97, +2), 149 clés
  i18n FR/EN toujours strictement synchronisées (+3 :
  `editor.goToId`/`goToIdNotInBody`/`goToIdNone`). **Non testé
  visuellement dans un navigateur réel.**

**Round 19 (2026-07-17) — liste de fichiers épinglée à gauche de l'éditeur** :
demande explicite, "sur le modèle du TOC qui reste attaché en mode web" —
deux choix de conception validés par l'utilisateur avant implémentation
(question posée) : (1) le panneau garde TOUTES les fonctions actuelles du
navigateur (recherche/tri/sous-dossiers/menu ⋮), juste rétréci, pas une
liste simplifiée ; (2) fermer la note ouverte pendant que le panneau est
épinglé affiche un espace vide dans la zone principale, le panneau reste
étroit (ne se réagrandit pas tant qu'on ne quitte pas le dépôt).
- **Nouveau réglage `State.settings.fileListSidebarMode`** (bool, défaut
  `false`), Réglages > Éditeur juste après `tocSidebarMode` — mais
  **contrairement au TOC, ne s'active qu'à l'ouverture d'une première note**
  dans le dépôt (pas dès l'entrée dans le dépôt) : `Repositories.open()`
  reste inchangé, le navigateur s'ouvre toujours plein écran normalement.
- **Architecture** : `#browser-screen` et `#editor-screen` (jusqu'ici
  strictement mutuellement exclusifs, un seul visible à la fois) peuvent
  désormais être visibles SIMULTANÉMENT — la classe `body.sticky-workspace-
  active` (posée/retirée par JS, jamais par CSS seule) fait passer `<body>`
  en `display:flex;flex-direction:row` UNIQUEMENT quand c'est le cas (sinon
  le flux bloc normal historique s'applique, aucun changement de layout
  pour tout le reste de l'app) ; `#browser-screen` devient une colonne fixe
  (`flex:0 0 320px`), `#editor-screen` prend le reste (`flex:1 1 auto`).
  `editor.js` `open()` pose la classe (dérivée du réglage à chaque
  ouverture de note, pas mémorisée) et ne cache plus `browser-screen` si le
  réglage est actif.
- **"Fermer une note" en mode épinglé ne referme plus tout l'écran** :
  `#editor-screen` a été restructuré — son contenu réel (`#ed-header`/
  `#ed-search-bar`/`#ed-body`) est maintenant enveloppé dans
  `#editor-note-view`, sibling d'un nouveau `#editor-empty-state` (message
  "Choisis une note..."). `close()` bascule entre les deux SANS jamais
  cacher `editor-screen` lui-même quand `sticky-workspace-active` est
  posée — l'écran garde sa largeur, seul son contenu change. Hors mode
  épinglé, comportement historique inchangé (referme tout l'écran, réaffiche
  `browser-screen` plein écran).
- **Trois autres points de transition rendus conscients du mode épinglé**
  (sinon un écran plein-largeur normal se retrouverait coincé à côté d'un
  panneau resté visible dans un `<body>` encore en `flex-row`) :
  `Settings.open`/`close` (cache/réaffiche `browser-screen` ET
  `editor-screen` ensemble si `sticky-workspace-active` était posée au
  moment de l'ouverture — la classe elle-même sert de source de vérité,
  retirée à l'ouverture des réglages et reposée à la fermeture) ;
  `Repositories.showList()` (quitter le dépôt cache aussi `editor-screen`
  et retire la classe, pas seulement `browser-screen`) ; `Browser.backOrUp()`
  (appelle désormais `Editor.requestClose()` avant `Repositories.showList()`
  à la racine — **nouveau garde-fou nécessaire** : contrairement à avant,
  une note dirty peut maintenant rester ouverte dans le panneau PENDANT
  qu'on navigue/quitte le dépôt depuis la liste, un cas qui ne pouvait tout
  simplement pas se produire quand les deux écrans étaient exclusifs).
- **`Editor.openOther` généralisé aux deux points d'entrée du navigateur**
  (clic sur une ligne de fichier, création d'une nouvelle note) — plus
  seulement backlinks/ZkLinks internes à l'éditeur. Nécessaire pour la
  même raison : cliquer une AUTRE note ou en créer une pendant qu'une note
  dirty est déjà ouverte dans le panneau épinglé doit demander confirmation
  (`requestLeave`), pas écraser silencieusement — risque de perte de
  données qui n'existait pas avant ce panneau. `openOther` accepte
  maintenant un `options` optionnel (transmis à `open`, pour le
  `searchTerm` du clic sur un résultat de recherche de contenu).
  `Editor.close()` gagne aussi un early-return `if (!_file) return` (no-op
  sûr quand `requestClose()` est appelé sans note ouverte — cas courant
  hors mode épinglé).
- **Surlignage de la note active** dans la liste (`renderFileRow`,
  `.file-item-active`, fond `--bg-sel`) — compare `Editor.currentPath()`
  (nouvel export, `_file?.path`) à chaque ligne, seulement en mode épinglé.
  Rafraîchi via `Browser.render()` appelé depuis `editor.js` après chaque
  `open()`/`close()` réussi (mode épinglé seulement).
- **Limite connue, non traitée cette session** : renommer/déplacer/
  supprimer la note ACTUELLEMENT OUVERTE depuis sa propre ligne dans le
  panneau (menu ⋮ par note) ne notifie pas l'éditeur — un cas neuf, rendu
  possible seulement par ce panneau (avant, on ne pouvait pas voir/cliquer
  la liste pendant qu'une note était ouverte). L'éditeur garderait un
  `_file`/titre/chemin de curseur périmés jusqu'à la fermeture manuelle de
  la note. Pas demandé explicitement, périmètre déjà large pour cette
  session — à corriger si rencontré en usage réel (piste : dans
  `duplicateFromActions`/`deleteFromActions`/`confirmNoteRenameFromBrowser`/
  `performMove`, si `Editor.currentPath() === file.path`, appeler
  `Editor.close()` après l'opération).
- `make clean && make`, cross-check des IDs, `make test` (97/97, inchangé
  — aucune nouvelle logique pure, tout ce round touche DOM/state/layout),
  152 clés i18n FR/EN toujours strictement synchronisées (+3 :
  `settings.fileListSidebarLabel`/`Desc`, `editor.emptyStateHint`).
  **Non testé visuellement dans un navigateur réel** (limite habituelle de
  cet environnement) — en particulier tout ce round : le layout flex
  réel du panneau épinglé, la bascule Réglages depuis ce mode, et la
  sortie de dépôt avec une note dirty ouverte dans le panneau.

**Round 19bis (2026-07-17) — bug réel du panneau épinglé (dialogue "Déplacer"
bloqué à l'écran) + panneau redimensionnable** : deux retours utilisateur
liés au round 19.
- **Bug corrigé, effectivement testé cette fois** (headless Brave piloté
  via Chrome DevTools Protocol brut — pas de puppeteer/playwright
  installés ici, client CDP écrit à la main sur le `WebSocket` global de
  Node 22 ; `Editor.open()` piloté directement avec un `dirHandle`/
  `fileHandle` factices, sans vraie interaction File System Access,
  impossible à automatiser en headless) : ouvrir une note avec le
  panneau épinglé actif affichait le dialogue "Déplacer" figé au premier
  plan, sans jamais pouvoir le fermer. **Cause réelle, pas un artefact du
  panneau lui-même** : `#note-move-dlg` et le groupe
  `#zklink-picker-dlg`/`#backlinks-dlg`/`#toc-dlg`/`#backup-restore-dlg`/
  `#tag-browser-dlg` (style.css) portaient un `display: flex`
  inconditionnel, jamais scopé à `[open]` — un sélecteur d'ID (plus
  spécifique que le sélecteur de type `dialog` de la feuille UA, qui pose
  `display: none` tant que l'attribut `open` est absent) l'emportait donc
  TOUJOURS, même dialogue fermé. Ce bug latent existait déjà avant ce
  round (probablement depuis le round 8) mais restait invisible : ces
  dialogues fermés-mais-`display:flex` étaient de simples blocs supplémentaires
  après `#browser-screen`/`#editor-screen` dans le flux normal du `<body>`
  (jamais flex avant ce round), poussés sous la ligne de flottaison par
  `overflow:hidden` sur `html,body`. Le panneau épinglé (round 19) passe
  `<body>` en `display:flex;flex-direction:row` dès qu'il est actif — ces
  mêmes blocs deviennent alors des ITEMS DE LA LIGNE, positionnés au début
  (avant browser-screen/editor-screen), d'où leur apparition soudaine.
  Corrigé en ajoutant `[open]` aux deux sélecteurs concernés — comportement
  à l'ouverture/fermeture réelle (`showModal()`/`.close()`) vérifié
  inchangé après coup (`display:none` fermé, `display:flex` ouvert,
  redevient `none` après fermeture).
- **Panneau redimensionnable par glisser-déposer** (demande explicite :
  "même si c'est plus petit que la longueur du titre de la plus longue
  note" — donc pas de plancher lié au contenu). Nouveau réglage
  `State.settings.fileListSidebarWidth` (int px, défaut 320, mêmes
  mécanismes persistance IndexedDB/`.ini` que les autres réglages
  numériques) piloté par une variable CSS `--file-list-sidebar-width`
  (`applyFileListSidebarWidth()`, app.js — même pattern que
  `applyEditorTypography()`, appelée au démarrage ET depuis le setter).
  `#file-list-sidebar-resizer` (nouvelle poignée fine, `cursor: col-resize`,
  n'existe en layout que sous `body.sticky-workspace-active` — pas de
  `hidden` DOM séparé à synchroniser) : `mousedown`/`mousemove`/`mouseup`
  sur `document` (browser.js `wireSidebarResizer()`) mettent à jour la
  variable CSS en direct pendant le glisser (pas de re-render coûteux),
  persistée une seule fois au relâchement. Bornes fixes 160-640px
  (`FILE_LIST_SIDEBAR_MIN/MAX`), pas de champ Réglages séparé — le
  glisser-déposer suffit.
- **`.file-item-meta` (date/chemin) plafonnée à `max-width: 45%`** — sans
  ce plafond, testé et confirmé par capture d'écran : `.file-item-name`
  (flex:1, flex-basis 0%, donc rien à céder puisqu'il part déjà de 0)
  perdait la priorité de rétrécissement face à `.file-item-meta`
  (flex-basis auto/contenu), au point que le NOM du fichier disparaissait
  complètement (largeur nulle) et seule la date restait visible dès que le
  panneau descendait sous ~250px. Plafonner la date à 45% garantit que le
  nom (plus utile) récupère toujours le reste de la ligne.
- `make clean && make`, cross-check des IDs, `make test` (97/97, inchangé),
  153 clés i18n FR/EN toujours strictement synchronisées (+1 :
  `browser.resizeSidebarTooltip`). **Vérifié visuellement cette fois**
  (captures d'écran headless Brave, voir ci-dessus) : mise en page
  panneau+éditeur côte à côte correcte, glisser-déposer fonctionnel de 320
  à 180px avec noms de fichiers longs toujours partiellement lisibles
  (ellipse), dialogue "Déplacer" s'ouvrant/se fermant normalement.
  **Non vérifié en conditions réelles** : interaction tactile (pas de
  souris), et le flux complet avec un vrai dépôt/de vrais fichiers SAF
  (ce test contourne le File System Access API, impossible à automatiser
  en headless).

**Round 20 (2026-07-17) — curseur décalé après un titre (même cause que le
round 13), menu contextuel (clic droit) de formatage, suivre les liens en
édition** : trois demandes explicites dans le même message.
- **Bug corrigé, vérifié par mesure directe (headless Brave + CDP,
  `deltaPx: 0` entre le caret et la position réelle du caractère dans
  l'overlay)** : le VRAI caret natif du textarea (`caret-color`) restait
  visible malgré le round 13 (qui n'avait remplacé que le rendu de la
  SÉLECTION, `if (start === end) return` dans `updateSelectionHighlight`
  laissait explicitement le caret de côté) — donc toujours positionné selon
  les métriques de ligne UNIFORMES du textarea, qui divergent de l'overlay
  dès qu'un titre agrandi (`.hl-h1`..`.hl-h4`) précède la ligne courante,
  exactement la même cause racine que le décalage de sélection déjà
  résolu. Corrigé avec la même famille de technique : `#ed-input {
  caret-color: transparent }` (le vrai caret natif ne s'affiche plus
  jamais) + `#ed-caret` (nouveau, `editor.js` `updateCaretIndicator()`) —
  un élément positionné en pixels via un `Range` collé sur le texte RÉEL
  du pre (`domPositionForOffset`, déjà utilisé pour la sélection), donc
  toujours aligné avec ce qui est visuellement affiché. Contrairement à la
  sélection, cette technique (`Range.getClientRects()`/
  `getBoundingClientRect()`) ne dépend PAS de la CSS Custom Highlight API
  — fonctionne sans le gating `.custom-highlight-supported`. Rappelé après
  chaque frappe/déplacement de sélection (`rehighlight`, le listener
  `selectionchange`, `syncScroll`, `selectSearchMatch`, `blur`) — mêmes
  points d'accroche que `updateSelectionHighlight`. Clignote (animation
  CSS), redémarre son cycle à chaque déplacement (coupe/relit `animation`
  pour forcer un reflow) pour rester plein pendant la frappe comme un vrai
  caret natif. Repli sur le coin haut-gauche pour une note entièrement
  vide (aucun nœud texte à mesurer dans le pre).
- **Menu contextuel (clic droit) de formatage** (nouveau,
  `src/editor-formatting.js` + wiring dans `editor.js`), porté d'Android
  (`EditorScreen.kt`'s `ActionMode.Callback` du long appui +
  `EditorFormatting.kt`) — même liste, même ordre : "Suivre le lien" (voir
  plus bas, en tête seulement si applicable), Titre 1/2/3, Gras, Italique,
  Souligné, Barré, Commentaire, Date. **Volontairement pas porté** :
  correcteur orthographique (bascule d'un réglage d'app, pas vraiment du
  "formatage de texte" — non demandé explicitement, `#ed-input` reste sur
  `spellcheck="false"` fixe comme avant).
  - `editor-formatting.js` (nouveau module pur, testé — 17 tests dérivés
    1:1 de `EditorFormattingTest.kt`) : `wrapInline`/`toggleLinePrefix`/
    `toggleHeading`, mêmes règles de bascule que Kotlin. **Différence de
    forme délibérée** : le Kotlin renvoie (texte entier, nouvelle
    sélection) — pratique pour réassigner un `Editable` — alors qu'ici
    chaque fonction renvoie `{rangeStart, rangeEnd, replacement,
    cursorStart, cursorEnd}` (la portion de texte ORIGINAL réellement
    modifiée), pour pouvoir appliquer le changement via
    `execCommand('insertText', ...)` (`applyFormattingResult`, editor.js :
    sélectionne `[rangeStart, rangeEnd]` puis insère `replacement` par-
    dessus) plutôt que réassigner `.value` en entier — même raisonnement
    que `insertAtCursor` (round 2 : réassigner `.value` efface l'historique
    annuler/rétablir natif du textarea). Vérifié : `execCommand('undo')`
    restaure bien le texte d'origine après une action de ce menu (headless
    Brave).
  - `#ed-context-menu` (nouveau, `position:fixed`, coordonnées de
    `contextmenu.clientX/Y`, reclampé après un premier affichage non
    contraint pour ne jamais déborder de la fenêtre) — remplace
    (`preventDefault`) le menu contextuel natif du navigateur. Icônes :
    `Icons.link()` (suivre le lien, même glyphe que backlinks/insérer un
    lien) et `Icons.clock()` (date, même glyphe que créer une sauvegarde) ;
    Titre 1/2/3/Gras/Italique/Souligné/Barré/Commentaire utilisent des
    glyphes texte stylés (`.ctx-glyph` : "H1"/"H2"/"H3"/lettre en gras/
    italique/souligné/barré/"%") plutôt que de nouvelles icônes SVG —
    zéro nouvelle forme à dessiner pour un rendu déjà explicite (même
    esprit que les symboles unicode déjà acceptés ailleurs : non colorés,
    `currentColor` implicite via le texte).
- **Suivre un lien `[[cible|zkId]]` depuis le mode ÉDITION** (jusqu'ici
  seulement possible en aperçu, `onPreviewClick`) : "Suivre le lien"
  (`ed-ctx-follow-link`) n'apparaît dans le menu contextuel QUE si
  `ZettelkastenLinks.linkAt(content, selectionStart, selectionEnd)` (déjà
  porté mais jamais câblé à une action jusqu'ici) trouve un lien
  chevauchant le curseur/la sélection — vérifié par test headless (visible
  curseur dans un lien, caché sinon). Résout via `Index.findByZkId` (même
  mécanisme que `togglePreview`'s `resolveZkLink`) puis `openOther(...)` —
  même garde-fou "enregistrer avant de quitter" que le clic sur un lien
  résolu en aperçu. ID introuvable : message dédié
  (`editor.ctxLinkNotFound`, "Aucune note avec l'ID {zkId}." — mot pour
  mot la chaîne Android `editor_no_note_for_id`), pas un échec silencieux.
- 11 nouvelles clés i18n × 2 langues (164 au total FR/EN toujours
  strictement synchronisées). `make clean && make`, cross-check des IDs,
  `make test` (114/114, +17 pour `editor-formatting.js` — nouveau fichier
  ajouté à `build.py`/`Makefile`/`test/run.js`). **Vérifié par mesure
  directe et capture d'écran** (headless Brave + CDP, voir ci-dessus) :
  alignement du caret après un titre, ouverture/fermeture du menu,
  transformation de texte correcte pour Gras/Titre, visibilité
  conditionnelle de "Suivre le lien", historique annuler/rétablir
  préservé. **Non vérifié en conditions réelles** : clavier/souris
  physiques, et clic droit sur écran tactile (pas d'équivalent testé —
  cette fonctionnalité est explicitement souris/clic droit uniquement,
  comme le reste de cette version web).

**Round 20bis (2026-07-17) — retour immédiat sur le round 20 : "le curseur
ne se trouve plus du tout à la bonne place, si je clique puis écrit, c'est
décalé"** : régression réelle causée par le fix du round 20, root-causée
par une reproduction directe (clic SOURIS RÉEL simulé via le protocole
CDP `Input.dispatchMouseEvent`/`dispatchKeyEvent` — pas juste
`setSelectionRange` programmatique comme la vérification du round 20, qui
ne pouvait pas révéler ce problème puisqu'elle contourne justement la
résolution native d'un clic).
- **Cause racine, distincte du problème d'affichage déjà corrigé au round
  20** : un clic natif sur le vrai `<textarea>` (invisible mais bien réel,
  au-dessus de l'overlay en `z-index`) résout sa position selon SES
  PROPRES métriques UNIFORMES (une seule taille de police pour toutes les
  lignes) — alors que l'overlay agrandit les lignes de titre, poussant
  tout ce qui suit plus bas. Le round 20 avait rendu l'AFFICHAGE du
  curseur fidèle à la VRAIE position résolue (`selectionStart`) — mais
  cette position résolue elle-même reste fausse dès que le décalage
  cumulé de plusieurs titres dépasse la hauteur d'une ligne. Avant le
  round 20, le vieux caret natif (`caret-color`) utilisait CETTE MÊME
  résolution fausse pour s'afficher — donc affichage et frappe restaient
  cohérents ENTRE EUX (même référentiel erroné des deux côtés), même si
  décalés par rapport à l'overlay. Le round 20 a rendu l'affichage
  fidèle à l'overlay SANS corriger la résolution du clic elle-même —
  cassant cette cohérence : le curseur affiché (maintenant correct) et
  l'endroit où la frappe atterrit réellement (toujours faux) pouvaient
  diverger visiblement. Confirmé par mesure directe : sur une note à 15
  titres, cliquer sur une ligne plaçait le curseur en toute fin de note.
- **Corrigé** (`correctedOffsetAt`, editor.js, nouveau) : après un simple
  clic (`mouseup`, seulement si `selectionStart === selectionEnd` — un
  glisser/mot/ligne sélectionné est laissé à la résolution native, non
  corrigé), retrouve la VRAIE position cliquée dans le rendu de l'overlay
  via `document.caretRangeFromPoint` (Chromium/WebKit — cohérent avec la
  contrainte FSA déjà assumée) puis corrige `setSelectionRange` en
  conséquence. **Piège découvert et contourné** : `caretRangeFromPoint`
  fait son propre hit-test comme `elementFromPoint` — au point cliqué, le
  textarea (au-dessus) ou le pre (`pointer-events: none`, purement
  décoratif) l'empêchent tous deux de "voir" le texte réel ; réglé en
  basculant temporairement `pointer-events` des deux (textarea: none, pre:
  auto) pendant la seule durée synchrone de l'appel, restauré aussitôt.
  `offsetForDomPosition` (nouveau, inverse exact de `domPositionForOffset`
  déjà existant) convertit le (nœud, offset) DOM trouvé en offset de texte
  brut.
- **`pixelTopForOffset` (défilement vers le curseur — ouverture d'une note,
  TOC, recherche, "Aller à l'ID") réécrite avec la même rigueur** : mesurait
  jusqu'ici sur un div miroir aux métriques UNIFORMES du textarea (comme le
  clic ci-dessus, même défaut), donc pouvait défiler vers une position qui
  laisse la cible réelle hors de la zone visible sur une note à plusieurs
  titres — vérifié par mesure directe : avant ce correctif, restaurer un
  curseur après 15 titres défilait vers une position qui laissait la cible
  à 1181px de haut dans une zone visible de 775px (largement hors champ).
  Mesure maintenant directement sur le texte réel du pre via un `Range`
  (même technique que le caret), corrigé à 540px (dans les 775px visibles).
- **Bug de timing corrigé au passage, condition nécessaire au fix
  ci-dessus** : `syncScroll()` (qui recopie `ta().scrollTop` vers
  `pre().scrollTop`) n'était déclenché que par l'évènement natif 'scroll',
  dispatché de façon ASYNCHRONE par le navigateur après une affectation
  programmatique de `scrollTop` — donc `pre()` pouvait rester désynchronisé
  (parfois avec le défilement de la note PRÉCÉDENTE) pendant un court
  instant après `input.scrollTop = ...`, faussant toute mesure faite
  immédiatement après (dont `pixelTopForOffset` lui-même). `syncScroll()`
  est maintenant appelée explicitement et synchrone juste après chacune des
  4 affectations de `input.scrollTop` dans ce fichier (une l'était déjà,
  `selectSearchMatch`, pour une autre raison documentée) ; une aussi
  ajoutée juste après `input.value = content` dans `open()` (avant même la
  première mesure), pour repartir d'un état synchronisé à 0 dès le début.
- Méthode de vérification à retenir pour tout futur bug de ce type : un
  clic **programmatique** (`setSelectionRange` direct) ne peut PAS révéler
  un problème de résolution de clic natif — seul un clic **simulé au
  niveau du protocole d'entrée** (`Input.dispatchMouseEvent`, pas un
  `MouseEvent` JS synthétique non plus, qui ne déclenche pas la résolution
  native de caret d'un textarea) le peut. Round 20 avait vérifié le
  mauvais niveau ; round 20bis a dû redescendre d'un cran.
- `make clean && make`, `make test` (114/114, inchangé — corrections
  DOM/interaction réelles, pas de nouvelle logique pure). **Vérifié par
  mesure directe et capture d'écran** (headless Brave + CDP, clic réel +
  frappe réelle simulés, note à 15 titres avec défilement) — curseur
  affiché, position de frappe réelle, et défilement à l'ouverture tous
  alignés sur la même mesure exacte. **Non vérifié en conditions
  réelles** (souris/clavier physiques) — à confirmer par l'utilisateur.

**Round 20ter (2026-07-17) — retour immédiat sur le round 20bis : caret
invisible sur une ligne vide, "tout est moins réactif", + option pour
désactiver l'agrandissement des titres** : trois demandes dans le même
message.
- **Bug réel trouvé et corrigé, root-causé empiriquement (pas par
  déduction)** : `updateCaretIndicator()` (round 20) gérait déjà le cas
  "ligne vide" via `range.selectNodeContents(span); range.collapse(true)`
  sur le `<span class="hl-line">` — supposé fonctionner puisque `.hl-line`
  a `min-height: 1lh` même vide. **Vérifié empiriquement (headless + test
  dédié) que c'est faux** : un `Range` construit ainsi (conteneur =
  ÉLÉMENT, pas nœud texte) renvoie systématiquement un rect VIDE dans
  Chromium — `getClientRects()` longueur 0 ET `getBoundingClientRect()`
  tout à zéro — **y compris pour une ligne NON vide** (testé sur les deux).
  Seul un `Range` collé à un vrai NŒUD TEXTE donne un rect utilisable.
  Corrigé (`lineRangeForOffset`, editor.js) : localise d'abord la ligne
  (`lineElementForOffset`, nouveau — compte les `\n` comme
  `Highlight.highlight()` pour trouver le `<span class="hl-line">` et
  l'offset local), puis `domPositionWithin` (généralisation de
  `domPositionForOffset` à une racine arbitraire, pas seulement tout le
  pre) pour un vrai nœud texte À L'INTÉRIEUR de cette ligne — pour
  n'IMPORTE quel offset local, y compris 0. Seule une ligne VRAIMENT vide
  (`domPositionWithin` ne trouve aucun nœud texte) retombe sur l'ÉLÉMENT
  `<span>` lui-même : `Element.getClientRects()`/`getBoundingClientRect()`
  existent aussi et donnent, eux, un rect valide (bord gauche = début de
  ligne) — vérifié empiriquement que CE cas-là fonctionne bien à la
  différence d'un `Range` sur le même élément. L'appelant traite Range et
  Element de façon uniforme (même signature `getClientRects`/
  `getBoundingClientRect`), pas de branchement selon le type retourné.
- **"Tout est moins réactif"** : cause identifiée par lecture de code (pas
  de profilage direct disponible dans cet environnement) —
  `updateCaretIndicator()` est appelée depuis `syncScroll()`, donc à
  CHAQUE évènement 'scroll' (potentiellement très fréquent pendant un
  défilement continu à la molette/au trackpad), et forçait un reflow
  synchrone à chaque appel (`indicator.style.animation = 'none'; void
  indicator.offsetHeight; indicator.style.animation = ''`, nécessaire pour
  relancer le clignotement) — un coût justifié sur un vrai déplacement du
  curseur (frappe, clic, flèches), pas sur un simple repositionnement
  visuel dû au défilement où la position de caractère n'a pas changé.
  Corrigé avec `_lastCaretOffset` (nouveau, module-level) : le forçage de
  reflow n'a lieu que si l'offset a RÉELLEMENT changé depuis le dernier
  appel — un pur repositionnement de défilement met à jour `left`/`top`
  (écritures de style bon marché, pas de lecture forçant un reflow) sans
  jamais toucher `animation`. **Non mesuré avec un vrai profileur** (pas
  disponible ici) — correction par raisonnement sur la source du coût
  (reflow forcé répété), à confirmer par l'utilisateur si le ressenti
  persiste.
- **Nouveau réglage `State.settings.headingSizesEnabled`** (bool, défaut
  `true` — comportement historique inchangé par défaut), Réglages >
  Éditeur juste après `fileListSidebarMode` : désactive l'agrandissement
  des titres dans l'éditeur (`.hl-h1`..`.hl-h4`, maintenant gatées derrière
  une classe `.heading-sizes` posée sur `<html>`) SANS toucher leur couleur
  (`.hl-heading`, jamais conditionnée). Motivation explicite de
  l'utilisateur : "on verra si cela aide" — l'agrandissement des titres est
  la cause racine COMMUNE aux rounds 13/20/20bis (le vrai textarea ne peut
  avoir qu'une seule taille de police uniforme, donc toute mesure/
  résolution qui s'appuie sur SES propres métriques — dont, non corrigée à
  ce jour, la navigation clavier verticale — diverge de l'overlay dès
  qu'une ligne agrandie précède la ligne courante) ; ce réglage permet de
  l'éliminer entièrement à la source plutôt que de continuer à corriger
  chaque nouvelle manifestation au cas par cas. Vérifié empiriquement
  (headless) : taille 28.8px (titre niveau 1, ×1.8 de la base 16px) avec le
  réglage actif, retombe à 16px désactivé, couleur du titre inchangée dans
  les deux cas, ré-activable sans rechargement.
- 2 nouvelles clés i18n × 2 langues (166 au total FR/EN toujours
  strictement synchronisées). `make clean && make`, cross-check des IDs,
  `make test` (114/114, inchangé). **Vérifié empiriquement** (headless
  Brave + CDP) pour les deux bugs et le nouveau réglage — voir les mesures
  ci-dessus. **Non vérifié en conditions réelles** (souris/clavier
  physiques, ressenti de réactivité) — à confirmer par l'utilisateur, en
  particulier si "moins réactif" a une autre cause que celle identifiée
  ici.

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
