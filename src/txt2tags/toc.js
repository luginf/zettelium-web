'use strict';
// Table des matières d'un document txt2tags — ported from zettelium-android's
// `parser/Txt2TagsToc.kt`. Reprend exactement la même détection de titre que
// `Txt2TagsParser.matchHeading` (même banque `Txt2TagsRegexes`, même ordre
// de précédence title/numtitle/markdownHeading), pour garantir que les
// entrées correspondent 1 pour 1 et dans le même ordre aux blocs `Heading`
// produits par le parseur — l'éditeur s'appuie sur cette correspondance
// pour faire défiler l'aperçu jusqu'au bon bloc (voir editor.js).
//
// Volontairement **pas** un champ de position ajouté sur `Heading` lui-même :
// nos tests (`test/cases.js`) comparent les `Heading` par égalité profonde,
// y ajouter un offset casserait ces comparaisons pour un gain marginal — un
// scan séparé et léger suffit (même raisonnement que le Kotlin d'origine).
const Txt2TagsToc = (() => {
  // Pas de filtre sur un titre vide : `Txt2TagsParser.matchHeading` n'en
  // applique aucun et produit toujours un bloc `Heading`, même vide — la
  // correspondance 1 pour 1 avec les entrées de TOC exige le même critère
  // des deux côtés (piège déjà rencontré et corrigé côté Android, round 16).
  function matchHeadingEntry(line, offset) {
    let m = Txt2TagsRegexes.title.exec(line);
    if (m) return { level: m[1].length, title: m[2].trim(), charOffset: offset };
    m = Txt2TagsRegexes.numtitle.exec(line);
    if (m) return { level: m[1].length, title: m[2].trim(), charOffset: offset };
    m = Txt2TagsRegexes.markdownHeading.exec(line);
    if (m) return { level: m[1].length, title: m[2].trim(), charOffset: offset };
    return null;
  }

  function build(source) {
    const entries = [];
    let offset = 0;
    for (const line of source.split('\n')) {
      const entry = matchHeadingEntry(line, offset);
      if (entry) entries.push(entry);
      offset += line.length + 1;
    }
    return entries;
  }

  return { build };
})();
