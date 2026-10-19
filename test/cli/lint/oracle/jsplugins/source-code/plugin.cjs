"use strict";
// Asks `context.sourceCode` for everything that isn't a token method. record.mjs records what ESLint answers.

const say = f => {
  try {
    return f();
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
};
const at = node => (node ? `${node.type}[${node.range}]` : node);
const position = it => (typeof it === "object" ? `${it.line}:${it.column}` : it);
const place = loc => `${position(loc.start)}-${position(loc.end)}`;

// What only ESLint's `Linter` calls, which Bun doesn't have, and what ESLint had in earlier versions, which Bun still has.
const notInBoth = new Set([
  "applyLanguageOptions",
  "applyInlineConfig",
  "finalize",
  "traverse",
  "getParent",
  "getComments",
  "getJSDocComment",
  "isSpaceBetweenTokens",
  "getTokenOrCommentBefore",
  "getTokenOrCommentAfter",
]);

function nodesOf(sourceCode) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    for (const key of sourceCode.visitorKeys[node.type])
      for (const child of [node[key]].flat()) if (child) visit(child);
  };
  visit(sourceCode.ast);
  return nodes;
}

const all = {
  create: context => ({
    "Program:exit"(program) {
      const sourceCode = context.sourceCode;
      const { text, lines } = sourceCode;
      const nodes = nodesOf(sourceCode);
      const indices = Array.from({ length: text.length + 1 }, (_, index) => index);
      const last = lines.length;
      const directives = sourceCode.getDisableDirectives();
      const said = {
        text,
        layout: {
          keys: Object.keys(sourceCode),
          isFrozen: Object.isFrozen(sourceCode),
          hasBOM: Object.getOwnPropertyDescriptor(sourceCode, "hasBOM"),
          methods: Object.getOwnPropertyNames(Object.getPrototypeOf(sourceCode)).filter(name => !notInBoth.has(name)),
          classes: [sourceCode.constructor, Object.getPrototypeOf(sourceCode.constructor)].map(
            it => `${it.name}/${it.length}`,
          ),
          loc: [program.loc, program.loc.start].map(it => `${it.constructor.name} ${Object.keys(it)}`),
        },
        hasBOM: sourceCode.hasBOM,
        isESTree: sourceCode.isESTree,
        lines,
        lineStartIndices: sourceCode.lineStartIndices,
        splitLines: sourceCode.constructor.splitLines(text),
        same: [
          sourceCode.getText() === text,
          sourceCode.getText() === sourceCode.getText(),
          sourceCode.getLines() === lines,
          sourceCode.lines === lines,
          sourceCode.ast === program,
          sourceCode.getAllComments() === program.comments,
          sourceCode.getInlineConfigNodes() === sourceCode.getInlineConfigNodes(),
          sourceCode.getDisableDirectives() === directives,
          sourceCode.scopeManager === sourceCode.scopeManager,
          context.sourceCode === sourceCode,
        ],
        nodes: nodes.map(node => [
          at(node),
          place(node.loc),
          sourceCode.getLoc(node) === node.loc && sourceCode.getRange(node) === node.range,
          sourceCode.getText(node),
          sourceCode.getText(node, 2),
          sourceCode.getText(node, 0, 2),
          sourceCode.getText(node, -1, -1),
          sourceCode.getText(node, 1000, 1000),
          sourceCode.getAncestors(node).map(at).join(" "),
        ]),
        tokens: sourceCode.tokensAndComments.map(token => [at(token), place(token.loc), sourceCode.getText(token)]),
        locFromIndex: indices.map(index => position(sourceCode.getLocFromIndex(index))),
        roundTrip: indices.filter(index => sourceCode.getIndexFromLoc(sourceCode.getLocFromIndex(index)) !== index),
        nodeByRangeIndex: [-1, ...indices, text.length + 1].map(index => at(sourceCode.getNodeByRangeIndex(index))),
        badIndex: [-1, text.length + 1, 0.5, NaN, Infinity, "0", null, undefined, {}].map(index =>
          say(() => position(sourceCode.getLocFromIndex(index))),
        ),
        badLoc: [
          undefined,
          null,
          5,
          {},
          { line: 1 },
          { line: "1", column: 0 },
          { line: 1, column: "0" },
          { line: 0, column: 0 },
          { line: -1, column: 0 },
          { line: last + 1, column: 0 },
          { line: 1, column: -1 },
          { line: 1, column: lines[0].length + 2 },
          { line: 1, column: 1000 },
          { line: last, column: lines[last - 1].length },
          { line: last, column: lines[last - 1].length + 1 },
          { line: 1.5, column: 0 },
          { line: 1, column: 0.5 },
          { line: NaN, column: 0 },
          { line: Infinity, column: 0 },
        ].map(loc => String(say(() => sourceCode.getIndexFromLoc(loc)))),
        noNode: [
          say(() => sourceCode.getAncestors()),
          say(() => sourceCode.getScope()),
          say(() => sourceCode.isGlobalReference(null)),
        ],
        scopes: nodes.map(node => {
          const scope = sourceCode.getScope(node);
          return [
            `${scope.type}@${at(scope.block)}`,
            sourceCode.getScope(node) === scope,
            sourceCode
              .getDeclaredVariables(node)
              .map(it => it.name)
              .join(),
            sourceCode.isGlobalReference(node),
          ].join(" ");
        }),
        used: ["a", "f", "inner", "named", "undeclared", "Array"].map(name =>
          [
            name,
            sourceCode.markVariableAsUsed(name),
            ...nodes.map(node => Number(sourceCode.markVariableAsUsed(name, node))),
          ].join(" "),
        ),
        marked: sourceCode.scopeManager.scopes.map(scope =>
          scope.variables
            .filter(it => it.eslintUsed)
            .map(it => it.name)
            .join(),
        ),
        inlineConfigNodes: sourceCode.getInlineConfigNodes().map(at),
        problems: directives.problems.map(it => [it.ruleId, it.message, place(it.loc)]),
        directives: directives.directives.map(it => [it.type, at(it.node), it.value, it.justification]),
      };
      context.report({ node: program, message: JSON.stringify(said) });
    },
  }),
};

module.exports = {
  texts: {
    // A byte order mark, all five line breaks, and characters of one, two, three and four bytes before the nodes.
    "breaks.js":
      '﻿a;\r\n"é"; b;\r"€"; c; // \u{1F600}\n"\u{1F600}"; d; /* \u{1F600}\r\n */ "\u{1F600}\u{1F600}"; e; f(g, [h]);\n\r\n',
    "empty.js": "",
    "one-line.js": "function f(a) { return a + 1; }",
    "types.ts": "type A = { b: string };\nlet x: A | undefined = f<A>(y as A)!; // c\nenum E { a = 1 }\n",
    "scopes.js": [
      "import a, { b as c } from 'm';",
      "var f = function named(x) { let inner = x; { const inner = Array; } return named; };",
      "class C { static { var s; } m([p] = [], ...rest) { try { undeclared; } catch (e) { for (let i of p) i; } } }",
      "label: switch (a) { case 1: let d; }",
      "export default () => f;",
    ].join("\n"),
    "directives.js": [
      "/* eslint-disable no-undef, no-var -- because \u{1F600} */ a;",
      "/* eslint-enable */ // eslint-disable-line a -- b -- c",
      "// eslint-disable-next-line",
      "/* eslint-disable-line",
      " */ b; /* eslint-disable-next-line x */",
      "// eslint-disable",
      "/* eslint no-undef: 0 */ /* global a */ /* exported b */ /* eslint-env node */ /* eslint-disablex */ /* oxlint-disable */",
    ].join("\n"),
  },
  rules: { all },
};
