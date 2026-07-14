'use strict';
// Extraction des `#tag` inline pour l'indexation (PLAN.md section 2,
// "Tags") — ported from zettelium-android's `data/storage/TagExtractor.kt`.
// Pas une syntaxe txt2tags — convention propre à Zettelium, appliquée sur
// le texte brut, pas sur l'AST du parseur.
//
// `#` ne doit être ni précédé d'un caractère de mot ni d'un autre `#`
// (exclut les ancres d'URL `page#section` et les marqueurs de titre
// markdown `## Titre`, qui ont un espace après le `#` de toute façon et ne
// matcheraient pas la classe de caractères juste après).
//
// `\p{L}` (Unicode property escape) exige le flag `u`, disponible sans
// polyfill dans Node 10+/tout navigateur evergreen — équivalent direct du
// Kotlin `\p{L}` (déjà Unicode-aware par défaut).
const TagExtractor = (() => {
  const TAG_REGEX = /(?<![\w#])#([\p{L}0-9_-]+)/gu;

  function extract(content) {
    const tags = new Set();
    for (const m of content.matchAll(TAG_REGEX)) tags.add(m[1]);
    return tags;
  }

  return { extract };
})();
