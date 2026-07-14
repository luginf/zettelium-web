'use strict';
// Regex bank for the txt2tags syntax — ported from zettelium-android's
// `parser/Txt2TagsRegexes.kt` (itself ported from `txt2tags3_mod/regexes.py`,
// see PLAN.md section 6). Single source of truth for syntax recognition,
// used by both the block/inline parser (parser.js/inline.js) and the
// editor's syntax highlighting (../highlight.js) — never duplicate a pattern
// ad hoc elsewhere (same rule as the Kotlin original).
//
// None of these regexes carry the 'g'/'i' flags (except where the Kotlin
// source used IGNORE_CASE) — `.exec()`/`.test()` on a flagless RegExp always
// searches fresh from index 0, matching Kotlin's stateless `Regex.find()`.
// Callers needing global iteration (highlight.js) make their own 'g'-flagged
// copies rather than mutating these.
const Txt2TagsRegexes = (() => {
  // --- Délimiteurs de blocs ---------------------------------------------
  const blockVerbOpen = /^```\s*$/;
  const blockVerbClose = blockVerbOpen;
  const blockRawOpen = /^"""\s*$/;
  const blockRawClose = blockRawOpen;
  const blockTaggedOpen = /^'''\s*$/;
  const blockTaggedClose = blockTaggedOpen;
  const blockCommentOpen = /^%%%\s*$/;
  const blockCommentClose = blockCommentOpen;

  const oneLineVerb = /^``` (?=.)/;
  const oneLineRaw = /^""" (?=.)/;
  const oneLineTagged = /^''' (?=.)/;

  // --- Formatage inline ---------------------------------------------------
  // Les marques doivent coller au contenu (pas d'espace en bordure) ; elles
  // sont gourmandes, donc dans ****gras****, ça devient **<b>gras</b>**.
  const fontMono = /``([^\s](?:.*?[^\s])?`*)``/;
  const raw = /""([^\s](?:.*?[^\s])?"*)""/;
  const tagged = /''([^\s](?:.*?[^\s])?'*)''/;
  const math = /\$\$([^\s](?:.*?[^\s])?\$*)\$\$/;
  const fontBold = /\*\*([^\s](?:.*?[^\s])?\**)\*\*/;
  const fontItalic = /\/\/([^\s](?:.*?[^\s])?\/*)\/\//;
  const fontUnderline = /__([^\s](?:.*?[^\s])?_*)__/;
  const fontStrike = /--([^\s](?:.*?[^\s])?-*)--/;

  // --- Listes -------------------------------------------------------------
  const list = /^( *)(-) (?=[^ ])/;
  const numlist = /^( *)(\+) (?=[^ ])/;
  const deflist = /^( *)(:) (.*)$/;
  const listClose = /^( *)([-+:])\s*$/;

  // --- Divers blocs --------------------------------------------------------
  const bar = /^(\s*)([_=-]{20,})\s*$/;
  const table = /^ *\|([|_/])? /;
  const blankLine = /^\s*$/;
  const comment = /^%/;

  // Extension Zettelium (pas dans txt2tags d'origine) : titres markdown ATX,
  // en plus des titres txt2tags — voir CLAUDE.md, "Décisions structurantes".
  const markdownHeading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

  // --- Titres txt2tags -----------------------------------------------------
  // "= Titre =" (numéroté) et "+ Titre +" (non numéroté), niveaux 1 à 5,
  // avec label optionnel "[mon-id]". Les marqueurs ouvrant/fermant doivent
  // avoir exactement la même longueur (backreference \1).
  const title = /^ *(={1,5})([^=](?:.*[^=])?)\1(?:\[([\w-]*)\])?\s*$/;
  const numtitle = /^ *(\+{1,5})([^+](?:.*[^+])?)\1(?:\[([\w-]*)\])?\s*$/;

  // --- Liens, images, emails ------------------------------------------------
  // Portage direct des fragments d'URL de regexes.py (urlskel). String.raw
  // évite le piège du double-échappement (une chaîne JS normale interprète
  // \b/\d comme des séquences d'échappement de chaîne, pas comme du regex).
  const URL_PROTO = String.raw`(https?|ftp|news|telnet|gopher|wais)://`;
  const URL_GUESS = String.raw`(www[23]?|ftp)\.`;
  const URL_LOGIN = String.raw`A-Za-z0-9_.-`;
  const URL_PASS = String.raw`[^ @]*`;
  const URL_CHARS = String.raw`A-Za-z0-9%._/~:,=$@&+-`;
  const URL_ANCHOR = String.raw`A-Za-z0-9%._-`;
  const URL_FORM = String.raw`A-Za-z0-9/%&=+:;.,$@*_-`;

  // [image.ext] — groupe nommé "path".
  const PATT_IMG = String.raw`\[(?<path>[\w_,.+%$#@!?+~/-]+\.(?:png|jpe?g|gif|eps|bmp|svg))\]`;

  // nom[:mot_de_passe] @
  const urlLoginPatt = `([${URL_LOGIN}]+(:${URL_PASS})?@)?`;

  // [ http:// ] [ user:pass@ ] domaine.com [ / ] [ #ancre | ?form=data ]
  const retxtUrl =
    String.raw`\b(${URL_PROTO}${urlLoginPatt}|${URL_GUESS})[${URL_CHARS}]+\b/*(\?[${URL_FORM}]+)?(#[${URL_ANCHOR}]*)?`;

  // fichier | [fichier] #ancre
  const retxtUrlLocal = `[${URL_CHARS}]+|[${URL_CHARS}]*(#[${URL_ANCHOR}]*)`;

  // user@domaine [ ?form=data ]
  const pattEmail = String.raw`\b[${URL_LOGIN}]+@([A-Za-z0-9_-]+\.)+[A-Za-z]{2,4}\b(\?[${URL_FORM}]+)?`;

  const email = new RegExp(pattEmail, 'i');
  const link = new RegExp(`${retxtUrl}|${pattEmail}`, 'i');

  // [ label  url|email|fichier ] — groupes nommés "label"/"link". Simplification vs.
  // txt2tags d'origine : le label ne peut pas être lui-même une image imbriquée
  // (`[[img.png] url]`), cas rare non supporté ici (voir SKILLS.md).
  const linkmark = new RegExp(
    String.raw`\[(?<label>[^\]]+) (?<link>${retxtUrl}|${pattEmail}|${retxtUrlLocal})\]`, 'i');
  const img = new RegExp(PATT_IMG, 'i');

  // [[ cible | zkId ]] — convention Zettelium (pas de la syntaxe txt2tags d'origine),
  // voir zettelkasten.js. Double crochets + `|`, jamais confondu avec `linkmark`
  // (qui exige un espace, pas de `|`) ni `img` (crochets simples).
  const zkLink = /\[\[(?<target>[^\]|]*)\|(?<zkId>[^\]]*)\]\]/;

  return {
    blockVerbOpen, blockVerbClose, blockRawOpen, blockRawClose,
    blockTaggedOpen, blockTaggedClose, blockCommentOpen, blockCommentClose,
    oneLineVerb, oneLineRaw, oneLineTagged,
    fontMono, raw, tagged, math, fontBold, fontItalic, fontUnderline, fontStrike,
    list, numlist, deflist, listClose,
    bar, table, blankLine, comment, markdownHeading,
    title, numtitle,
    email, link, linkmark, img, zkLink,
  };
})();
