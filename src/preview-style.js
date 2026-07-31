'use strict';
// CSS par défaut de la prévisualisation (contenu de #ed-preview) — extrait
// ici comme source unique (round 25, demande explicite : "expose également
// le CSS utilisé pour la prévisualisation et permet de l'éditer à sa
// guise") plutôt que laissé en dur dans style.css, ce qui aurait dupliqué/
// fait diverger ce que Réglages affiche et injecte réellement.
//
// Exclut délibérément la règle STRUCTURELLE de #ed-preview elle-même
// (position/inset/overflow/padding/police — restée dans style.css, jamais
// exposée à l'édition) : casser ces règles casserait la mise en page de
// l'appli, hors du périmètre de "personnaliser l'apparence du rendu d'une
// note". Injecté par `applyPreviewCss()` (app.js) dans une balise <style>
// dédiée, éditable dans Réglages > Aperçu (settings.js), persisté dans
// `State.settings.previewCustomCss` (IndexedDB uniquement, voir state.js).
const PreviewStyle = (() => {
  const DEFAULT_CSS = `#ed-preview h1, #ed-preview h2, #ed-preview h3,
#ed-preview h4, #ed-preview h5, #ed-preview h6 { color: var(--heading); margin: 0.6em 0 0.3em; }
#ed-preview p { margin: 0.4em 0; }
#ed-preview code, #ed-preview .t2t-code { background: var(--bg-bar); color: var(--comment); }
#ed-preview .t2t-code { display: block; padding: 8px; overflow-x: auto; }
#ed-preview code { padding: 1px 4px; }
#ed-preview a { color: var(--markup); }
#ed-preview .zk-link { color: var(--markup); text-decoration: underline dotted; }
#ed-preview a.zk-link { cursor: pointer; }
#ed-preview .t2t-image-placeholder { color: var(--fg-bar); font-style: italic; }
#ed-preview table { border-collapse: collapse; margin: 0.4em 0; }
#ed-preview th, #ed-preview td { border: 1px solid var(--fg-bar); padding: 4px 8px; }
#ed-preview hr { border: none; border-top: 1px solid var(--fg-bar); margin: 1em 0; }
#ed-preview ul, #ed-preview ol { padding-left: 1.6em; margin: 0.4em 0; }
#ed-preview li { margin: 0.15em 0; }
#ed-preview li.t2t-checklist-item {
  list-style: none;
  margin-left: -1.6em;
  display: grid;
  grid-template-columns: 1.6em 1fr;
  align-items: baseline;
}
#ed-preview .t2t-checkbox { width: 15px; height: 15px; position: relative; top: 2px; cursor: pointer; justify-self: start; }
`;
  return { DEFAULT_CSS };
})();
