// The variables that ESLint and typescript-eslint put into the global scope of a file, against
// `File::global`; and the tables of the `globals` package.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node globals.mjs

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bunLint, random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const astUtils = requireFromEslint("./lib/rules/utils/ast-utils");
const environments = requireFromEslint("globals");
const requireTs = createRequire(join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"));
const typescriptParser = requireTs("@typescript-eslint/parser");

const tables = JSON.parse(execFileSync(bunLint, ["linter", "environments"], { maxBuffer: 1 << 28 }).toString());
const sorted = table => Object.fromEntries(Object.entries(table).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
const sameTables = isDeepStrictEqual(Object.keys(tables).sort(), Object.keys(environments).sort())
  && Object.keys(environments).every(name => JSON.stringify(sorted(environments[name])) === JSON.stringify(tables[name]));
console.log(`environments: ${sameTables ? "agree" : "DIFFER"}`);
if (!sameTables) process.exitCode = 1;

const rng = random(4);
const interesting = ["Array", "Map", "Promise", "ReadonlyMap", "Partial", "window", "document", "require", "module", "exports", "global",
  "globalThis", "BigInt", "WeakRef", "AggregateError", "Iterator", "Temporal", "SuppressedError", "constructor", "hasOwnProperty", "toString",
  "undefined", "NaN", "JSON", "Atomics", "SharedArrayBuffer", "Symbol", "Reflect", "Proxy", "const", "HTMLElement", "console", "process",
  "a", "b", "c", "foo", "é", "$", "Intl", "escape", "Float16Array", "FinalizationRegistry", "ClassDecoratorContext", "ImportMeta", "Awaited"];
const settings = [true, false, "writable", "writeable", "readonly", "readable", "off", "true", "false", null];
const libs = [undefined, undefined, ["es5"], ["es2015"], ["esnext"], ["dom"], ["es2018", "dom"], ["lib"], ["ES2020.Full"], ["es2015.collection", "es2015.iterable"],
  ["es2015.iterable", "es2015.collection"], ["webworker"], ["decorators"], []];
const comment = () => {
  const items = Array.from({ length: 1 + rng.int(4) }, () =>
    rng.pick(interesting) + rng.pick(["", "", ":writable", ": readonly", " :off", ":true", ":false", ":writeable", ":bogus", ":"]));
  return `/*${rng.pick(["", " ", "\n"])}${rng.pick(["global", "globals"])} ${items.join(rng.pick([", ", ",", " ", "\n"]))}${rng.pick(["", " -- why"])} */`;
};

const cases = [];
for (let i = 0; i < 4000; i++) {
  const typescript = rng.int(2) === 0;
  const globals = Object.fromEntries(Array.from({ length: rng.int(5) }, () => [rng.pick(interesting), rng.pick(settings)]));
  const lib = typescript ? rng.pick(libs) : undefined;
  const code = Array.from({ length: rng.int(4) }, () => rng.pick([comment(), comment(), "foo();", "// global a", "'/* global a */';"])).join(rng.pick([" ", "\n"]));
  cases.push({
    code,
    filename: typescript ? "file.ts" : "file.js",
    languageOptions: {
      ...(typescript ? { parser: "typescript" } : {}),
      ecmaVersion: rng.pick([3, 5, 6, 2015, 2017, 2020, 2021, 2025, 2026, "latest", "latest", 11]),
      sourceType: rng.pick(["module", "script", "commonjs"]),
      globals,
      ...(lib ? { parserOptions: { lib } } : {}),
    },
    names: interesting,
  });
}

const expected = cases.map(({ code, filename, languageOptions, names }) => {
  let answer;
  const probe = {
    create(context) {
      return {
        Program() {
          const { sourceCode } = context;
          const scope = sourceCode.scopeManager.globalScope;
          answer = names.map(name => {
            const variable = scope.set.get(name);
            if (!variable || variable.defs.length > 0) return null;
            const comments = variable.eslintExplicitGlobalComments ?? [];
            return {
              writeable: variable.writeable ?? false,
              implicit: variable.eslintImplicitGlobalSetting ?? null,
              comments: comments.map(it => Buffer.byteLength(code.slice(0, it.range[0]))),
              names: comments.map(it => {
                const loc = astUtils.getNameLocationInGlobalDirectiveComment(sourceCode, it, name);
                return [loc.start, loc.end].map(at => Buffer.byteLength(code.slice(0, sourceCode.getIndexFromLoc(at))));
              }),
              isType: variable.isTypeVariable ?? true,
              isValue: variable.isValueVariable ?? true,
            };
          });
        },
      };
    },
  };
  const messages = new Linter({ configType: "flat" }).verify(code, {
    files: ["**"],
    plugins: { test: { rules: { probe } } },
    rules: { "test/probe": 2 },
    languageOptions: { ...languageOptions, ...(languageOptions.parser ? { parser: typescriptParser } : {}) },
  }, filename);
  return answer ?? messages;
});
// One case for each name, so that what differs can be read.
const actual = runBunLint("globals", cases);
const flat = { cases: [], expected: [], actual: [] };
cases.forEach(({ names, ...rest }, i) => {
  if (!Array.isArray(expected[i]) || expected[i][0]?.fatal) return; // The generated code does not parse.
  names.forEach((name, j) => {
    flat.cases.push({ name, ...rest });
    flat.expected.push(expected[i][j]);
    flat.actual.push(actual[i][j]);
  });
});
report("globals", flat.cases, flat.expected, flat.actual, 8);
