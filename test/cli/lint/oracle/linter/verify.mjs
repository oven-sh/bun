// ESLint's `Linter.verify` against `Linter::lint`: directive comments, inline configuration,
// `linterOptions`, the shape of the messages.
//
// ESLint is given exactly the rules that `bun-lint` implements, so that both know the same rules.
// The cases are generated here, and recorded from ESLint's own tests of its linter (see
// `recordUpstream`). Because the comparison is with what ESLint answers, not with what a test
// asserts, the recorded code can be rewritten to use rules that are implemented.
//
//   [TYPESCRIPT_ESLINT_DIR=<built checkout>] node verify.mjs [--only=generated|upstream]

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { bunLint, eslintDir, random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const { defaultConfig } = requireFromEslint("./lib/config/default-config");
const builtinRules = requireFromEslint("./lib/rules");
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7);

const implemented = JSON.parse(execFileSync(bunLint, ["linter", "rules"]).toString());
const core = Object.fromEntries(implemented.filter(id => !id.includes("/")).map(id => [id, builtinRules.get(id)]));
const plugins = { "@": { ...defaultConfig[0].plugins["@"], rules: core } };
let typescriptParser;
if (process.env.TYPESCRIPT_ESLINT_DIR) {
  const requireTs = createRequire(join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"));
  const all = requireTs("./dist/rules/index.js");
  const rules = Object.fromEntries(
    implemented.filter(id => id.startsWith("@typescript-eslint/")).map(id => [id.slice(19), all[id.slice(19)]]),
  );
  plugins["@typescript-eslint"] = { rules };
  typescriptParser = requireTs("@typescript-eslint/parser");
}
const baseConfig = [
  { plugins, language: "@/js", linterOptions: { reportUnusedDisableDirectives: 1 } },
  { files: ["**"] },
];

// ───────────────────────────── generated cases ─────────────────────────────

function generated() {
  const rng = random(3);
  const cases = [];
  const ruleNames = ["no-debugger", "eqeqeq", "no-cond-assign", "max-depth", "no-such-rule", "foo/bar", "no-comma-dangle",
    "@typescript-eslint/no-non-null-assertion"];
  const statements = ["typeof a == 'string';", "'a' != 'b';", "debugger;", "a == b;", "if (a = b) {}", "debugger; a == b;", "foo();", "if (a == (b = c)) { debugger }", "x != y"];
  const lists = () => {
    const n = rng.int(4);
    const quote = () => rng.pick(["", "", "", "'", '"']);
    const names = Array.from({ length: n }, () => { const q = quote(); return q + rng.pick(ruleNames) + q; });
    return names.join(rng.pick([",", ", ", " , ", ",  ", " ,"]));
  };
  const justification = () => rng.pick(["", "", "", " -- because", " -- a -- b", " --", " --x", " ---- y", "\n-- z"]);
  const block = () => {
    const label = rng.pick(["eslint-disable", "eslint-enable", "eslint-disable", "eslint-enable", "eslint-disable-line",
      "eslint-disable-next-line", "oxlint-disable", "oxlint-enable", "oxlint-disable-line", "oxlint-disable-next-line"]);
    const open = rng.pick(["/*", "/* ", "/*  ", "/*\n", "/*\t"]);
    return `${open}${label}${rng.pick([" ", " ", "  ", "\n"])}${lists()}${justification()}${rng.pick(["*/", " */", "\n*/"])}`;
  };
  const line = () => {
    const label = rng.pick(["eslint-disable-line", "eslint-disable-next-line", "eslint-disable", "eslint-enable",
      "oxlint-disable-line", "oxlint-disable-next-line"]);
    return `//${rng.pick(["", " ", "  "])}${label} ${lists()}${justification().replace("\n", " ")}`;
  };
  const severity = () => rng.pick(["0", "1", "2", "off", "warn", "error", '"error"', "'warn'", "3", "foo", "true", "[2]", "[1]", "[0]",
    '[2, "smart"]', "[2, always]", "[error, 2]", "[]", "{}", "null", '["error", "always", {"null": "ignore"}]', "[warn, {max: 1}]", '["off", "bogus"]', '[0, "bogus"]', "[off, {x: 1}]", "[0, 1, 2, 3]"]);
  const inline = () => {
    const n = 1 + rng.int(3);
    const entries = Array.from({ length: n }, () => `${rng.pick(ruleNames)}${rng.pick([":", ": ", " : "])}${severity()}`);
    return `/*${rng.pick(["", " "])}eslint ${entries.join(rng.pick([", ", ",", " ", "\n"]))}${justification()} */`;
  };
  const other = () => rng.pick([
    "/* global a, b:writable */", "/* globals a:off */", "/* global a:foo */", "/* global a: */", "/* exported a */", "/* eslint-env node */",
    "// global a", "// eslint eqeqeq: 2", "/** eslint-disable */", "/* eslint-disable-foo */", "/* eslint */", "/*eslint-disable*/",
    "'/* eslint-disable */';", "`/* eslint-disable */`;", "// /* eslint-disable */", "/* // eslint-disable-line */", "/* eslint-disable-line\n*/",
    "/* eslint-disable-next-line\nno-debugger */", "/* eslint-disable-next-line no-debugger\n*/", "/* é😀 */ /* eslint-disable-line */",
  ]);
  const configs = [
    { rules: { "no-debugger": 2, eqeqeq: 1, "no-cond-assign": "error" } },
    { rules: { "no-debugger": "warn", eqeqeq: ["error", "smart"] } },
    { rules: { "no-debugger": 0, eqeqeq: [0, "smart"], "max-depth": [2, 1] } },
    { rules: {} },
    { rules: { "no-debugger": 2, eqeqeq: 2 }, linterOptions: { reportUnusedDisableDirectives: "error" } },
    { rules: { "no-debugger": 2, eqeqeq: 2 }, linterOptions: { reportUnusedDisableDirectives: "off" } },
    { rules: { "no-debugger": 2, eqeqeq: 2 }, linterOptions: { reportUnusedDisableDirectives: true } },
    { rules: { "no-debugger": 2, eqeqeq: 2 }, linterOptions: { noInlineConfig: true } },
    { rules: { "no-debugger": 2, eqeqeq: [1, "smart"] }, linterOptions: { reportUnusedInlineConfigs: "error" } },
    { rules: { "no-debugger": 1, eqeqeq: [2, "always", { null: "ignore" }] }, linterOptions: { reportUnusedInlineConfigs: "warn" } },
  ];
  const invalidConfigs = [
    { rules: { eqeqeq: [2, "sometimes"] } },
    { rules: { "foo/bar": 2 } }, { rules: { "foo/bar": 0 } }, { rules: { "no-comma-dangle": 1 } }, { rules: { "space-in-brackets": 2 } }, { rules: { "@scope/foo/bar": [2] } },
    { foo: 1 }, { name: "named", foo: 1 }, { env: {} }, { rules: { eqeqeq: "bad" } }, { rules: { eqeqeq: [] } }, { rules: { eqeqeq: {} } }, { rules: [] }, { rules: null },
    { linterOptions: { noInlineConfig: 1 } }, { linterOptions: { reportUnusedDisableDirectives: "x" } }, { linterOptions: { reportUnusedInlineConfigs: true } }, { linterOptions: { foo: 1 } },
    { linterOptions: 1 }, { settings: 1 }, { settings: [] }, { languageOptions: 1 }, { languageOptions: [] }, { plugins: ["a"] }, { plugins: 1 }, { name: 1 }, { name: "" , bar: 1 }, { files: [] }, { files: "a" },
    { files: [1] }, { files: [["a", 1]] }, { ignores: "a" }, { ignores: [1] }, { basePath: 1 }, { root: true }, { parserOptions: {} }, { name: "n", files: [] }, { overrides: [] },
    { rules: { "no-debugger": [2, {}] }, languageOptions: { ecmaVersion: "2020" } },
    ...[{ ecmaVersion: null }, { sourceType: "esm" }, { sourceType: 1 }, { globals: [] }, { globals: null }, { globals: { " a": true } }, { globals: { a: "yes" } }, { globals: { a: 1 } },
      { parserOptions: [] }, { parserOptions: null }, { parserOptions: "x" }, { env: {} }, { foo: 1, bar: 2 }, { ecmaVersion: 2.5, sourceType: "script" }, { ecmaVersion: 1e9 },
    ].map(languageOptions => ({ rules: { "no-debugger": 2 }, languageOptions })),
  ];
  const options = [{}, {}, {}, {}, { allowInlineConfig: false }, { reportUnusedDisableDirectives: true }, { reportUnusedDisableDirectives: "off" },
    { reportUnusedDisableDirectives: "warn" }, { disableFixes: true }, { quiet: true }];
  for (let i = 0; i < 30000; i++) {
    const parts = [];
    for (let n = 1 + rng.int(7); n > 0; n--) {
      const kind = rng.int(10);
      parts.push(kind < 4 ? rng.pick(statements) : kind < 6 ? block() : kind < 8 ? line() + "\n" : kind < 9 ? inline() : other());
      parts.push(rng.pick([" ", "\n", "\n", "\r\n", "", "\n\n"]));
    }
    const bom = rng.int(40) === 0 ? "﻿" : "";
    const code = bom + parts.join("");
    // ESLint has to see the same text in every pass, so not where `oxlint-` is rewritten for it.
    const fix = rng.int(5) === 0 && !code.includes("oxlint-") ? { fix: true } : {};
    const { quiet, ...given } = rng.pick(options);
    cases.push({ code, filename: "file.js", config: rng.pick(rng.int(20) === 0 ? invalidConfigs : configs), options: fix.fix ? { ...given, ...fix } : { ...given, ...(quiet ? { quiet } : {}) } });
  }
  return cases;
}

// ───────────────────────────── cases from ESLint's tests ─────────────────────────────

/** Runs ESLint's tests of its linter with a `verify` that records what it is given. */
function recordUpstream() {
  const recorded = [];
  const original = Linter.prototype.verify;
  Linter.prototype.verify = function (code, config, options) {
    if (typeof code === "string") recorded.push({ code, config, options });
    return original.call(this, code, config, options);
  };
  const hooks = [[]];
  const run = fn => { try { fn?.call({ timeout() {}, skip() {} }, () => {}); } catch {} };
  const describe = (name, fn) => { hooks.push([]); run(fn); hooks.pop(); };
  const it = (name, fn) => { for (const level of hooks) level.forEach(run); run(fn); };
  Object.assign(globalThis, {
    describe: Object.assign(describe, { only: describe, skip() {} }),
    it: Object.assign(it, { only: it, skip() {} }),
    beforeEach: fn => hooks.at(-1).push(fn),
    afterEach() {}, before: run, after() {},
  });
  const warn = process.emitWarning;
  process.emitWarning = () => {};
  for (const file of ["tests/lib/linter/linter.js", "tests/lib/languages/js/source-code/source-code.js"]) {
    try { requireFromEslint(join(eslintDir, file)); } catch (error) { console.log(`${file}: ${error.message}`); }
  }
  process.emitWarning = warn;
  Linter.prototype.verify = original;
  return recorded;
}

const isPlain = value =>
  value === null || ["string", "number", "boolean"].includes(typeof value)
  || (Array.isArray(value) && value.every(isPlain))
  || (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlain));

/** Rules that the tests use a lot, and code that they report, by rules that are implemented and code that these report. */
const rewrite = text => text
  .replaceAll("no-alert", "no-debugger").replace(/\balert\((?:[^()]|\([^()]*\))*\)/g, "debugger")
  .replaceAll("no-console", "eqeqeq").replace(/\bconsole\.log\((?:[^()]|\([^()]*\))*\)/g, "a == b");

function upstream() {
  const cases = [], seen = new Set();
  for (const { code, config, options } of recordUpstream()) {
    const objects = [config ?? {}].flat();
    const given = typeof options === "string" ? { filename: options } : options ?? {};
    if (objects.length !== 1 || !isPlain(objects[0]) || !isPlain(given)) continue;
    const { files, ignores, name, plugins, processor, language, ...rest } = JSON.parse(rewrite(JSON.stringify(objects[0])));
    if (files || ignores || plugins || processor || language) continue;
    rest.rules = Object.fromEntries(Object.entries(rest.rules ?? {}).filter(([id]) => implemented.includes(id)));
    const { filename = "file.js", allowInlineConfig, reportUnusedDisableDirectives, disableFixes, ...unknown } = given;
    if (Object.keys(unknown).length > 0 || !/\.[cm]?js$/.test(filename)) continue;
    const it = { code: rewrite(code), filename, config: rest, options: { allowInlineConfig, reportUnusedDisableDirectives, disableFixes } };
    const key = JSON.stringify(it);
    if (!seen.has(key)) cases.push(JSON.parse(key));
    seen.add(key);
  }
  return cases;
}

// ───────────────────────────── other names for the same rules ─────────────────────────────

/**
 * The names that oxlint has for the plugins are understood in comments and in the configuration. ESLint is given the
 * names that it knows, so only what does not depend on the length of a comment is compared.
 */
function aliases() {
  const rng = random(9);
  const names = { "no-debugger": ["eslint/no-debugger"], "@typescript-eslint/no-non-null-assertion": ["typescript/no-non-null-assertion", "typescript-eslint/no-non-null-assertion"] };
  const cases = [];
  for (let i = 0; i < 2000; i++) {
    const name = () => rng.pick(Object.keys(names));
    const lines = Array.from({ length: 1 + rng.int(6) }, () => rng.pick([
      "debugger;", "a!;", "debugger; a!;", `// eslint-disable-next-line ${name()}`, `debugger; // eslint-disable-line ${name()}, ${name()}`, `/* eslint-disable ${name()} */`,
      `/* eslint-enable ${name()} */`, `/* eslint ${name()}: ${rng.pick([0, 1, 2])} */`, `a!; // oxlint-disable-line ${name()}`,
    ]));
    const rules = Object.fromEntries(Object.keys(names).filter(() => rng.int(3) !== 0).map(id => [id, rng.pick([1, 2])]));
    cases.push({ code: lines.join("\n"), filename: "file.ts", config: { rules, languageOptions: { parser: "typescript" } }, options: {}, names });
  }
  return cases;
}

// ───────────────────────────── the comparison ─────────────────────────────

function eslintAnswer({ code, filename, config, options }) {
  const linter = new Linter({ configType: "flat", cwd: "/" });
  const { quiet, fix, ...rest } = options;
  const own = structuredClone(config);
  if (own.languageOptions?.parser === "typescript") own.languageOptions.parser = typescriptParser;
  // As the command line does it, which shows in the messages about an invalid configuration.
  const configs = new FlatConfigArray([], { baseConfig, basePath: "/" });
  configs.push({}, own); // The harness has an object of its own before it.
  configs.normalizeSync();
  // `oxlint-disable` means `eslint-disable` here, and nothing to ESLint.
  if (fix) {
    const { fixed, output, messages } = linter.verifyAndFix(code, configs, { filename, ...rest });
    return { fixed, output, messages, suppressedMessages: linter.getSuppressedMessages() };
  }
  const messages = linter.verify(code.replaceAll("oxlint-", "eslint-"), configs, { filename, ...rest, ...(quiet ? { ruleFilter: ({ severity }) => severity === 2 } : {}) });
  return { messages, suppressedMessages: linter.getSuppressedMessages() };
}

function normalize(answer) {
  if (answer.error) return answer;
  const message = ({ suggestions, ...m }) => ({
    ...m,
    message: m.message.replaceAll("oxlint-", "eslint-"),
    // The text of a syntax error is that of another parser.
    ...(m.fatal && m.message.startsWith("Parsing error:") ? { message: "Parsing error", line: 0, column: 0 } : {}),
    ...(suggestions ? { suggestions: suggestions.map(({ messageId, desc, fix }) => ({ messageId, desc, fix })) } : {}),
  });
  return { ...answer, messages: answer.messages.map(message), suppressedMessages: answer.suppressedMessages.map(message) };
}

for (const [name, make] of Object.entries({ generated, upstream, aliases })) {
  if (only && only !== name) continue;
  const cases = [], expected = [];
  let invalid = 0;
  for (const it of make()) {
    try {
      expected.push(normalize(eslintAnswer(it)));
      cases.push(it);
    } catch (error) {
      // The configuration is invalid. A rule that ESLint does not have may be one that is not implemented yet.
      if (/Could not find "/.test(error.message)) {
        invalid++;
        continue;
      }
      expected.push({ error: error.message });
      cases.push(it);
    }
  }
  if (invalid > 0) console.log(`${name}: ${invalid} cases left out, ESLint throws`);
  let actual;
  if (name === "aliases") {
    const rng = random(10);
    const renamed = cases.map(({ names, ...it }) => JSON.parse(JSON.stringify(it).replace(
      new RegExp(Object.keys(names).join("|"), "g"), id => rng.pick([id, ...names[id]]))));
    const brief = answer => Object.fromEntries(Object.entries(normalize(answer)).map(([key, messages]) =>
      [key, messages.map(({ ruleId, severity, line, messageId }) => ({ ruleId, severity, line, messageId }))]));
    actual = runBunLint("verify", renamed).map(brief);
    expected.forEach((answer, i) => (expected[i] = brief(answer)));
  } else {
    actual = runBunLint("verify", cases).map(normalize);
  }
  // What espree rejects and the parser here accepts is counted by itself.
  const isFatal = answer => answer.messages?.[0]?.message === "Parsing error";
  const lenient = cases.filter((_, i) => isFatal(expected[i]) && !isFatal(actual[i]));
  if (lenient.length > 0) {
    console.log(`${name}: ${lenient.length} cases left out, only ESLint reports a syntax error`);
    if (process.argv.includes("--lenient")) for (const it of lenient) console.log(JSON.stringify([it.code, it.config.languageOptions]));
  }
  const keep = (_, i) => !lenient.includes(cases[i]);
  report(name, cases.filter(keep), expected.filter(keep), actual.filter(keep), 12);
}
