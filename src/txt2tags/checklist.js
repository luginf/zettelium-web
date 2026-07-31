'use strict';
// Cases à cocher (`- [ ] tâche` / `- [x] tâche`) — porté de
// zettelium-android's `parser/Txt2TagsChecklist.kt` (round 32/34). Convention
// Zettelium, pas de la syntaxe txt2tags d'origine — comme `#tag`/
// `[[cible|zkId]]`, appliquée sur le contenu d'un item de liste NON ordonnée,
// jamais sur l'AST directement (une case à cocher reste un `ListItem`
// ordinaire pour le parseur ; `parseCheckbox` la reconnaît a posteriori à
// partir de son texte).
//
// `toggle` et `assignIndices` doivent rester d'accord sur l'ORDRE dans lequel
// les cases sont numérotées : `toggle` scanne le texte source ligne par
// ligne (haut en bas, peu importe l'imbrication) et `assignIndices` parcourt
// l'AST en profondeur (item courant avant ses enfants) — les deux parcours
// visitent les cases dans le même ordre par construction (un item enfant est
// toujours situé APRÈS la ligne de son parent dans le texte source).
const Txt2TagsChecklist = (() => {
  // Groupe OPTIONNEL : "[]" (rien entre les crochets) doit aussi être
  // reconnu comme case à cocher décochée, pas seulement "[ ]" avec un espace
  // explicite — demande utilisateur explicite (round 34), les deux formes
  // doivent se comporter à l'identique.
  const CHECKBOX_MARK = /^\[([ xX]?)\]/;

  /**
   * `content` : texte d'un item de liste non ordonnée après son marqueur
   * "- ". `null` si ce n'est pas une case à cocher. Retourne `{checked,
   * label}` — l'état coché ("[x]"/"[X]" seulement, "[ ]"/"[]" comptent tous
   * les deux comme décoché) et le libellé débarrassé du marqueur et d'UN
   * espace séparateur éventuel.
   */
  function parseCheckbox(content) {
    const match = CHECKBOX_MARK.exec(content);
    if (!match || match.index !== 0) return null;
    const checked = /^x$/i.test(match[1]);
    const label = content.slice(match[0].length).replace(/^ /, '');
    return { checked, label };
  }

  /**
   * Bascule la case à cocher d'indice `index` (0-based, ordre haut-en-bas du
   * texte source, listes imbriquées comprises) entre coché/décoché. `null`
   * si l'indice est hors limites (aucune case à cet indice) — l'appelant ne
   * modifie alors rien.
   */
  function toggle(source, index) {
    const lines = source.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const listMatch = Txt2TagsRegexes.list.exec(line);
      if (!listMatch) continue;
      const contentStart = listMatch[0].length;
      const content = line.slice(contentStart);
      const match = CHECKBOX_MARK.exec(content);
      if (!match || match.index !== 0) continue;
      if (count === index) {
        const checked = /^x$/i.test(match[1]);
        const newMark = checked ? ' ' : 'x';
        lines[i] = line.slice(0, contentStart) + '[' + newMark + ']' + content.slice(match[0].length);
        return lines.join('\n');
      }
      count++;
    }
    return null;
  }

  /**
   * Associe chaque `ListItem` "case à cocher" (liste non ordonnée
   * uniquement) à son indice `toggle` correspondant. Une vraie `Map` (clés =
   * objets `ListItem`) suffit ici — contrairement à un `IdentityHashMap`
   * Kotlin nécessaire pour éviter l'égalité structurelle, une `Map` JS
   * utilise déjà l'identité de référence pour des clés objet, jamais
   * l'égalité structurelle : deux items au texte strictement identique (ex.
   * deux "- [ ] " vides) restent des entrées distinctes.
   *
   * Calculé une seule fois sur l'AST complet (voir editor.js, appelé avec le
   * même AST que celui passé à `Txt2TagsRender.renderAstToHtml`), jamais
   * pendant le rendu lui-même — mêmes raisons que la correspondance TOC ↔
   * `Heading` (toc.js).
   */
  function assignIndices(blocks) {
    const result = new Map();
    let next = 0;
    function visit(items) {
      for (const block of items) {
        if (block.type !== 'ListNode') continue;
        for (const item of block.items) {
          if (!block.ordered) {
            const first = item.inlines[0];
            if (first && first.type === 'Text' && parseCheckbox(first.text) != null) {
              result.set(item, next++);
            }
          }
          visit(item.children);
        }
      }
    }
    visit(blocks);
    return result;
  }

  return { parseCheckbox, toggle, assignIndices };
})();
