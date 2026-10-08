// What typescript-eslint's syntactic `util/` functions say about every node of the `code` of the conformance cases,
// to compare `bun-lint utils-ts batch` with.
//
//   TYPESCRIPT_ESLINT=<checkout, built> bun oracle.ts <test/cli/lint/conformance/fixtures> <out directory> [rule..]
//
// Writes `cases.jsonl` (the input of `bun-lint utils-ts batch`) and `expected.jsonl`. A line of the latter is
// `{ id, rows: [[function, start, end, result], ..] }`, where `start` and `end` are the range of the node. Only ASCII code,
// so that offsets in UTF-16 code units are offsets in bytes. With rule names, only the cases of those rules.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.TYPESCRIPT_ESLINT!;
const { SourceCode } = require(join(root, "node_modules/eslint"));
const ts = require(join(root, "node_modules/typescript"));
const parser = require(join(root, "packages/parser/dist/index.js"));
const util = require(join(root, "packages/eslint-plugin/dist/util/index.js"));
const only = (name: string) => require(join(root, "packages/eslint-plugin/dist/util", name));
const { getMemberHeadLoc, getParameterPropertyHeadLoc } = only("getMemberHeadLoc.js");
const { getForStatementHeadLoc } = only("getForStatementHeadLoc.js");
const { getParentFunctionNode } = only("getParentFunctionNode.js");
const { isTypeImport } = only("isTypeImport.js");
const { simpleTraverse } = require(join(root, "packages/typescript-estree/dist/index.js"));

const [fixtures, out, ...rules] = process.argv.slice(2);

const EXPRESSIONS = new Set(
  `ArrayExpression ArrowFunctionExpression AssignmentExpression AwaitExpression BinaryExpression CallExpression
  ChainExpression ClassExpression ConditionalExpression FunctionExpression Identifier ImportExpression JSXElement
  JSXFragment Literal LogicalExpression MemberExpression MetaProperty NewExpression ObjectExpression SequenceExpression
  Super TaggedTemplateExpression TemplateLiteral ThisExpression TSAsExpression TSInstantiationExpression
  TSNonNullExpression TSSatisfiesExpression TSTypeAssertion UnaryExpression UpdateExpression YieldExpression`.split(/\s+/),
);
const MEMBERS = new Set(
  `AccessorProperty MethodDefinition PropertyDefinition TSAbstractAccessorProperty TSAbstractMethodDefinition
  TSAbstractPropertyDefinition TSMethodSignature TSPropertySignature`.split(/\s+/),
);
const CLASS_MEMBERS = new Set([...MEMBERS].filter(it => !it.endsWith("Signature")));
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionDeclaration", "FunctionExpression"]);
const fixer = { replaceText: (node: any, text: string) => [...node.range, text] };
const add = (code: string) => `${code} + 1`;
const array = (code: string) => `[${code}]`;
const pair = (a: string, b: string) => `(${a}, ${b})`;
const hasRegex = (node: any): boolean =>
  node.type === "MemberExpression" ? hasRegex(node.object) || hasRegex(node.property) : node.regex != null;
const key = (value: unknown) => (typeof value === "symbol" ? `@@${value.description}` : (value ?? null));

function analyze(it: { filename: string; code: string; sourceType: string; parserOptions: object }) {
  const parsed = parser.parseForESLint(it.code, {
    ...it.parserOptions,
    sourceType: it.sourceType,
    filePath: "/" + it.filename,
    loc: true,
    range: true,
    tokens: true,
    comment: true,
  });
  const sourceCode = new SourceCode({ text: it.code, ...parsed, parserServices: parsed.services });
  sourceCode.applyLanguageOptions({ ecmaVersion: 2025, sourceType: it.sourceType, globals: {}, parserOptions: it.parserOptions });
  sourceCode.applyInlineConfig();
  sourceCode.finalize();
  const context = { sourceCode };
  const rows: string[] = [];
  const loc = (it: any) => [sourceCode.getIndexFromLoc(it.start), sourceCode.getIndexFromLoc(it.end)];

  function visit(node: any) {
    const row = (name: string, result: () => unknown) => {
      let value;
      try {
        value = result();
      } catch {
        return;
      }
      rows.push(JSON.stringify([name, ...node.range, value ?? null]));
    };
    const parent = node.parent;
    if (EXPRESSIONS.has(node.type)) {
      const first = sourceCode.getFirstToken(node);
      // What has one `Expr` here: the `ChainExpression`, or the element in it.
      if (parent?.type !== "ChainExpression") {
        row("getOperatorPrecedenceForNode", () => util.getOperatorPrecedenceForNode(node));
        row("isStrongPrecedenceNode", () => util.isStrongPrecedenceNode(node));
        row("isWeakPrecedenceParent", () => util.isWeakPrecedenceParent(node));
        row("isConditionalTest", () => util.isConditionalTest(node));
        // A regular expression is equal to itself only.
        if (!hasRegex(node)) row("isNodeEqual", () => util.isNodeEqual(node, node));
        row("getMovedNodeCode", () => util.getMovedNodeCode({ destinationNode: node, nodeToMove: node, sourceCode }));
        row("getWrappingFixer:add", () => util.getWrappingFixer({ node, sourceCode, wrap: add })(fixer));
        row("getWrappingFixer:array", () => util.getWrappingFixer({ node, sourceCode, wrap: array })(fixer));
        row("getWrappingFixer:none", () => util.getWrappingFixer({ node, sourceCode })(fixer));
        const tsNode = parsed.services.esTreeNodeToTSNodeMap.get(node);
        const precedence = (of: any) =>
          util.getOperatorPrecedence(
            of.kind,
            ts.isBinaryExpression(of) ? of.operatorToken.kind : ts.SyntaxKind.Unknown,
            ts.isNewExpression(of) ? of.arguments != null && of.arguments.length > 0 : undefined,
          );
        row("getOperatorPrecedence", () => precedence(tsNode));
        row("getOperatorPrecedence(parent)", () => precedence(tsNode.parent));
        row("isHigherPrecedenceThanAwait", () => util.isHigherPrecedenceThanAwait(tsNode));
      }
      if (node.type !== "ChainExpression") {
        row("isAssignee", () => util.isAssignee(node));
        row("getWrappingFixer(element):add", () => util.getWrappingFixer({ node, sourceCode, wrap: add })(fixer));
        row("getWrappingFixer(element):array", () => util.getWrappingFixer({ node, sourceCode, wrap: array })(fixer));
        if (EXPRESSIONS.has(parent?.type) && parent.type !== "ChainExpression") {
          row("getWrappingFixer(parent)", () => util.getWrappingFixer({ node: parent, innerNode: [node, node], sourceCode, wrap: pair })(fixer));
        }
        if (node.type === "MemberExpression") {
          row("getStaticMemberAccessValue", () => key(util.getStaticMemberAccessValue(node, context)));
        }
        if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
          row("isNodeEqual(left, right)", () => util.isNodeEqual(node.left, node.right));
        }
      }
      row("isStartOfExpressionStatement", () => util.isStartOfExpressionStatement(node));
      row("isStartOfExpressionStatementNeedingParentheses", () => util.isStartOfExpressionStatementNeedingParentheses(node, first));
      row("isStartOfArrowFunctionBodyNeedingParentheses", () =>
        util.isStartOfArrowFunctionBodyNeedingParentheses(node, first, sourceCode),
      );
      row("needsPrecedingSemicolon", () => util.needsPrecedingSemicolon(sourceCode, node));
      row("getThisExpression", () => util.getThisExpression(node)?.range);
      row("getTextWithParentheses", () => util.getTextWithParentheses(sourceCode, node));
      row("getStaticStringValue", () => util.getStaticStringValue(node));
      row("getParentFunctionNode", () => getParentFunctionNode(node)?.range);
      row("predicates", () => [
        util.isNullLiteral(node),
        util.isUndefinedIdentifier(node),
        util.isOptionalCallExpression(node),
        util.isLogicalOrOperator(node),
        util.isTypeAssertion(node),
        util.isAwaitExpression(node),
      ]);
      if (node.type === "Literal" && typeof node.value === "string") {
        row("getStringLength", () => util.getStringLength(node.value));
        row("requiresQuoting", () => util.requiresQuoting(node.value));
        row("isDefinitionFile", () => util.isDefinitionFile(node.value));
      }
    }
    if (MEMBERS.has(node.type) || (node.type === "Property" && parent.type === "ObjectExpression")) {
      row("getNameFromMember", () => Object.values(util.getNameFromMember(node, sourceCode)));
      if (!node.type.endsWith("Signature")) {
        row("getStaticMemberAccessValue(member)", () => key(util.getStaticMemberAccessValue(node, context)));
      }
      row("isSetter", () => util.isSetter(node));
    }
    if (CLASS_MEMBERS.has(node.type)) {
      row("getMemberHeadLoc", () => loc(getMemberHeadLoc(sourceCode, node)));
      row("isConstructor", () => util.isConstructor(node));
      row("needsPrecedingSemicolon(member)", () => util.needsPrecedingSemicolon(sourceCode, node));
    }
    if (node.type === "MethodDefinition" || node.type === "FunctionDeclaration") {
      row("hasOverloadSignatures", () => util.hasOverloadSignatures(node, context));
    }
    if (FUNCTIONS.has(node.type)) {
      row("getFunctionHeadLoc", () => loc(util.getFunctionHeadLoc(node, sourceCode)));
      if (node.type === "ArrowFunctionExpression") {
        row("isParenlessArrowFunction", () => util.isParenlessArrowFunction(node, sourceCode));
      }
      if (node.body.type === "BlockStatement") {
        row("walkStatements", () => [...util.walkStatements(node.body.body)].map(it => it.range[0]));
      }
    }
    if (util.isFunctionOrFunctionType(node)) {
      row("isFunctionType", () => [util.isFunction(node), util.isFunctionType(node), util.isTSFunctionType(node), util.isTSConstructorType(node)]);
    }
    if (node.type === "TSParameterProperty") {
      const name = node.parameter.type === "AssignmentPattern" ? node.parameter.left.name : node.parameter.name;
      row("getParameterPropertyHeadLoc", () => loc(getParameterPropertyHeadLoc(sourceCode, node, name)));
    }
    if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      row("getForStatementHeadLoc", () => loc(getForStatementHeadLoc(sourceCode, node)));
    }
    if (node.type === "TSIndexSignature") {
      row("getNameFromIndexSignature", () => util.getNameFromIndexSignature(node));
    }
    if ((parent?.type === "TSUnionType" || parent?.type === "TSIntersectionType") && parent.types.includes(node)) {
      row("typeNodeRequiresParentheses", () => util.typeNodeRequiresParentheses(node, sourceCode.getText(node)));
    }
  }
  // Once for the `parent` of every node.
  simpleTraverse(parsed.ast, { enter() {} }, true);
  simpleTraverse(parsed.ast, { enter: visit }, false);

  for (const scope of parsed.scopeManager.scopes) {
    for (const variable of scope.variables) {
      for (const def of variable.defs) {
        if (def.type === "ImportBinding") {
          rows.push(JSON.stringify(["isTypeImport", ...def.name.range, isTypeImport(def)]));
        }
      }
    }
  }
  return rows;
}

const seen = new Set<string>();
const cases: string[] = [];
const expected: string[] = [];
for (const plugin of ["eslint", "typescript-eslint"]) {
  for (const file of readdirSync(join(fixtures, plugin)).sort()) {
    if (!file.endsWith(".json") || (rules.length && !rules.includes(file.slice(0, -5)))) continue;
    for (const it of JSON.parse(readFileSync(join(fixtures, plugin, file), "utf8")).cases ?? []) {
      const language = it.languageOptions ?? {};
      const parserOptions = language.parserOptions ?? {};
      if (it.skip || !/^[\x00-\x7f]*$/.test(it.code)) continue;
      const one = {
        filename: language.parser === "typescript" ? it.filename.replace(/^.*\//, "") : parserOptions.ecmaFeatures?.jsx ? "file.jsx" : "file.js",
        code: it.code,
        sourceType: parserOptions.sourceType ?? language.sourceType ?? "module",
        parserOptions: { ecmaFeatures: parserOptions.ecmaFeatures },
      };
      const identity = JSON.stringify(one);
      if (seen.has(identity)) continue;
      seen.add(identity);
      let rows;
      try {
        rows = analyze(one);
      } catch {
        continue;
      }
      const id = cases.length;
      cases.push(JSON.stringify({ id, rule: file.slice(0, -5), ...one }));
      expected.push(`{"id":${id},"rows":[${rows.join(",")}]}`);
    }
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "cases.jsonl"), cases.join("\n") + "\n");
writeFileSync(join(out, "expected.jsonl"), expected.join("\n") + "\n");
console.log(`${cases.length} cases`);
