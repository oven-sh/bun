// What ESLint's scope analysis says about each case, in the format of `bun-lint semantic dump --batch`.
//
//   ESLINT_DIR=<eslint checkout> TYPESCRIPT_ESLINT_DIR=<typescript-eslint checkout, built> bun dump.ts cases.jsonl > expected.jsonl
//
// A case is `{ id, filename, code, sourceType, ecmaVersion, jsx, globalReturn, impliedStrict, jsxPragma, jsxFragmentName }`.
// `.js`, `.jsx`, `.mjs`, `.cjs` go through espree and eslint-scope the way ESLint calls them, everything else through
// `@typescript-eslint/parser`.
//
// The model is normalized where `src/lint/semantic/mod.rs` documents a difference:
// - the second variable that a class declaration has inside its own scope is left out, and what refers to it refers to the first
// - a variable without a definition in the global scope (a lib type, `const` of `as const`) does not exist, so what refers to
//   it is unresolved, and the reference `const` of `as const` does not exist either
// - the block of the global, the module and the top-level function scope starts at 0

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const eslintDir = process.env.ESLINT_DIR;
const typescriptEslintDir = process.env.TYPESCRIPT_ESLINT_DIR;
if (!eslintDir || !typescriptEslintDir) throw new Error("set ESLINT_DIR and TYPESCRIPT_ESLINT_DIR");
const fromEslint = createRequire(join(eslintDir, "package.json"));
const espree = fromEslint("espree");
const eslintScope = fromEslint("eslint-scope");
const visitorKeys = fromEslint("eslint-visitor-keys");
const typescriptParser = fromEslint(join(typescriptEslintDir, "packages/parser/dist/index.js"));

type Case = {
  id: number | string;
  filename: string;
  code: string;
  sourceType?: "module" | "script" | "commonjs";
  ecmaVersion?: number | "latest";
  jsx?: boolean;
  globalReturn?: boolean;
  impliedStrict?: boolean;
  jsxPragma?: string | null;
  jsxFragmentName?: string | null;
};

function analyze(it: Case) {
  const sourceType = it.sourceType ?? "module";
  const globalReturn = it.globalReturn || sourceType === "commonjs";
  if (/\.[cm]?jsx?$/.test(it.filename)) {
    const ecmaVersion = typeof it.ecmaVersion === "number" ? it.ecmaVersion : espree.latestEcmaVersion;
    const ecmaFeatures = { jsx: it.jsx || /x$/.test(it.filename), globalReturn, impliedStrict: it.impliedStrict };
    const ast = espree.parse(it.code, { ecmaVersion, sourceType, ecmaFeatures, range: true });
    const scopeManager = eslintScope.analyze(ast, {
      ignoreEval: true,
      nodejsScope: ecmaFeatures.globalReturn,
      impliedStrict: ecmaFeatures.impliedStrict,
      ecmaVersion,
      sourceType,
      childVisitorKeys: visitorKeys.KEYS,
      fallback: visitorKeys.getKeys,
      jsx: ecmaFeatures.jsx,
    });
    return { ast, scopeManager, keys: visitorKeys.KEYS };
  }
  const options: Record<string, unknown> = {
    filePath: it.filename,
    sourceType,
    ecmaFeatures: { jsx: it.jsx, globalReturn },
  };
  if (it.jsxPragma !== undefined) options.jsxPragma = it.jsxPragma;
  if (it.jsxFragmentName !== undefined) options.jsxFragmentName = it.jsxFragmentName;
  const { ast, scopeManager, visitorKeys: keys } = typescriptParser.parseForESLint(it.code, options);
  return { ast, scopeManager, keys };
}

function setParents(ast: any, keys: Record<string, string[]>, visit: (node: any) => void) {
  const stack = [ast];
  ast.parent = null;
  while (stack.length) {
    const node = stack.pop();
    visit(node);
    for (const key of keys[node.type] ?? visitorKeys.getKeys(node)) {
      const child = node[key];
      for (const one of Array.isArray(child) ? child : [child]) {
        if (one && typeof one.type === "string") {
          one.parent = node;
          stack.push(one);
        }
      }
    }
  }
}

const startOf = (node: any) => (node.type === "Program" ? 0 : node.range[0]);
const scopeKey = (scope: any) => `${scope.type}@${startOf(scope.block)}`;

/// ESLint's `SourceCode#getScope`.
function getScope(scopeManager: any, currentNode: any) {
  const inner = currentNode.type !== "Program";
  for (let node = currentNode; node; node = node.parent) {
    const scope = scopeManager.acquire(node, inner);
    if (scope) return scope.type === "function-expression-name" ? scope.childScopes[0] : scope;
  }
  return scopeManager.scopes[0];
}

const isInnerClassName = (variable: any) =>
  variable.scope.type === "class" &&
  variable.scope.block.type === "ClassDeclaration" &&
  variable.defs.length > 0 &&
  variable.defs[0].type === "ClassName" &&
  variable.defs[0].node === variable.scope.block;

function variableKey(variable: any): string | number | null {
  if (isInnerClassName(variable)) variable = variable.scope.upper.set.get(variable.name) ?? variable;
  if (variable.defs.length > 0) return variable.defs[0].name.range[0];
  if (variable.scope.type === "function" && variable.name === "arguments")
    return `arguments@${startOf(variable.scope.block)}`;
  return null;
}

function dump(it: Case) {
  const { ast, scopeManager, keys } = analyze(it);
  const declared: unknown[] = [];
  setParents(ast, keys, node => {
    const variables = scopeManager.getDeclaredVariables(node).filter((v: any) => !isInnerClassName(v));
    // There are no nodes for these two.
    if (variables.length > 0 && node.type !== "ImportDefaultSpecifier" && node.type !== "ImportNamespaceSpecifier") {
      declared.push([startOf(node), variables.map(variableKey).sort().join()]);
    }
  });
  const scopes: unknown[] = [];
  const variables: unknown[] = [];
  const references: unknown[][] = [];
  for (const scope of scopeManager.scopes) {
    scopes.push([
      scope.type,
      startOf(scope.block),
      scope.block.range[1],
      scope.isStrict ? 1 : 0,
      scope.upper ? scopeKey(scope.upper) : null,
      scopeKey(scope.variableScope),
    ]);
    for (const variable of scope.variables) {
      if (isInnerClassName(variable)) continue;
      if (variable.defs.length === 0 && !(scope.type === "function" && variable.name === "arguments")) continue;
      variables.push([
        variable.name,
        scopeKey(scope),
        variable.defs.map((def: any) => def.name.range[0]),
        variable.defs.map((def: any) => def.type),
      ]);
    }
    for (const reference of scope.references) {
      const resolved = reference.resolved;
      if (reference.identifier.name === "const" && reference.isTypeReference && resolved?.defs.length === 0) continue;
      const isType = reference.isTypeReference ?? false;
      const isValue = reference.isValueReference ?? true;
      references.push([
        reference.identifier.range[0],
        reference.identifier.name,
        (reference.isRead() ? "r" : "") + (reference.isWrite() ? "w" : ""),
        (isValue ? "v" : "") + (isType ? "t" : ""),
        reference.init ? 1 : 0,
        resolved ? variableKey(resolved) : null,
        scopeKey(scope),
        reference.writeExpr ? reference.writeExpr.range[0] : null,
        scopeKey(getScope(scopeManager, reference.identifier)),
      ]);
    }
  }
  return { scopes, variables, references, declared };
}

for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const it: Case = JSON.parse(line);
  let result: object;
  try {
    result = dump(it);
  } catch (error) {
    result = { error: String((error as Error).message).split("\n")[0] };
  }
  console.log(JSON.stringify({ id: it.id, ...result }));
}
