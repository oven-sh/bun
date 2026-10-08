// The message for a file that cannot be parsed: ESLint with @typescript-eslint/parser and with espree against `Linter::lint`, on
// code of the conformance fixtures that is damaged.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node parse-errors.mjs <conformance fixtures> [<how many differences to show>]

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const requireTs = createRequire(
  join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"),
);
const parser = requireTs("@typescript-eslint/parser");
const linter = new Linter({ configType: "flat" });
const junk = [
  ..."(){}[]<>;,.:=+*/'\"`@#!?&|",
  " class ",
  " function ",
  " = ",
  "=>",
  " import ",
  " const ",
  "...",
  " as ",
  "\n",
];
const brief = messages =>
  messages.filter(it => it.fatal).map(({ message, line, column }) => ({ message, line, column }));

/** `plugin`: the directory of the fixtures. `languages`: one of them is picked for each case: for ESLint, and for `bun-lint`. */
function run(name, plugin, filename, languages) {
  const rng = random(12);
  const codes = [];
  const fixtures = join(resolve(process.argv[2]), plugin);
  for (const file of readdirSync(fixtures)) {
    for (const it of JSON.parse(readFileSync(join(fixtures, file), "utf8")).cases) {
      if (!it.skip && it.filename.endsWith(filename.slice(4)) && it.code.length < 400 && rng.int(6) === 0)
        codes.push(it.code);
    }
  }
  const cases = [];
  const expected = [];
  for (const code of codes) {
    const units = [...code];
    const at = rng.int(units.length + 1);
    if (rng.int(2) === 0) units.splice(at, 1 + rng.int(3));
    else units.splice(at, 0, rng.pick(junk));
    const [forEslint, forBunLint] = rng.pick(languages);
    cases.push({ code: units.join(""), filename, config: { rules: {}, languageOptions: forBunLint }, options: {} });
    expected.push(brief(linter.verify(units.join(""), { files: ["**"], languageOptions: forEslint }, filename)));
  }
  compare(name, cases, expected);
}

function compare(name, cases, expected) {
  const actual = runBunLint("verify", cases).map(it => brief(it.messages));
  const rejected = expected.filter(it => it.length > 0).length;
  const sameVerdict = expected.filter((it, i) => it.length > 0 === actual[i].length > 0).length;
  const samePlace = expected.filter(
    (it, i) => it[0]?.line === actual[i][0]?.line && it[0]?.column === actual[i][0]?.column,
  ).length;
  console.log(
    `${name}: rejects ${rejected} of ${cases.length}; the same verdict for ${sameVerdict}, the same verdict and place for ${samePlace}`,
  );
  const describe = it => `${JSON.stringify(it.config.languageOptions)} ${it.code}`;
  report(name, cases.map(describe), expected, actual, Number(process.argv[3] ?? 10));
}

run("typescript-estree", "typescript-eslint", "file.ts", [[{ parser }, { parser: "typescript" }]]);
const same = it => [it, it];
const ofEspree = [
  same({}),
  same({ sourceType: "script" }),
  same({ sourceType: "commonjs" }),
  same({ parserOptions: { ecmaFeatures: { jsx: true } } }),
];
run("espree", "eslint", "file.js", ofEspree);

// What no damage to a fixture leads to, in each of the languages.
const written = [
  "function f() { new.t\\u0061rget; }",
  "function f() { new.\\u0074arget; }",
  "function f() { new.t\\u{61}rget; }",
  "new.t\\u0061rget;",
  "() => new.t\\u0061rget;",
  "function f() {\n  a; new . t\\u0061rget; }",
  "function f() { new./* c */target; }",
  "function f() { new.target; }",
  "new.target;",
  "function f() { new.foo; }",
  "new.foo;",
  "function f() { new.t\\u0061rge; }",
  "new.t\\u0061rge;",
  "function f() { new.target.a\\u0062c; }",
  "import.m\\u0065ta;",
  "import.\\u006deta;",
  "a;\n import . m\\u0065ta;",
  "import.m\\u0065t;",
  "import.meta;",
  "import.meta.\\u0061;",
  "import.foo;",
  "import.d\\u0065fer('a');",
  "import.s\\u006furce('a');",
  "import.defer('a');",
  "import.source('a');",
];
{
  const cases = [];
  const expected = [];
  for (const code of written) {
    for (const [forEslint, forBunLint] of ofEspree) {
      cases.push({ code, filename: "file.js", config: { rules: {}, languageOptions: forBunLint }, options: {} });
      expected.push(brief(linter.verify(code, { files: ["**"], languageOptions: forEslint }, "file.js")));
    }
  }
  compare("espree, written", cases, expected);
}

const writtenInTypeScript = [
  'import.source("a");',
  'import.s\\u006furce("a");',
  'a;\n  import . source("a");',
  "import.source;",
  'import.defer("a");',
  'import.d\\u0065fer("a");',
  "import.defer;",
  'import.foo("a");',
  "import.\\u0066oo;",
  "import.meta;",
  "import.m\\u0065ta;",
  "function f() { new.t\\u0061rget; }",
  "function f() { new.foo; }",
];
compare(
  "typescript-estree, written",
  writtenInTypeScript.map(code => ({
    code,
    filename: "file.ts",
    config: { rules: {}, languageOptions: { parser: "typescript" } },
    options: {},
  })),
  writtenInTypeScript.map(code =>
    brief(linter.verify(code, { files: ["**"], languageOptions: { parser } }, "file.ts")),
  ),
);
