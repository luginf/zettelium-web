'use strict';
// Fonctions pures de formatage txt2tags pour le menu contextuel (clic droit)
// de l'éditeur — porté depuis zettelium-android's `EditorFormatting.kt`
// (mécanisme, pas la syntaxe : voir ce fichier pour le détail des règles de
// bascule). Différence délibérée avec le Kotlin d'origine : celui-ci
// renvoie (texteEntier, nouvelleSelection) — pratique pour réassigner un
// `Editable` — alors qu'ici chaque fonction renvoie la portion de texte
// ORIGINAL réellement modifiée (`{rangeStart, rangeEnd, replacement,
// cursorStart, cursorEnd}`). Nécessaire pour appliquer le changement via
// `document.execCommand('insertText', ...)` (préserve l'historique
// annuler/rétablir natif du textarea — réassigner `.value` en entier
// l'efface, round 2) : l'appelant sélectionne `[rangeStart, rangeEnd]` puis
// insère `replacement` à la place, plutôt que de réécrire toute la valeur.
const EditorFormatting = (() => {

  /** Encadre la sélection avec `marker` des deux côtés ; bascule (retire l'encadrement) s'il est déjà présent. */
  function wrapInline(text, selStart, selEnd, marker) {
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);

    if (start === end) {
      const cursor = start + marker.length;
      return { rangeStart: start, rangeEnd: start, replacement: marker + marker, cursorStart: cursor, cursorEnd: cursor };
    }

    const selected = text.slice(start, end);
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const unwrapped = selected.slice(marker.length, selected.length - marker.length);
      return { rangeStart: start, rangeEnd: end, replacement: unwrapped, cursorStart: start, cursorEnd: start + unwrapped.length };
    }

    const hasMarkerBefore = start >= marker.length && text.slice(start - marker.length, start) === marker;
    const hasMarkerAfter = end + marker.length <= text.length && text.slice(end, end + marker.length) === marker;
    if (hasMarkerBefore && hasMarkerAfter) {
      const newStart = start - marker.length;
      return {
        rangeStart: newStart, rangeEnd: end + marker.length, replacement: selected,
        cursorStart: newStart, cursorEnd: newStart + selected.length
      };
    }

    return {
      rangeStart: start, rangeEnd: end, replacement: marker + selected + marker,
      cursorStart: start + marker.length, cursorEnd: start + marker.length + selected.length
    };
  }

  /** Bascule `prefix` en début de chaque ligne non vide couverte par la sélection. */
  function toggleLinePrefix(text, selStart, selEnd, prefix) {
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndSearch = text.indexOf('\n', end);
    const lineEnd = lineEndSearch === -1 ? text.length : lineEndSearch;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allPrefixed = lines.every(l => l.trim() === '' || l.startsWith(prefix));
    const newLines = allPrefixed
      ? lines.map(l => l.startsWith(prefix) ? l.slice(prefix.length) : l)
      : lines.map(l => l.trim() === '' ? l : prefix + l);
    const newBlock = newLines.join('\n');
    const cursorEnd = Math.max(lineStart, lineEnd + (newBlock.length - block.length));
    return { rangeStart: lineStart, rangeEnd: lineEnd, replacement: newBlock, cursorStart: lineStart, cursorEnd };
  }

  /**
   * Bascule la syntaxe de titre txt2tags (`= Titre =`, `== Titre ==`, ...) de
   * niveau `level` (1-5) sur la ligne du curseur. Cliquer le même niveau que
   * celui déjà présent le retire (bascule) ; cliquer un niveau différent
   * convertit (remplace le marqueur) plutôt que d'empiler un second
   * encadrement. Réutilise `Txt2TagsRegexes.title` (pas une regex ad hoc) —
   * son `\1` impose que le marqueur de fermeture ait la même longueur que
   * celui d'ouverture, ce qu'une regex `(=+)...=+` ne vérifie pas.
   */
  function toggleHeading(text, selStart, selEnd, level) {
    const marker = '='.repeat(Math.min(5, Math.max(1, level)));
    const start = Math.min(selStart, selEnd);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndSearch = text.indexOf('\n', lineStart);
    const lineEnd = lineEndSearch === -1 ? text.length : lineEndSearch;
    const line = text.slice(lineStart, lineEnd);

    const match = Txt2TagsRegexes.title.exec(line);
    let newLine;
    if (!match) {
      newLine = `${marker} ${line.trim()} ${marker}`;
    } else if (match[1] === marker) {
      newLine = match[2].trim();
    } else {
      const label = match[3] || '';
      const labelSuffix = label ? `[${label}]` : '';
      newLine = `${marker} ${match[2].trim()} ${marker}${labelSuffix}`;
    }
    const cursor = lineStart + newLine.length;
    return { rangeStart: lineStart, rangeEnd: lineEnd, replacement: newLine, cursorStart: cursor, cursorEnd: cursor };
  }

  return { wrapInline, toggleLinePrefix, toggleHeading };
})();
