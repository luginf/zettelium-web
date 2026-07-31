'use strict';
// Évaluation d'expressions dans le menu contextuel — porté depuis
// zettelium-android's `ui/SExprEval.kt`/`RpnEval.kt`/`InfixEval.kt`/
// `MathExprEval.kt` (rounds 30/31/33). Trois notations, autodétectées sans
// ambiguïté par MathExprEval selon la FORME de la sélection (jamais un
// choix utilisateur) :
//  - préfixe façon Lisp (SExprEval, ex. `(+ 1 2)`) — port direct de
//    `~/src/scite/sexpr_eval.lua` côté Android ;
//  - RPN/Forth (RpnEval, ex. `34 12 -`) ;
//  - infixe façon calculatrice (InfixEval, ex. `34-12=`) — le `=` final est
//    OBLIGATOIRE, seul signal qui distingue cette forme du RPN.
//
// Différence délibérée avec le Kotlin d'origine (mêmes raisons que
// editor-formatting.js) : pas de sealed class `Result` — chaque évaluateur
// renvoie `{ok: true, resultText}` ou `{ok: false, message}`, un objet JS
// simple plutôt qu'un type scellé qui n'a pas d'équivalent léger ici.
const SExprEval = (() => {
  class EvalError extends Error {}

  // Kotlin's Double.mod(other) a le signe du DIVISEUR (comme Python), pas
  // celui du dividende comme l'opérateur `%` de JS — reconstruit via la
  // formule a - floor(a/b)*b plutôt que de réutiliser `%` directement.
  function pyMod(a, b) { return a - Math.floor(a / b) * b; }

  function requireArity(args, expected, name) {
    if (args.length !== expected) {
      throw new EvalError(`${name} attend ${expected} argument(s), ${args.length} reçu(s)`);
    }
  }

  const FUNCTIONS = {
    '+': args => args.reduce((a, b) => a + b, 0),
    '*': args => args.reduce((a, b) => a * b, 1),
    '-': args => {
      if (args.length === 0) throw new EvalError('- attend au moins un argument');
      if (args.length === 1) return -args[0];
      return args.slice(1).reduce((acc, v) => acc - v, args[0]);
    },
    '/': args => {
      if (args.length === 0) throw new EvalError('/ attend au moins un argument');
      if (args.length === 1) return 1 / args[0];
      return args.slice(1).reduce((acc, v) => acc / v, args[0]);
    },
    mod: args => { requireArity(args, 2, 'mod'); return pyMod(args[0], args[1]); },
    min: args => {
      if (!args.length) throw new EvalError('min attend au moins un argument');
      return Math.min(...args);
    },
    max: args => {
      if (!args.length) throw new EvalError('max attend au moins un argument');
      return Math.max(...args);
    },
    abs: args => { requireArity(args, 1, 'abs'); return Math.abs(args[0]); },
    sqrt: args => { requireArity(args, 1, 'sqrt'); return Math.sqrt(args[0]); },
    expt: args => { requireArity(args, 2, 'expt'); return Math.pow(args[0], args[1]); },
    floor: args => { requireArity(args, 1, 'floor'); return Math.floor(args[0]); },
    ceil: args => { requireArity(args, 1, 'ceil'); return Math.ceil(args[0]); },
  };

  // Validation stricte par regex avant `parseFloat` — `parseFloat('3a')`
  // vaut silencieusement 3 en JS (contrairement à Kotlin's toDoubleOrNull,
  // qui rejette toute la chaîne), un piège pour un tokenizer qui doit
  // distinguer un nombre d'un symbole.
  function parseNum(tok) {
    return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(tok) ? parseFloat(tok) : null;
  }

  function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')') { tokens.push(c); i++; continue; }
      let j = i;
      while (j < text.length && !/\s/.test(text[j]) && text[j] !== '(' && text[j] !== ')') j++;
      tokens.push(text.slice(i, j));
      i = j;
    }
    return tokens;
  }

  function evalNode(node) {
    if (node.type === 'num') return node.value;
    if (node.type === 'sym') throw new EvalError(`élément non évaluable : ${node.name}`);
    if (node.items.length === 0) throw new EvalError('liste vide non évaluable');
    const head = node.items[0];
    if (head.type !== 'sym') throw new EvalError('fonction attendue en tête de liste');
    const fn = FUNCTIONS[head.name];
    if (!fn) throw new EvalError(`fonction inconnue : ${head.name}`);
    return fn(node.items.slice(1).map(evalNode));
  }

  /** Partagé avec RpnEval/InfixEval pour un formatage identique quelle que soit la notation. */
  function formatNumber(n) {
    return (n === Math.floor(n) && Math.abs(n) < 1e15) ? String(Math.trunc(n)) : String(n);
  }

  function evaluate(rawExpression) {
    const text = rawExpression.trim();
    if (!text) return { ok: false, message: 'sélection vide' };
    try {
      const tokens = tokenize(text);
      let pos = 0;
      function parseExpr() {
        const tok = tokens[pos];
        if (tok === undefined) throw new EvalError('expression incomplète');
        if (tok === '(') {
          pos++;
          const items = [];
          while (tokens[pos] !== ')') {
            if (pos >= tokens.length) throw new EvalError('parenthèse fermante manquante');
            items.push(parseExpr());
          }
          pos++; // consomme ")"
          return { type: 'list', items };
        }
        if (tok === ')') throw new EvalError('parenthèse fermante inattendue');
        pos++;
        const num = parseNum(tok);
        return num !== null ? { type: 'num', value: num } : { type: 'sym', name: tok };
      }
      const expr = parseExpr();
      if (pos !== tokens.length) throw new EvalError("caractères en trop après l'expression");
      return { ok: true, resultText: formatNumber(evalNode(expr)) };
    } catch (e) {
      return { ok: false, message: e.message || "erreur d'évaluation" };
    }
  }

  return { evaluate, formatNumber, pyMod, parseNum };
})();

const RpnEval = (() => {
  class EvalError extends Error {}

  const BINARY_OPS = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => a / b,
    mod: (a, b) => SExprEval.pyMod(a, b),
    min: (a, b) => Math.min(a, b),
    max: (a, b) => Math.max(a, b),
    expt: (a, b) => Math.pow(a, b),
  };
  const UNARY_OPS = { abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil };

  function evaluate(rawExpression) {
    const text = rawExpression.trim();
    if (!text) return { ok: false, message: 'sélection vide' };
    try {
      const stack = [];
      for (const tok of text.split(/\s+/)) {
        const num = SExprEval.parseNum(tok);
        if (num !== null) {
          stack.push(num);
        } else if (Object.prototype.hasOwnProperty.call(BINARY_OPS, tok)) {
          if (stack.length < 2) throw new EvalError(`${tok} attend deux opérandes sur la pile`);
          const b = stack.pop();
          const a = stack.pop();
          stack.push(BINARY_OPS[tok](a, b));
        } else if (Object.prototype.hasOwnProperty.call(UNARY_OPS, tok)) {
          if (stack.length < 1) throw new EvalError(`${tok} attend un opérande sur la pile`);
          stack.push(UNARY_OPS[tok](stack.pop()));
        } else {
          throw new EvalError(`jeton inconnu : ${tok}`);
        }
      }
      if (stack.length !== 1) {
        throw new EvalError(`expression incomplète (${stack.length} élément(s) restant(s) sur la pile)`);
      }
      return { ok: true, resultText: SExprEval.formatNumber(stack[stack.length - 1]) };
    } catch (e) {
      return { ok: false, message: e.message || "erreur d'évaluation" };
    }
  }

  return { evaluate };
})();

const InfixEval = (() => {
  class EvalError extends Error {}

  function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      if ('()+-*/^'.includes(c)) { tokens.push(c); i++; continue; }
      let j = i;
      while (j < text.length && /[0-9.A-Za-z]/.test(text[j])) j++;
      if (j === i) throw new EvalError(`caractère inattendu : ${text[i]}`);
      tokens.push(text.slice(i, j));
      i = j;
    }
    return tokens;
  }

  function evaluate(rawExpression) {
    const trimmed = rawExpression.trim();
    if (!trimmed.endsWith('=')) {
      return { ok: false, message: "notation infixe : '=' final requis" };
    }
    const text = trimmed.slice(0, -1).trim();
    if (!text) return { ok: false, message: 'sélection vide' };
    try {
      const tokens = tokenize(text);
      let pos = 0;
      const peek = () => tokens[pos];

      function parseAtom() {
        const tok = peek();
        if (tok === '(') {
          pos++;
          const value = parseExpr();
          if (peek() !== ')') throw new EvalError('parenthèse fermante manquante');
          pos++;
          return value;
        }
        if (tok === undefined) throw new EvalError('expression incomplète');
        pos++;
        const num = SExprEval.parseNum(tok);
        if (num === null) throw new EvalError(`nombre attendu : ${tok}`);
        return num;
      }
      function parseUnary() {
        if (peek() === '-') { pos++; return -parseUnary(); }
        if (peek() === '+') { pos++; return parseUnary(); }
        return parseAtom();
      }
      function parsePower() {
        const base = parseUnary();
        if (peek() === '^') { pos++; return Math.pow(base, parsePower()); }
        return base;
      }
      function parseTerm() {
        let value = parsePower();
        while (peek() === '*' || peek() === '/' || peek() === 'mod') {
          const op = tokens[pos]; pos++;
          const rhs = parsePower();
          value = op === '*' ? value * rhs : op === '/' ? value / rhs : SExprEval.pyMod(value, rhs);
        }
        return value;
      }
      function parseExpr() {
        let value = parseTerm();
        while (peek() === '+' || peek() === '-') {
          const op = tokens[pos]; pos++;
          const rhs = parseTerm();
          value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
      }

      const result = parseExpr();
      if (pos !== tokens.length) throw new EvalError("caractères en trop après l'expression");
      return { ok: true, resultText: SExprEval.formatNumber(result) };
    } catch (e) {
      return { ok: false, message: e.message || "erreur d'évaluation" };
    }
  }

  return { evaluate };
})();

/**
 * Point d'entrée unique appelé depuis le menu contextuel de l'éditeur —
 * choisit la notation d'après la FORME de la sélection, sans ambiguïté
 * possible : "=" final -> infixe ; sinon "(" en tête -> préfixe Lisp ;
 * sinon -> RPN. `formatResult` réutilise la MÊME classification pour
 * décider comment insérer le résultat — un seul point de vérité.
 */
const MathExprEval = (() => {
  function notationOf(expression) {
    const trimmed = expression.trim();
    if (trimmed.endsWith('=')) return 'infix';
    if (trimmed.startsWith('(')) return 'prefix';
    return 'rpn';
  }

  function evaluate(rawExpression) {
    const trimmed = rawExpression.trim();
    switch (notationOf(trimmed)) {
      case 'infix': return InfixEval.evaluate(trimmed);
      case 'prefix': return SExprEval.evaluate(trimmed);
      default: return RpnEval.evaluate(trimmed);
    }
  }

  /**
   * Texte de remplacement de la sélection après une évaluation réussie —
   * mise en forme différenciée par notation (round 33, retour utilisateur) :
   * infixe (le "=" fait déjà partie de `expression`) -> résultat ajouté à
   * droite après un espace ; RPN -> résultat sur une nouvelle ligne, sans
   * "=" (lecture d'une pile Forth, pas une égalité algébrique) ; préfixe
   * Lisp -> `expression = résultat` sur la même ligne (comportement
   * historique, round 30).
   */
  function formatResult(expression, result) {
    switch (notationOf(expression)) {
      case 'infix': return `${expression} ${result.resultText}`;
      case 'prefix': return `${expression} = ${result.resultText}`;
      default: return `${expression}\n${result.resultText}`;
    }
  }

  return { evaluate, formatResult };
})();
