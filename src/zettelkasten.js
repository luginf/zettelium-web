'use strict';
// Fonctions Zettelkasten — ported 1:1 from zettelium-android's
// `parser/ZettelkastenLinks.kt` (ID generation/detection, `[[cible|zkId]]`
// link syntax, link repair transform). Model from QOwnNotes'
// `zettelkasten.qml` (see PLAN.md section 5). Pure module, no dependency on
// State/DOM — same "stays testable in isolation" property as the Kotlin
// original.
const ZettelkastenLinks = (() => {
  // Format d'ID par défaut : horodatage à 14 chiffres, ex. `20260702143012`.
  const DEFAULT_ID_REGEX = /id\d{8}x\d{6}|\d{14}/;
  // Format de génération par défaut — correspond exactement à DEFAULT_ID_REGEX.
  const DEFAULT_ID_FORMAT = 'id%Y%M%Dx%h%m%s';
  // Utilisées seulement si l'appelant n'en fournit pas explicitement — voir
  // `noteExtensionsList()` dans state.js, la source de vérité réelle une
  // fois l'app démarrée.
  const DEFAULT_NOTE_EXTENSIONS = ['.txt', '.t2t', '.md'];

  const LINK_REGEX_G = /\[\[([^\]|]*)\|([^\]]*)\]\]/g;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /**
   * Génère un ID Zettelkasten à partir d'un `format` à tokens (`%Y` année sur
   * 4 chiffres, `%M`/`%D`/`%h`/`%m`/`%s` mois/jour/heure/minute/seconde sur 2
   * chiffres, tout le reste recopié tel quel). Distinct du motif de
   * *détection* (`idPattern`, une regex arbitraire non inversible en
   * général) — voir le piège documenté côté Android (rounds 12/12bis/12ter,
   * un motif personnalisé ne reconnaissait jamais l'ID de sa propre note
   * tant que génération et détection restaient désynchronisées).
   */
  function generateId(now = new Date(), format = DEFAULT_ID_FORMAT) {
    // replaceAll, pas replace : un token répété (`%Y-%Y`) doit être remplacé partout, comme
    // le `String.replace` de Kotlin (toutes les occurrences) et le `string map` de Tcl.
    return format
      .replaceAll('%Y', String(now.getFullYear()))
      .replaceAll('%M', pad2(now.getMonth() + 1))
      .replaceAll('%D', pad2(now.getDate()))
      .replaceAll('%h', pad2(now.getHours()))
      .replaceAll('%m', pad2(now.getMinutes()))
      .replaceAll('%s', pad2(now.getSeconds()));
  }

  /** Retire tous les liens `[[cible|id]]` du texte — passe préalable avant de chercher l'ID propre d'une note. */
  function stripLinks(content) {
    return content.replace(LINK_REGEX_G, '');
  }

  /**
   * Détecte l'ID Zettelkasten d'une note : d'abord dans le nom de fichier,
   * sinon dans le corps du texte, **après avoir retiré les liens
   * `[[cible|id]]` existants** — sinon un ID *référencé* serait confondu
   * avec l'ID *propre* de la note (piège documenté dans `zettelkasten.qml`).
   */
  function extractId(fileName, content, idRegex = DEFAULT_ID_REGEX) {
    let m = idRegex.exec(fileName);
    if (m) return m[0];
    const body = stripLinks(content);
    const urls = urlRanges(body);
    const re = new RegExp(idRegex.source, 'g');
    while ((m = re.exec(body))) {
      if (isIsolatedMatch(body, m.index, m.index + m[0].length, urls)) return m[0];
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    return null;
  }

  // Un ID trouvé dans le TEXTE doit être isolé (ni lettre ni chiffre collé de chaque côté) et
  // hors d'une URL : sinon `\d{14}` prenait 14 chiffres d'un lien ou d'un numéro plus long.
  function urlRanges(text) {
    return [...text.matchAll(/https?:\/\/\S+|www\.\S+/g)].map(u => [u.index, u.index + u[0].length]);
  }

  function isIsolatedMatch(text, start, end, urls) {
    const isAlnum = ch => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
    return !isAlnum(text[start - 1]) && !isAlnum(text[end]) && !urls.some(([a, b]) => start >= a && start < b);
  }

  /**
   * Position réelle (offsets dans `content`, pas dans une version tronquée)
   * de la première occurrence de l'ID Zettelkasten DANS LE CORPS du texte —
   * pour "aller à l'ID" (placer le curseur/défiler dessus). Même précédence
   * que `extractId` (première correspondance en balayant de haut en bas,
   * hors des liens `[[cible|id]]` existants) mais `stripLinks` ne peut pas
   * servir ici : il décale les offsets, `extractId` s'en accommode car il
   * ne renvoie que la SOUS-CHAÎNE trouvée, jamais sa position. On saute donc
   * les correspondances qui chevauchent un lien plutôt que de les retirer
   * du texte au préalable.
   */
  function findBodyIdOccurrence(content, idRegex = DEFAULT_ID_REGEX) {
    const links = findLinks(content);
    const urls = urlRanges(content);
    const re = new RegExp(idRegex.source, 'g');
    let m;
    while ((m = re.exec(content))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!links.some(link => start < link.end && end > link.start) && isIsolatedMatch(content, start, end, urls)) {
        return { start, end };
      }
      if (re.lastIndex === m.index) re.lastIndex++; // garde-fou motif à correspondance vide
    }
    return null;
  }

  /** Trouve tous les liens `[[cible|id]]` d'un texte, dans l'ordre d'apparition. `start`/`end` = offsets (end exclusif). */
  function findLinks(content) {
    return [...content.matchAll(LINK_REGEX_G)].map(m => ({
      rawTarget: m[0],
      target: m[1],
      zkId: m[2],
      start: m.index,
      end: m.index + m[0].length,
    }));
  }

  /**
   * Lien `[[cible|id]]` chevauchant la sélection ou la position de curseur
   * donnée, s'il existe — pour "suivre le lien" depuis l'éditeur. Un
   * curseur posé juste avant `[[` ou juste après `]]` compte comme "dans"
   * le lien (chevauchement inclusif, volontairement généreux).
   */
  function linkAt(content, selStart, selEnd) {
    if (selStart < 0 || selEnd < 0) return null;
    const from = Math.min(selStart, selEnd);
    const to = Math.max(selStart, selEnd);
    return findLinks(content).find(link => from <= link.end && to >= link.start) || null;
  }

  function formatLink(target, zkId) {
    return `[[${target}|${zkId}]]`;
  }

  /** `fileName` sans son extension de note reconnue (`extensions`), ou tel quel si elle n'y figure pas. */
  function stripNoteExtension(fileName, extensions = DEFAULT_NOTE_EXTENSIONS) {
    const lower = fileName.toLowerCase();
    const ext = extensions.find(e => lower.endsWith(e.toLowerCase()));
    return ext ? fileName.slice(0, fileName.length - ext.length) : fileName;
  }

  /** Cible à utiliser dans un lien `[[cible|zkId]]` pour `fileName`, selon la préférence d'extension du dépôt. */
  function linkTarget(fileName, includeExtension, extensions = DEFAULT_NOTE_EXTENSIONS) {
    return includeExtension ? fileName : stripNoteExtension(fileName, extensions);
  }

  /**
   * Réécrit dans `content` tout lien `[[ancienneCible|zkId]]` vers
   * `[[currentTarget|zkId]]` — ne touche que les liens ciblant `zkId`, et
   * laisse inchangés ceux qui pointent déjà vers `currentTarget`.
   */
  function repairLinks(content, zkId, currentTarget) {
    const pattern = new RegExp(String.raw`\[\[([^\]|]*)\|${escapeRegExp(zkId)}\]\]`, 'g');
    return content.replace(pattern, (match, oldTarget) =>
      oldTarget === currentTarget ? match : formatLink(currentTarget, zkId));
  }

  /** Compile `pattern`, ou retombe silencieusement sur le motif par défaut s'il n'est pas une regex valide. */
  function compileIdRegex(pattern) {
    if (!pattern) return DEFAULT_ID_REGEX;
    try {
      return new RegExp(pattern);
    } catch (_) {
      return DEFAULT_ID_REGEX;
    }
  }

  return {
    DEFAULT_ID_REGEX, DEFAULT_ID_FORMAT, DEFAULT_NOTE_EXTENSIONS,
    generateId, stripLinks, extractId, findBodyIdOccurrence, findLinks, linkAt, formatLink,
    stripNoteExtension, linkTarget, repairLinks, compileIdRegex,
  };
})();
