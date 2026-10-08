// What typescript-eslint's `util/{explicitReturnTypeUtils,collectUnusedVariables,class-scope-analyzer}` say about
// the `code` of the conformance cases, to compare `bun-lint utils-tsscope batch` with.
//
//   TYPESCRIPT_ESLINT=<checkout, built> bun oracle.ts <test/cli/lint/conformance/fixtures> <out directory> [rule..]
//   TYPESCRIPT_ESLINT=<checkout, built> bun oracle.ts --files <out directory> <directory of sources>..
//
// Writes `cases.jsonl` (the input of `bun-lint utils-tsscope batch`) and `expected.jsonl`. Only ASCII code, so that
// offsets in UTF-16 code units are offsets in bytes. With rule names, only the cases of those rules.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.TYPESCRIPT_ESLINT!;
const { SourceCode } = require(join(root, "node_modules/eslint"));
const parser = require(join(root, "packages/parser/dist/index.js"));
const util = (name: string) => require(join(root, "packages/eslint-plugin/dist/util", name));
const returnTypes = util("explicitReturnTypeUtils.js");
const { collectVariables } = util("collectUnusedVariables.js");
const { analyzeClassMemberUsage } = util("class-scope-analyzer/classScopeAnalyzer.js");
const { simpleTraverse } = require(join(root, "packages/typescript-estree/dist/index.js"));

const [fixtures, out, ...rules] = process.argv.slice(2);
const rows = (all: unknown[][]) => all.map(it => JSON.stringify(it)).sort();
const bits = (all: boolean[]) => all.reduce((sum, bit, i) => sum + (Number(bit) << i), 0);

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
  sourceCode.applyLanguageOptions({ sourceType: it.sourceType, globals: {}, parserOptions: it.parserOptions });
  sourceCode.applyInlineConfig();
  sourceCode.finalize();

  const returnsOf = new Map<object, object[]>();
  const functions: any[] = [];
  const isFunction = (node: any) =>
    node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration";
  simpleTraverse(
    parsed.ast,
    {
      enter(node: any) {
        if (isFunction(node)) {
          functions.push(node);
          returnsOf.set(node, []);
        } else if (node.type === "ReturnStatement") {
          let owner = node.parent;
          while (owner && !isFunction(owner)) owner = owner.parent;
          returnsOf.get(owner)?.push(node);
        }
      },
    },
    true,
  );
  const functionRows = functions.map(node => {
    const info = { node, returns: returnsOf.get(node) };
    const isExpression = node.type !== "FunctionDeclaration";
    let head: any = null;
    returnTypes.checkFunctionReturnType(info, {}, sourceCode, (loc: any) => (head = loc));
    let higherOrder = false;
    returnTypes.checkFunctionReturnType(info, { allowHigherOrderFunctions: true }, sourceCode, () => (higherOrder = true));
    const valid = (options: object) => isExpression && returnTypes.isValidFunctionExpressionReturnType(node, options);
    return [
      ...node.range,
      bits([
        returnTypes.doesImmediatelyReturnFunctionExpression(info),
        isExpression && returnTypes.isTypedFunctionExpression(node, { allowTypedFunctionExpressions: true }),
        valid({ allowTypedFunctionExpressions: true }),
        valid({ allowExpressions: true }),
        valid({ allowDirectConstAssertionInArrowFunctions: true }),
        returnTypes.ancestorHasReturnType(node),
        head != null,
        higherOrder,
      ]),
      head ? sourceCode.getIndexFromLoc(head.start) : -1,
      head ? sourceCode.getIndexFromLoc(head.end) : -1,
    ];
  });

  const analysis = collectVariables({ sourceCode });
  const variables = (all: Set<any>) =>
    rows(
      [...all]
        .filter(it => it.defs.length > 0)
        .map(it => [it.defs[0].name.range[0], Number(it.scope.type === "class" && it.defs[0].type === "ClassName"), it.name]),
    );

  const members: unknown[][] = [];
  for (const scope of analyzeClassMemberUsage(parsed.ast, parsed.scopeManager).values()) {
    for (const member of [...scope.members.instance.values(), ...scope.members.static.values()]) {
      members.push([
        ...member.nameNode.range,
        member.readCount,
        member.writeCount,
        bits([!!member.isStatic(), member.isPrivate(), member.isHashPrivate(), member.isAccessor(), member.isUsed()]),
        member.name,
      ]);
    }
  }
  return {
    functions: rows(functionRows),
    unused: variables(analysis.unusedVariables),
    used: variables(analysis.usedVariables),
    members: rows(members),
  };
}

type Case = Parameters<typeof analyze>[0];
const seen = new Set<string>();
const cases: string[] = [];
const expected: string[] = [];
function add(rule: string, one: Case) {
  const key = JSON.stringify(one);
  if (seen.has(key) || !/^[\x00-\x7f]*$/.test(one.code)) return;
  seen.add(key);
  let result;
  try {
    result = analyze(one);
  } catch {
    return;
  }
  const id = cases.length;
  const languageOptions = { parser: "typescript", sourceType: one.sourceType, parserOptions: one.parserOptions };
  cases.push(JSON.stringify({ id, rule, filename: one.filename, code: one.code, languageOptions }));
  const list = (all: string[]) => `[${all.join(",")}]`;
  expected.push(
    `{"id":${id},"functions":${list(result.functions)},"unused":${list(result.unused)},"used":${list(result.used)},"members":${list(result.members)}}`,
  );
}

function* walk(path: string): Generator<string> {
  if (!statSync(path).isDirectory()) return yield path;
  for (const name of readdirSync(path).sort()) {
    if (name !== "node_modules" && name !== ".git") yield* walk(join(path, name));
  }
}

if (fixtures === "--files") {
  for (const file of rules.flatMap(it => [...walk(it)])) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const jsx = /x$/.test(file);
    add(file, { filename: file.replace(/^.*\//, ""), code: readFileSync(file, "utf8"), sourceType: "module", parserOptions: { ecmaFeatures: { jsx } } });
  }
} else {
  for (const plugin of ["eslint", "typescript-eslint"]) {
    for (const file of readdirSync(join(fixtures, plugin)).sort()) {
      if (!file.endsWith(".json") || (rules.length && !rules.includes(file.slice(0, -5)))) continue;
      for (const it of JSON.parse(readFileSync(join(fixtures, plugin, file), "utf8")).cases ?? []) {
        const language = it.languageOptions ?? {};
        const parserOptions = language.parserOptions ?? {};
        if (it.skip) continue;
        add(file.slice(0, -5), {
          filename: language.parser === "typescript" ? it.filename.replace(/^.*\//, "") : parserOptions.ecmaFeatures?.jsx ? "file.jsx" : "file.js",
          code: it.code,
          sourceType: parserOptions.sourceType ?? language.sourceType ?? "module",
          parserOptions: { ecmaFeatures: parserOptions.ecmaFeatures, jsxPragma: parserOptions.jsxPragma, jsxFragmentName: parserOptions.jsxFragmentName },
        });
      }
    }
  }
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "cases.jsonl"), cases.join("\n") + "\n");
writeFileSync(join(out, "expected.jsonl"), expected.join("\n") + "\n");
console.log(`${cases.length} cases`);
