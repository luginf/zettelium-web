'use strict';
// AST -> HTML rendering for the real preview (phase 3) — zettelium-android
// doesn't need this (it renders the AST natively in Compose instead), so
// this module has no Kotlin counterpart to port from.
//
// Deviation from txt2tags semantics, deliberate: original txt2tags treats
// """raw""" / '''tagged''' text (block and inline) as verbatim passthrough
// into the *target's native syntax* — for an HTML target that would mean
// literal, unescaped HTML. Here the "target" is this app's own live DOM, so
// treating repository-file content as trusted-to-inject-unescaped would be
// a self-XSS risk (a note file is still untrusted input, e.g. shared/synced
// from elsewhere). All three code-block kinds and raw/tagged inlines are
// therefore rendered as escaped text, not injected verbatim.
const Txt2TagsRender = (() => {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderInlines(inlines, opts) {
    return inlines.map(i => renderInline(i, opts)).join('');
  }

  // `opts.resolveZkLink(zkId)` (phase 5, optional) resolves a ZkLink to an
  // index entry `{path, ...}` — when it returns one, the link renders as a
  // clickable `<a data-zk-path>` (wired up by editor.js); otherwise (index
  // not built yet, or target genuinely missing) it stays a plain, inert span.
  function renderInline(inline, opts = {}) {
    switch (inline.type) {
      case 'Text': return escapeHtml(inline.text);
      case 'Bold': return `<b>${renderInlines(inline.children, opts)}</b>`;
      case 'Italic': return `<i>${renderInlines(inline.children, opts)}</i>`;
      case 'Underline': return `<u>${renderInlines(inline.children, opts)}</u>`;
      case 'Strike': return `<s>${renderInlines(inline.children, opts)}</s>`;
      case 'Mono': return `<code>${escapeHtml(inline.text)}</code>`;
      case 'RawInline': return escapeHtml(inline.text);
      case 'TaggedInline': return escapeHtml(inline.text);
      case 'Link':
        return `<a href="${escapeHtml(inline.target)}" target="_blank" rel="noopener">${renderInlines(inline.label, opts)}</a>`;
      case 'ZkLink': {
        const resolved = opts.resolveZkLink ? opts.resolveZkLink(inline.zkId) : null;
        if (resolved) {
          return `<a href="#" class="zk-link" data-zk-path="${escapeHtml(resolved.path)}" title="zkId: ${escapeHtml(inline.zkId)}">${escapeHtml(inline.target)}</a>`;
        }
        return `<span class="zk-link" title="zkId: ${escapeHtml(inline.zkId)}">${escapeHtml(inline.target)}</span>`;
      }
      case 'Image':
        // Résolution réelle via FSA = raffinement ultérieur (même
        // séquencement que zettelium-android, où le rendu d'image n'est
        // arrivé qu'au round 17, bien après la phase 3). Espace réservé textuel pour l'instant.
        return `<span class="t2t-image-placeholder">[image : ${escapeHtml(inline.path)}]</span>`;
      default:
        return '';
    }
  }

  function renderBlock(block, opts) {
    switch (block.type) {
      case 'Heading': {
        const level = Math.min(block.level, 6);
        return `<h${level}>${renderInlines(block.inlines, opts)}</h${level}>`;
      }
      case 'Paragraph':
        return `<p>${renderInlines(block.inlines, opts)}</p>`;
      case 'Comment':
        return ''; // jamais rendu
      case 'HorizontalRule':
        return '<hr>';
      case 'CodeBlock':
        return `<pre class="t2t-code">${escapeHtml(block.lines.join('\n'))}</pre>`;
      case 'ListNode': {
        const tag = block.ordered ? 'ol' : 'ul';
        return `<${tag}>${block.items.map(it => renderListItem(it, opts)).join('')}</${tag}>`;
      }
      case 'DefinitionList':
        return `<dl>${block.items.map(it =>
          `<dt>${renderInlines(it.term, opts)}</dt><dd>${renderInlines(it.description, opts)}</dd>`).join('')}</dl>`;
      case 'Table':
        return renderTable(block, opts);
      default:
        return '';
    }
  }

  function renderListItem(item, opts) {
    const childHtml = item.children.map(b => renderBlock(b, opts)).join('');
    return `<li>${renderInlines(item.inlines, opts)}${childHtml}</li>`;
  }

  function renderTable(table, opts) {
    const rows = table.rows.map(row => {
      const cellTag = row.isHeader ? 'th' : 'td';
      const cells = row.cells.map(c => `<${cellTag}>${renderInlines(c.inlines, opts)}</${cellTag}>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table>${rows}</table>`;
  }

  function renderAstToHtml(blocks, opts = {}) {
    return blocks.map(b => renderBlock(b, opts)).join('\n');
  }

  return { renderAstToHtml, escapeHtml };
})();
