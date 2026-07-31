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

  // --- Gestion des listes (round 32/34 zettelium-android) -----------------

  /**
   * Reconnaît une ligne de liste txt2tags (`-`/`+`/`:`) et sépare son
   * marqueur (indent compris) de son contenu — `null` si `line` n'est pas un
   * item de liste. Essaie d'abord la grammaire d'OUVERTURE du parseur
   * (`Txt2TagsRegexes.list`/`numlist`/`deflist`, qui exige un contenu non
   * vide après le marqueur), puis `Txt2TagsRegexes.listClose` (marqueur
   * seul, sans contenu — la même regex que le parseur utilise pour repérer
   * la fin d'une liste) : sans ce second essai, une ligne "- " vide ne
   * serait reconnue comme item de liste par aucune des trois premières
   * regex (leur lookahead exige un caractère non-espace après le marqueur),
   * cassant la sortie de liste sur item vide de `continueListOnNewline`.
   */
  function listMarkerOf(line) {
    let m = Txt2TagsRegexes.list.exec(line);
    if (m) return { prefix: line.slice(0, m[0].length), content: line.slice(m[0].length).trim() };
    m = Txt2TagsRegexes.numlist.exec(line);
    if (m) return { prefix: line.slice(0, m[0].length), content: line.slice(m[0].length).trim() };
    m = Txt2TagsRegexes.deflist.exec(line);
    if (m) return { prefix: `${m[1]}: `, content: m[3].trim() };
    m = Txt2TagsRegexes.listClose.exec(line);
    if (m) return { prefix: `${m[1]}${m[2]} `, content: '' };
    return null;
  }

  /**
   * Continuation automatique du marqueur de liste à l'Entrée : `text`/
   * `cursor` = texte et position du curseur juste APRÈS l'insertion d'un
   * unique "\n" par l'utilisateur — ne doit être appelé que pour une frappe
   * Entrée isolée, jamais un collage multi-lignes (voir editor.js, filtré
   * sur `InputEvent.inputType === 'insertLineBreak'`). Si la ligne qui
   * vient de se terminer est un item de liste NON VIDE, reconduit le même
   * marqueur (indent/type identiques) sur la nouvelle ligne ; si elle ne
   * contenait QUE le marqueur (item vide), le retire au lieu de le
   * reconduire — convention "ligne vide = sortir de la liste", plutôt que
   * d'empiler des marqueurs vides indéfiniment. `null` si la ligne
   * précédente n'était pas un item de liste (rien à faire).
   *
   * Cas particulier des cases à cocher (`- [ ] tâche`, round 34, demande
   * utilisateur explicite) : continuer un item non ordonné qui EST une case
   * à cocher insère une case FRAÎCHE (toujours décochée, `"[ ] "`) sur la
   * ligne suivante plutôt que de répéter juste `"- "` (qui perdrait la
   * convention case à cocher dès le deuxième item) ; un item "vide" au sens
   * de la sortie de liste devient alors "case sans libellé" plutôt que
   * "rien après le marqueur". Restreint aux listes non ordonnées (marqueur
   * `-`) — même restriction que le rendu de l'aperçu (render.js), une liste
   * numérotée/de définition n'a pas vocation à porter des cases.
   */
  function continueListOnNewline(text, cursor) {
    if (cursor <= 0 || text[cursor - 1] !== '\n') return null;
    const prevLineEnd = cursor - 1;
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const marker = listMarkerOf(text.slice(prevLineStart, prevLineEnd));
    if (!marker) return null;
    const withoutTrailingSpace = marker.prefix.slice(0, -1);
    const markerChar = withoutTrailingSpace[withoutTrailingSpace.length - 1];
    const isUnordered = markerChar === '-' || markerChar === '*';
    const checkbox = isUnordered ? Txt2TagsChecklist.parseCheckbox(marker.content) : null;
    const isEmpty = checkbox ? checkbox.label === '' : marker.content === '';
    if (isEmpty) {
      return { rangeStart: prevLineStart, rangeEnd: cursor, replacement: '', cursorStart: prevLineStart, cursorEnd: prevLineStart };
    }
    const insertion = checkbox ? marker.prefix + '[ ] ' : marker.prefix;
    const newCursor = cursor + insertion.length;
    return { rangeStart: cursor, rangeEnd: cursor, replacement: insertion, cursorStart: newCursor, cursorEnd: newCursor };
  }

  const LIST_INDENT_UNIT = '  ';
  const LIST_MARKER_LINE = /^( *)([-*+:]) /;

  function transformListLines(text, selStart, selEnd, transform) {
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEndSearch = text.indexOf('\n', end);
    const lineEnd = lineEndSearch === -1 ? text.length : lineEndSearch;
    const block = text.slice(lineStart, lineEnd);
    const newLines = block.split('\n').map(line => {
      const m = LIST_MARKER_LINE.exec(line);
      return m ? transform(line, m[1]) : line;
    });
    const newBlock = newLines.join('\n');
    const cursorEnd = Math.max(lineStart, lineEnd + (newBlock.length - block.length));
    return { rangeStart: lineStart, rangeEnd: lineEnd, replacement: newBlock, cursorStart: lineStart, cursorEnd };
  }

  /** Ajoute `LIST_INDENT_UNIT` avant le marqueur de chaque ligne de liste
   *  (`-`/`+`/`:`) couverte par la sélection — fait descendre l'item d'un
   *  niveau d'imbrication. Les lignes qui ne sont pas des items de liste
   *  sont laissées telles quelles (pas d'indentation générique de
   *  paragraphe). */
  function indentListLines(text, selStart, selEnd) {
    return transformListLines(text, selStart, selEnd, line => LIST_INDENT_UNIT + line);
  }

  /** Retire jusqu'à `LIST_INDENT_UNIT` d'espaces en tête de chaque ligne de
   *  liste sélectionnée — sans effet sur une ligne déjà à la racine (indent
   *  0) ou qui n'est pas un item de liste. */
  function dedentListLines(text, selStart, selEnd) {
    return transformListLines(text, selStart, selEnd, (line, indent) =>
      line.slice(Math.min(indent.length, LIST_INDENT_UNIT.length)));
  }

  return {
    wrapInline, toggleLinePrefix, toggleHeading,
    continueListOnNewline, indentListLines, dedentListLines,
  };
})();
