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
  const statements = ["debugger;", "a == b;", "if (a = b) {}", "debugger; a == b;", "foo();", "if (a == (b = c)) { debugger }", "x != y"];
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
    '[2, "smart"]', "[2, always]", "[error, 2]", "[]", "{}", "null", '["error", "always", {"null": "ignore"}]', "[warn, {max: 1}]"]);
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
    cases.push({ code: bom + parts.join(""), filename: "file.js", config: rng.pick(configs), options: rng.pick(options) });
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

// ───────────────────────────── the comparison ─────────────────────────────

function eslintAnswer({ code, filename, config, options }) {
  const linter = new Linter({ configType: "flat", cwd: "/" });
  const { quiet, ...rest } = options;
  const own = structuredClone(config);
  if (own.languageOptions?.parser === "typescript") own.languageOptions.parser = typescriptParser;
  const configs = new FlatConfigArray([own], { baseConfig, basePath: "/" });
  configs.normalizeSync();
  // `oxlint-disable` means `eslint-disable` here, and nothing to ESLint.
  const messages = linter.verify(code.replaceAll("oxlint-", "eslint-"), configs, { filename, ...rest, ...(quiet ? { ruleFilter: ({ severity }) => severity === 2 } : {}) });
  return { messages, suppressedMessages: linter.getSuppressedMessages() };
}

function normalize(answer) {
  const message = ({ suggestions, ...m }) => ({
    ...m,
    message: m.message.replaceAll("oxlint-", "eslint-"),
    // The text of a syntax error is that of another parser.
    ...(m.fatal && m.message.startsWith("Parsing error:") ? { message: "Parsing error", line: 0, column: 0 } : {}),
    ...(suggestions ? { suggestions: suggestions.map(({ messageId, desc, fix }) => ({ messageId, desc, fix })) } : {}),
  });
  return { messages: answer.messages.map(message), suppressedMessages: answer.suppressedMessages.map(message) };
}

for (const [name, make] of Object.entries({ generated, upstream })) {
  if (only && only !== name) continue;
  const cases = [], expected = [];
  let invalid = 0;
  for (const it of make()) {
    try {
      expected.push(normalize(eslintAnswer(it)));
      cases.push(it);
    } catch {
      invalid++; // The configuration is invalid.
    }
  }
  if (invalid > 0) console.log(`${name}: ${invalid} cases left out, ESLint throws`);
  const actual = runBunLint("verify", cases).map(normalize);
  // What espree rejects and the parser here accepts is counted by itself.
  const isFatal = answer => answer.messages[0]?.message === "Parsing error";
  const lenient = cases.filter((_, i) => isFatal(expected[i]) && !isFatal(actual[i]));
  if (lenient.length > 0) {
    console.log(`${name}: ${lenient.length} cases left out, only ESLint reports a syntax error`);
    if (process.argv.includes("--lenient")) for (const it of lenient) console.log(JSON.stringify([it.code, it.config.languageOptions]));
  }
  const keep = (_, i) => !lenient.includes(cases[i]);
  report(name, cases.filter(keep), expected.filter(keep), actual.filter(keep), 12);
}
