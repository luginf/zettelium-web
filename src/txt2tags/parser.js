'use strict';
// Parseur bloc txt2tags — ported from zettelium-android's
// `parser/Txt2TagsParser.kt`. Scanner ligne par ligne (machine à états, pas
// de récursif descendant — voir CLAUDE.md), inspiré de l'architecture de
// `txt2tags3_mod/processing.py` mais produisant l'AST partagé (ast.js).
//
// Simplifications assumées, héritées du Kotlin (voir PLAN.md section 6) :
//  - pas de bloc "quote" (indentation par tabulation) ;
//  - pas de continuation multi-ligne dans un item de liste ;
//  - listes de définition (`: terme`) : la description n'est pas supportée ;
//  - tableaux : pas de colspan, pas d'alignement par cellule, pas d'en-têtes
//    verticaux (`|_`, `|/`) ;
//  - pas de macros (`%%macroname`, `%%toc`) : les lignes `%%...` sont
//    traitées comme des commentaires simples.
const Txt2TagsParser = (() => {
  function parse(source) {
    return new Session().parse(source);
  }

  class OpenList {
    constructor(indent, ordered, isDef) {
      this.indent = indent;
      this.ordered = ordered;
      this.isDef = isDef;
      this.items = []; // ItemBuilder[]
    }
  }

  class ItemBuilder {
    constructor(inlines) {
      this.inlines = inlines;
      this.children = [];
    }
  }

  class Session {
    constructor() {
      this.blocks = [];
      this.paragraphLines = [];
      this.commentLines = [];
      this.listStack = [];
      this.tableRows = null;
    }

    parse(source) {
      const lines = source.split('\n');
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        if (Txt2TagsRegexes.blockCommentOpen.test(line)) {
          this.closeEverything();
          const { collected, next } = this.consumeBlock(lines, i, Txt2TagsRegexes.blockCommentClose);
          this.blocks.push(Comment(collected));
          i = next; continue;
        }
        if (Txt2TagsRegexes.blockVerbOpen.test(line)) {
          this.closeEverything();
          const { collected, next } = this.consumeBlock(lines, i, Txt2TagsRegexes.blockVerbClose);
          this.blocks.push(CodeBlock(collected, 'verbatim'));
          i = next; continue;
        }
        if (Txt2TagsRegexes.blockRawOpen.test(line)) {
          this.closeEverything();
          const { collected, next } = this.consumeBlock(lines, i, Txt2TagsRegexes.blockRawClose);
          this.blocks.push(CodeBlock(collected, 'raw'));
          i = next; continue;
        }
        if (Txt2TagsRegexes.blockTaggedOpen.test(line)) {
          this.closeEverything();
          const { collected, next } = this.consumeBlock(lines, i, Txt2TagsRegexes.blockTaggedClose);
          this.blocks.push(CodeBlock(collected, 'tagged'));
          i = next; continue;
        }

        const oneLineVerb = Txt2TagsRegexes.oneLineVerb.exec(line);
        if (oneLineVerb) {
          this.closeEverything();
          this.blocks.push(CodeBlock([line.slice(oneLineVerb.index + oneLineVerb[0].length)], 'verbatim'));
          i++; continue;
        }
        const oneLineRaw = Txt2TagsRegexes.oneLineRaw.exec(line);
        if (oneLineRaw) {
          this.closeEverything();
          this.blocks.push(CodeBlock([line.slice(oneLineRaw.index + oneLineRaw[0].length)], 'raw'));
          i++; continue;
        }
        const oneLineTagged = Txt2TagsRegexes.oneLineTagged.exec(line);
        if (oneLineTagged) {
          this.closeEverything();
          this.blocks.push(CodeBlock([line.slice(oneLineTagged.index + oneLineTagged[0].length)], 'tagged'));
          i++; continue;
        }

        if (Txt2TagsRegexes.blankLine.test(line)) {
          this.closeEverything();
          i++; continue;
        }

        if (line.startsWith('%')) {
          this.flushParagraph();
          this.closeAllLists();
          this.closeTable();
          this.commentLines.push(line);
          i++; continue;
        }

        const bar = Txt2TagsRegexes.bar.exec(line);
        if (bar) {
          this.closeEverything();
          this.blocks.push(HorizontalRule(bar[2][0]));
          i++; continue;
        }

        const heading = this.matchHeading(line);
        if (heading) {
          this.closeEverything();
          this.blocks.push(heading);
          i++; continue;
        }

        if (this.handleListLine(line)) {
          this.flushParagraph();
          this.closeTable();
          this.flushComment();
          i++; continue;
        }

        if (Txt2TagsRegexes.table.test(line)) {
          this.flushParagraph();
          this.closeAllLists();
          this.flushComment();
          if (!this.tableRows) this.tableRows = [];
          this.tableRows.push(this.parseTableRow(line));
          i++; continue;
        }

        // Paragraphe (bloc par défaut) : referme listes/tableau/commentaires en
        // cours, mais PAS le paragraphe déjà ouvert (continuation).
        this.closeAllLists();
        this.closeTable();
        this.flushComment();
        this.paragraphLines.push(line);
        i++;
      }
      this.closeEverything();
      return this.blocks;
    }

    closeEverything() {
      this.flushParagraph();
      this.closeAllLists();
      this.closeTable();
      this.flushComment();
    }

    flushParagraph() {
      if (!this.paragraphLines.length) return;
      const text = this.paragraphLines.join(' ');
      this.paragraphLines = [];
      this.blocks.push(Paragraph(Txt2TagsInline.parse(text)));
    }

    flushComment() {
      if (!this.commentLines.length) return;
      const lines = this.commentLines;
      this.commentLines = [];
      this.blocks.push(Comment(lines));
    }

    closeTable() {
      const rows = this.tableRows;
      if (!rows) return;
      this.tableRows = null;
      if (rows.length) this.blocks.push(Table(rows));
    }

    closeAllLists() {
      while (this.listStack.length) this.popListFrame();
    }

    popListFrame() {
      const frame = this.listStack.pop();
      const block = frame.isDef
        ? DefinitionList(frame.items.map(it => DefinitionItem(it.inlines, [])))
        : ListNode(frame.ordered, frame.items.map(it => ListItem(it.inlines, it.children)));
      const parent = this.listStack[this.listStack.length - 1];
      const parentItem = parent && parent.items[parent.items.length - 1];
      if (parentItem) {
        parentItem.children.push(block);
      } else {
        this.blocks.push(block);
      }
    }

    markerMatches(frame, marker) {
      switch (marker) {
        case '-': return !frame.isDef && !frame.ordered;
        case '+': return !frame.isDef && frame.ordered;
        case ':': return frame.isDef;
        default: return false;
      }
    }

    handleListLine(line) {
      const closeMatch = Txt2TagsRegexes.listClose.exec(line);
      if (closeMatch && this.listStack.length) {
        const indent = closeMatch[1].length;
        const marker = closeMatch[2][0];
        const top = this.listStack[this.listStack.length - 1];
        if (top.indent === indent && this.markerMatches(top, marker)) {
          this.popListFrame();
          return true;
        }
      }

      const listMatch = Txt2TagsRegexes.list.exec(line);
      const numMatch = !listMatch ? Txt2TagsRegexes.numlist.exec(line) : null;
      const defMatch = (!listMatch && !numMatch) ? Txt2TagsRegexes.deflist.exec(line) : null;
      const match = listMatch || numMatch || defMatch;
      if (!match) return false;

      const indent = match[1].length;
      const isDef = !!defMatch;
      const ordered = !!numMatch;
      const content = isDef ? match[3] : line.slice(match.index + match[0].length);

      while (this.listStack.length && this.listStack[this.listStack.length - 1].indent > indent) {
        this.popListFrame();
      }
      const top = this.listStack[this.listStack.length - 1];
      if (top && top.indent === indent && (top.isDef !== isDef || top.ordered !== ordered)) {
        this.popListFrame();
      }
      if (!this.listStack.length || this.listStack[this.listStack.length - 1].indent < indent) {
        this.listStack.push(new OpenList(indent, ordered, isDef));
      }

      this.listStack[this.listStack.length - 1].items.push(new ItemBuilder(Txt2TagsInline.parse(content.trim())));
      return true;
    }

    matchHeading(line) {
      let m = Txt2TagsRegexes.title.exec(line);
      if (m) return Heading(m[1].length, Txt2TagsInline.parse(m[2].trim()), m[3] || null, true);
      m = Txt2TagsRegexes.numtitle.exec(line);
      if (m) return Heading(m[1].length, Txt2TagsInline.parse(m[2].trim()), m[3] || null, false);
      m = Txt2TagsRegexes.markdownHeading.exec(line);
      if (m) return Heading(m[1].length, Txt2TagsInline.parse(m[2].trim()), null, true);
      return null;
    }

    /** Table simplifiée : cellules séparées par " | ", "||" en tête = ligne d'en-tête. */
    parseTableRow(rawLine) {
      let line = rawLine.replace(/^ +/, '').replace(/^\|/, '');
      const isHeader = line.startsWith('|');
      if (isHeader) line = line.slice(1);
      if (line.startsWith(' ')) line = line.slice(1);
      line = line.trim();
      if (line.endsWith('|')) line = line.slice(0, -1).trim();
      const cellTexts = line === '' ? [] : line.split(' | ');
      const cells = cellTexts.map(t => TableCell(Txt2TagsInline.parse(t.trim())));
      return TableRow(cells, isHeader);
    }

    consumeBlock(lines, start, closeRegex) {
      const collected = [];
      let i = start + 1;
      while (i < lines.length && !closeRegex.test(lines[i])) {
        collected.push(lines[i]);
        i++;
      }
      const next = i < lines.length ? i + 1 : i;
      return { collected, next };
    }
  }

  return { parse };
})();
