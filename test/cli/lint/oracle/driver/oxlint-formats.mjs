// Runs real oxlint and `bun lint` with every `--format` of oxlint on generated projects that an `.oxlintrc.json` governs, and
// compares standard output, standard error and the exit code.
//
//   bun oxlint-formats.mjs --oxlint=<path of oxlint> --scratch=<directory> --bin="<bun-lint> cli" [--only=substring] [--format=name] [--exact] [--order] [--show]
//   bun oxlint-formats.mjs --oxlint=<path of oxlint> --record=<directory> [--only=substring] [--format=name]
//
// What is compared:
// - The formats that programs read: the bytes. oxlint prints a file when a thread is done with it, and the diagnostics of a file in
//   the order in which its rules run, so what is printed for a diagnostic is a block, and the blocks are sorted. `--order` keeps
//   the diagnostics of a file in their order. The time and the number of threads are taken out.
// - `default`, which is for people and looks different: the exit code, and which of the two streams has anything.
// - A case that is `loose` (the command line or the configuration is refused): the same as for `default`, in every format.
// - The words of a rule of ESLint are not oxlint's. In a case that is not `exact` the message, the help, the note, the texts of the
//   labels, and what is computed from them (the fingerprint of `gitlab`) are taken out. `--exact` leaves them in. A case that is
//   `exact` reports with a plugin in JavaScript, which says the same to both.
//
// - oxlint has neither the message nor the severity of a problem without a place in `unix`, `github`, `gitlab`, `junit` and
//   `checkstyle`. `bun lint` prints them. Both are taken out of such a problem.
//
// - `bun lint` ends a run for people with notes on standard error (`note: ..`): which rules ran in JavaScript that are built in.
//   oxlint has none. They are taken out.
//
// `--record` writes each project, and what oxlint prints for it, below a directory, and compares nothing.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const flag = name => process.argv.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const oxlint = [path.resolve(flag("oxlint"))];
const record = flag("record") && path.resolve(flag("record"));
const bin = flag("bin")?.split(" ");
const only = flag("only");
const everythingIsExact = process.argv.includes("--exact");
const keepsOrder = process.argv.includes("--order");
const show = process.argv.includes("--show");

const formats = ["agent", "checkstyle", "default", "github", "gitlab", "json", "junit", "sarif", "stylish", "unix"];

// ───────────── the projects ─────────────

const off = { categories: { correctness: "off" } };
const rc = (rules, more = {}) => JSON.stringify({ ...off, rules, ...more });

// The places that these rules report are the same in ESLint and in oxlint.
const basic = {
  ".oxlintrc.json": rc({ "no-debugger": "error", eqeqeq: "error", "no-var": "warn", "no-empty": "warn" }),
  "a.js": "var a = 1;\nif (a == 2) {\n  debugger;\n}\n",
  "clean.js": "export const clean = 1;\n",
  "src/b.ts": "debugger;\nvar b: number = 1;\n",
  "src/deep/d.mjs": "if (x) {}\n",
  "src/deep/er/c.jsx": "export const c = <p>{x == y}</p>;\n",
};
const repository = { ...basic, ".git/HEAD": "ref: refs/heads/main\n" };
const warnings = {
  ".oxlintrc.json": rc({ "no-var": "warn", "no-empty": "warn" }),
  "a.js": "var a = 1;\nif (a) {}\n",
  "src/b.js": "export const b = 1;\n",
};
const fixable = {
  ".oxlintrc.json": rc({ "no-var": "warn", "prefer-const": "warn", "no-extra-boolean-cast": "error", eqeqeq: "error", "no-debugger": "error", "no-eval": "error", curly: "warn" }),
  "a.js": 'var a = 1;\nlet b = 2;\nif (!!a) b == a;\ndebugger;\neval("x");\n',
};
const suppressed = count => ({
  ".oxlintrc.json": rc({ "no-debugger": "error", "no-var": "warn" }),
  "a.js": "debugger;\nvar a;\ndebugger;\n",
  ...(count && { "oxlint-suppressions.json": JSON.stringify({ "a.js": { "no-debugger": { count } } }) }),
});
const one = (rules, more) => ({ ".oxlintrc.json": rc(rules, more), "a.js": "debugger;\n" });

const plugin = `const rule = {
  meta: { schema: false },
  create(context) {
    return {
      Program() {
        const [places, message = "marked"] = context.options;
        const code = context.sourceCode;
        for (const [start, end] of places[context.filename.split("/").at(-1)] ?? []) {
          context.report({ loc: { start: code.getLocFromIndex(start), end: code.getLocFromIndex(end) }, message });
        }
      },
    };
  },
};
export default { meta: { name: "probe" }, rules: { error: rule, warning: rule } };
`;

/**
 * A project whose problems are where the texts are marked: `⟦…⟧` is an error, `⟪…⟫` a warning. The marks are taken out. `say` is
 * the message.
 */
function marked(files, say, more = {}) {
  const places = { error: {}, warning: {} };
  const project = {};
  for (const [name, source] of Object.entries(files)) {
    // In UTF-16 code units, of the text that a plugin sees: it has no byte order mark.
    let length = 0;
    const open = [];
    const add = kind => (places[kind][path.basename(name)] ??= []).push([open.pop(), length]);
    for (const character of source) {
      if (character === "⟦" || character === "⟪") open.push(length);
      else if (character === "⟧") add("error");
      else if (character === "⟫") add("warning");
      else if (character !== "\u{FEFF}") length += character.length;
    }
    project[name] = source.replace(/[⟦⟧⟪⟫]/g, "");
  }
  const options = kind => (say === undefined ? [places[kind]] : [places[kind], say]);
  return {
    ".oxlintrc.json": JSON.stringify({
      ...off,
      jsPlugins: ["./probe/plugin.js"],
      ignorePatterns: ["probe"],
      rules: { "probe/error": ["error", ...options("error")], "probe/warning": ["warn", ...options("warning")] },
      ...more,
    }),
    "probe/plugin.js": plugin,
    ...project,
  };
}

// To oxlint `n`, which a plugin in JavaScript can be called, and `node`, which is built in, are two plugins.
const calledN = more => ({
  ".oxlintrc.json": JSON.stringify({ ...off, plugins: ["node"], jsPlugins: ["./n.js"], ignorePatterns: ["n.js"], ...more }),
  "n.js": `const rule = message => ({ create: context => ({ BinaryExpression(node) { context.report({ node, message }); } }) });
export default { meta: { name: "eslint-plugin-n" }, rules: { "no-path-concat": rule("of the package"), "only-there": rule("only there") } };
`,
  "a.js": 'export const p = __dirname + "/x";\n',
});
const bothOfN = { "n/no-path-concat": "error", "node/no-path-concat": "warn" };

// `files`: path -> text. `args`: `{root}` is the directory of the project. `cwd`: below the project. `env`: more of it.
// `formats`: not all of them, `null` is a run without `--format`, which prints the format `as`.
const cases = [
  // ───────────── how many, and the exit code ─────────────
  { name: "errors and warnings", files: basic },
  { name: "errors and warnings, --quiet", files: basic, args: ["--quiet"] },
  { name: "errors and warnings, --silent", files: basic, args: ["--silent"] },
  { name: "errors and warnings, --max-warnings=0", files: basic, args: ["--max-warnings=0"] },
  { name: "errors and warnings, --deny-warnings", files: basic, args: ["--deny-warnings"] },
  { name: "only warnings", files: warnings },
  { name: "only warnings, --quiet", files: warnings, args: ["--quiet"] },
  { name: "only warnings, --silent", files: warnings, args: ["--silent"] },
  { name: "only warnings, --deny-warnings", files: warnings, args: ["--deny-warnings"] },
  { name: "only warnings, --quiet --deny-warnings", files: warnings, args: ["--quiet", "--deny-warnings"] },
  { name: "only warnings, --max-warnings=1", files: warnings, args: ["--max-warnings=1"] },
  { name: "only warnings, --max-warnings=2", files: warnings, args: ["--max-warnings=2"] },
  { name: "only warnings, --quiet --max-warnings=0", files: warnings, args: ["--quiet", "--max-warnings=0"] },
  { name: "only warnings, --silent --max-warnings=0", files: warnings, args: ["--silent", "--max-warnings=0"] },
  { name: "one error", files: one({ "no-debugger": "error" }) },
  { name: "one warning", files: one({ "no-debugger": "warn" }) },
  { name: "no problem", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "export {};\n", "src/b.ts": "export {};\n" } },
  { name: "no file", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "notes.md": "debugger;\n" } },
  { name: "no file, --no-error-on-unmatched-pattern", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }) }, args: ["--no-error-on-unmatched-pattern"] },
  { name: "a path that does not exist", files: basic, args: ["nothing.js"] },
  { name: "a path that does not exist, and one that does", files: basic, args: ["nothing.js", "a.js"] },
  { name: "a file that is named and ignored", files: basic, args: ["a.js", "--ignore-pattern", "a.js"] },

  // ───────────── what a path is relative to ─────────────
  { name: "a directory", files: basic, args: ["src"] },
  { name: "files", files: basic, args: ["src/b.ts", "a.js", "clean.js"] },
  { name: "a path that starts with a dot", files: basic, args: ["./a.js", "./src/"] },
  { name: "an absolute path", files: basic, args: ["{root}/a.js", "{root}/src/deep"] },
  { name: "from a subdirectory", files: basic, cwd: "src" },
  { name: "a file above the working directory", files: basic, cwd: "src/deep", args: ["{root}/a.js", "d.mjs"] },
  { name: "a path with two dots", files: basic, cwd: "src", args: ["../a.js"], loose: true },
  { name: "a repository, from its root", files: repository },
  { name: "a repository, from a subdirectory", files: repository, cwd: "src/deep" },
  { name: "a repository, a file above the working directory", files: repository, cwd: "src/deep", args: ["{root}/a.js"] },

  // ───────────── lines and columns ─────────────
  {
    name: "characters of 2, 3 and 4 bytes",
    exact: true,
    files: marked({
      "two.js": "/* é */ ⟦debugger;⟧\n⟪/* éé */⟫ ⟦x⟧;\n",
      "three.js": "/* 漢 */ ⟦debugger;⟧\n⟪/* 漢字 */⟫ ⟦x⟧;\n",
      "four.js": "/* 😀 */ ⟦debugger;⟧\n⟪/* 😀😀 */⟫ ⟦x⟧;\n",
      "combining.js": "/* e\u{301} */ ⟦debugger;⟧\n⟪/* e\u{301}\u{301} */⟫ ⟦e\u{301}⟧;\n",
      "wide.js": "/* \u{FF21}\u{200B}\u{A0} */ ⟦debugger;⟧\n",
    }),
  },
  {
    name: "characters of 2, 3 and 4 bytes, rules of oxlint",
    files: {
      ".oxlintrc.json": rc({ "no-debugger": "error", "no-empty": "warn", "no-void": "warn" }),
      "a.js": '/* é 漢 😀 e\u{301} */ debugger;\nvoid "é 漢 😀 e\u{301}"; debugger;\nif (é漢) {/* 😀 */} else {}\n',
    },
  },
  {
    name: "U+2028, U+2029, U+0085, a vertical tab and a form feed",
    exact: true,
    files: marked({ "a.js": "/* \u{2028} */ ⟦x⟧;\n/* \u{2029} */ ⟪y⟫; /* \u{85} \v \f */ ⟦z⟧;\n⟦/* \u{2028}\u{2029} */⟧\n" }),
  },
  { name: "a byte order mark", exact: true, files: marked({ "a.js": "\u{FEFF}⟦debugger;⟧ ⟪x⟫;\n⟦y⟧;\n", "zero.js": "\u{FEFF}⟦⟧x;\n", "only.js": "\u{FEFF}⟪⟫" }) },
  { name: "a byte order mark, rules of oxlint", files: { ".oxlintrc.json": rc({ "no-debugger": "error", "unicode-bom": "warn" }), "a.js": "\u{FEFF}debugger;\ndebugger;\n" } },
  {
    name: "a byte order mark, what rules say about the file",
    files: {
      ".oxlintrc.json": rc(
        { "no-debugger": "error", "unicorn/filename-case": "error", "import/unambiguous": "warn", "react/jsx-filename-extension": ["error", { allow: "as-needed" }], "oxc/no-barrel-file": ["warn", { threshold: 0 }] },
        { plugins: ["unicorn", "import", "react", "oxc"] },
      ),
      "Bad_Name.js": "\u{FEFF}debugger;\n",
      "plain.jsx": "\u{FEFF}const a = 1;\n",
      "barrel.js": '\u{FEFF}export * from "./x";\nexport * from "./y";\n',
      "x.js": "export const x = 1;\n",
      "y.js": "export const y = 1;\n",
    },
  },
  { name: "tabs", exact: true, files: marked({ "a.js": "\t⟦debugger;⟧\n\t\tif (a)\t⟪{\t}⟫\n⟦\t⟧\n" }) },
  {
    name: "CRLF",
    exact: true,
    files: marked({
      "a.js": "⟦x⟧;\r\n  ⟪y⟫;\r\n⟦if (a) {\r\n}⟧\r\n",
      // Before, between, after and around the two.
      "between.js": "x;⟦⟧\r\ny;\r⟦⟧\nz;\r\n⟦⟧w;⟪\r\n⟫v;⟪\r⟫\nu;\r⟪\n⟫t;\r\n",
    }),
  },
  { name: "CR", exact: true, files: marked({ "a.js": "⟦x⟧;\r  ⟪y⟫;\r\r⟦z⟧;⟪\r⟫w;\n\r⟦v⟧;\r" }) },
  { name: "several lines", exact: true, files: marked({ "a.js": "⟦function f() {\n  return `\n`;\n}⟧\n⟪/*\n\n*/⟫ ⟦x;\ny⟧;\n", "b.js": "x;⟦\n⟧y;⟪\n\n⟫z;\n" }) },
  { name: "several lines, rules of oxlint", files: { ".oxlintrc.json": rc({ "no-empty-function": "warn", "no-empty": "error" }), "a.js": "function f() {\n\n}\nif (f) {\n}\n" } },
  {
    name: "the start and the end of a file",
    exact: true,
    files: marked({
      "start.js": "⟦x⟧;\n",
      "end.js": "x;\n⟦y⟧",
      "both.js": "⟦debugger⟧",
      "all.js": "⟪x;\ny;\n⟫",
      "nothing-at-the-start.js": "⟦⟧x;\n",
      "nothing-at-the-end.js": "x;\n⟦⟧",
      "nothing-at-the-end-of-the-last-line.js": "x;⟦⟧",
      "nothing-before-the-last-line-break.js": "x;⟦⟧\n",
      "the-last-line-break.js": "x;⟪\n⟫",
      "empty.js": "⟦⟧",
      "a-line-break.js": "⟦⟧\n⟪⟫",
    }),
  },
  { name: "the start and the end of a file, rules of oxlint", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "debugger", "b.js": "debugger;\nx;\ndebugger" } },
  { name: "the same place twice", exact: true, files: marked({ "a.js": "⟦⟦x⟧⟧; ⟪⟦y⟧⟫;\n" }) },
  { name: "lines of 1, 2 and 3 digits", exact: true, files: marked({ "a.js": `⟦x⟧;\n${"\n".repeat(8)}          ⟪y⟫;\n${"\n".repeat(89)}⟦z⟧;\n` }) },
  { name: "a line of 1,300 bytes", exact: true, files: marked({ "a.js": `⟦x⟧; /* ${"-".repeat(1300)} */ ⟪y⟫;\n⟦z⟧;\n`, "b.js": "⟦x⟧;\n" }) },

  // ───────────── special characters ─────────────
  { name: "a message with special characters", exact: true, files: marked({ "a.js": "⟦x⟧; ⟪y⟫;\n" }, "a & b <c> \"d\" 'e' `f` \\ \\n 100% %0A ::, ]]> &amp; é 漢 😀 [Error/x] end") },
  { name: "a message with line breaks and tabs", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }, "one\ntwo\r\nthree\rfour\tfive  six \u{2028} seven \u{A0} eight") },
  { name: "a message with blanks around it", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }, "  blanks \n") },
  { name: "n and node: both are on", files: calledN({ rules: bothOfN }) },
  { name: "n and node: only what is built in", files: calledN({ rules: { "node/no-path-concat": "warn" } }) },
  { name: "n and node: only the plugin's", files: calledN({ rules: { "n/no-path-concat": "warn" } }) },
  { name: "n and node: node is not among the plugins", files: calledN({ plugins: [], rules: bothOfN }) },
  { name: "n and node: a category", files: calledN({ categories: { correctness: "off", restriction: "warn" }, rules: { "n/only-there": "error" } }) },
  { name: "n and node: an override turns off what is built in", files: calledN({ rules: bothOfN, overrides: [{ files: ["*.js"], rules: { "node/no-path-concat": "off" } }] }) },
  { name: "n and node: an override turns off the plugin's", files: calledN({ rules: bothOfN, overrides: [{ files: ["*.js"], rules: { "n/no-path-concat": "off" } }] }) },
  { name: "n and node: suppressions", files: { ...calledN({ rules: { "n/no-path-concat": "error", "node/no-path-concat": "error" } }), "oxlint-suppressions.json": JSON.stringify({ "a.js": { "n/no-path-concat": { count: 1 } } }) } },
  { name: "a message with control characters", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }, "\u{1} \b \f \v \u{1B}[31m \u{7F} \u{85} \u{FEFF} \u{FFFD}") },
  { name: "an empty message", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }, "") },
  {
    name: "paths with special characters",
    exact: true,
    files: marked({
      "a&b.js": "⟦x⟧;\n",
      "less<more>.js": "⟦x⟧;\n",
      'double".js': "⟦x⟧;\n",
      "single'.js": "⟦x⟧;\n",
      "100%.js": "⟦x⟧;\n",
      "%0A.js": "⟦x⟧;\n",
      "colon:1:2:.js": "⟦x⟧;\n",
      "comma,line=9.js": "⟦x⟧;\n",
      "a blank.js": "⟦x⟧;\n",
      "$HOME `id` (x) [y] {z} *?!#;~.js": "⟦x⟧;\n",
      "é 漢 😀 e\u{301}.js": "⟦x⟧;\n",
      "dir & <x>/in it.js": "⟪x⟫;\n",
      "-f.js": "⟪x⟫;\n",
    }),
  },
  // Each has a project of its own: the blocks of a format of lines cannot be told apart otherwise.
  { name: "a backslash in a path", exact: true, files: marked({ "back\\slash.js": "⟦x⟧;\n" }) },
  { name: "a line break in a path", exact: true, files: marked({ "line\nbreak.js": "⟦x⟧;\n" }) },
  { name: "a tab and a carriage return in a path", exact: true, files: marked({ "tab\tand\rreturn.js": "⟦x⟧;\n" }) },
  {
    name: "the order of paths",
    exact: true,
    files: marked({ "b.js": "⟦x⟧;\n", "B.js": "⟦x⟧;\n", "a/z.js": "⟦x⟧;\n", "a.js": "⟦x⟧;\n", "a-b.js": "⟦x⟧;\n", "a_b.js": "⟦x⟧;\n", "é.js": "⟦x⟧;\n", "10.js": "⟦x⟧;\n", "9.js": "⟦x⟧;\n" }),
  },

  // ───────────── what a diagnostic has ─────────────
  {
    name: "syntax errors",
    files: {
      ".oxlintrc.json": rc({ "no-debugger": "error" }),
      "a.js": "debugger;\n",
      "token.js": "const a = ;\n",
      "colon.ts": "debugger;\nlet a: = 1;\n",
      "end.js": "debugger;\nfunction f() {",
      "string.js": 'const é = "😀\n',
    },
  },
  { name: "a syntax error with two labels", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "let a;\nlet a;\n" } },
  { name: "several syntax errors in a file", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "let a;\nlet a;\nconst b = 1;\nconst b = 2;\nbreak;\n" } },
  { name: "a syntax error, --quiet", files: { ".oxlintrc.json": rc({ "no-debugger": "warn" }), "a.js": "debugger;\n", "b.js": "const a = ;\n" }, args: ["--quiet"] },
  {
    name: "help, a note, several labels",
    files: {
      ".oxlintrc.json": rc(
        { "no-const-assign": "error", "no-dupe-keys": "error", "no-unused-vars": "warn", "import/no-cycle": "error", "import/no-duplicates": "warn", "typescript/no-non-null-assertion": "warn", "promise/param-names": "warn" },
        { plugins: ["import", "typescript", "promise"] },
      ),
      "a.ts": 'import { b } from "./b";\nimport { c } from "./b";\nconst a = 1;\na = 2;\nexport const o = { k: b, k: c! };\nnew Promise(x => x());\n',
      "b.ts": 'import { o } from "./a";\nexport const b = o,\n  c = 1;\n',
    },
  },
  ...["error", "warn"].map(severity => ({
    name: `no label, ${severity}`,
    files: { ".oxlintrc.json": rc({ "vitest/consistent-test-filename": severity, "no-debugger": "error" }, { plugins: ["vitest"] }), "src/a.spec.js": "debugger;\n", "b.spec.js": "", "c.js": "debugger;\n" },
  })),
  {
    name: "rules of plugins",
    files: {
      ".oxlintrc.json": rc(
        {
          "typescript/no-explicit-any": "error",
          "@typescript-eslint/no-namespace": "warn",
          "react/jsx-key": "error",
          "react/no-children-prop": "warn",
          "react-hooks/rules-of-hooks": "error",
          "import/no-self-import": "error",
          "import/no-mutable-exports": "warn",
          "unicorn/no-null": "warn",
          "unicorn/prefer-node-protocol": "error",
          "unicorn/no-empty-file": "warn",
          "jsx-a11y/alt-text": "error",
          "react-perf/jsx-no-new-object-as-prop": "warn",
          "nextjs/no-img-element": "warn",
          "promise/param-names": "warn",
          "node/no-new-require": "error",
          "oxc/const-comparisons": "error",
          "jest/no-focused-tests": "error",
          "vitest/no-import-node-test": "error",
          "jsdoc/require-param": "warn",
        },
        { plugins: ["typescript", "react", "import", "unicorn", "jsx-a11y", "react-perf", "nextjs", "promise", "node", "oxc", "jest", "vitest", "jsdoc"] },
      ),
      "src/a.tsx":
        'import fs from "fs";\nimport "./a";\nimport { useState } from "react";\nexport let x: any = null;\nnamespace N {}\nexport function List({ items, on }) {\n  if (on) useState(0);\n  return items.map(it => <li style={{ a: 1 }} children={it}><img src="a.png" /></li>);\n}\nnew Promise(a => a());\nif (x > 1 && x < 0) fs.x();\n',
      "src/empty.js": "",
      "src/a.test.js": 'import "node:test";\ntest.only("a", () => {});\n',
      "src/n.cjs": 'new require("x");\n/** */\nfunction f(a) {}\n',
    },
  },
  {
    name: "a rule that typescript-eslint extends",
    files: {
      ".oxlintrc.json": rc({ "@typescript-eslint/no-empty-function": "warn", "typescript/no-array-constructor": "error", "no-unused-expressions": "warn" }, { plugins: ["typescript"] }),
      "a.ts": "export function f() {}\nnew Array(1, 2);\n1;\n",
    },
  },
  { name: "what can be fixed and what cannot", files: fixable },
  { name: "what can be fixed and what cannot, --fix", files: fixable, args: ["--fix"] },
  {
    name: "comments that disable",
    files: {
      ".oxlintrc.json": rc({ "no-debugger": "error", "no-var": "warn" }),
      "a.js": "// eslint-disable-next-line no-debugger\ndebugger;\ndebugger; // oxlint-disable-line\n/* eslint-disable no-var */\nvar a;\n/* eslint-enable no-var */\nvar b;\n",
    },
  },
  ...["--report-unused-disable-directives", "--report-unused-disable-directives-severity=error"].map(option => ({
    name: `comments that disable nothing, ${option}`,
    args: [option],
    files: {
      ".oxlintrc.json": rc({ "no-debugger": "error", "no-var": "warn" }),
      "a.js": "// eslint-disable-next-line no-debugger\nx;\ny; // oxlint-disable-line\n/* eslint-disable no-var, no-debugger */\nvar a;\n/* é */ /* eslint-disable-line no-var */\n",
    },
  })),
  { name: "suppressions", files: suppressed(2) },
  { name: "suppressions, fewer than there are problems", files: suppressed(1) },
  { name: "suppressions, more than there are problems", files: suppressed(3) },
  { name: "suppressions, --suppress-all", files: suppressed(0), args: ["--suppress-all"] },
  { name: "suppressions, --suppress-all again", files: suppressed(1), args: ["--suppress-all"] },

  // ───────────── the number of rules ─────────────
  { name: "no rule", files: one({}) },
  { name: "the rules of an empty configuration", files: { ".oxlintrc.json": "{}", "a.js": "debugger;\n" } },
  { name: "a rule that is off", files: one({ "no-debugger": "error", "no-var": "off", eqeqeq: "warn" }) },
  { name: "a rule under three names", files: one({ "no-unused-vars": "warn", "typescript/no-unused-vars": "warn", "@typescript-eslint/no-unused-vars": "warn", "no-debugger": "error" }) },
  { name: "a rule of a plugin that is not on", files: one({ "react/jsx-key": "error", "no-debugger": "error" }, { plugins: [] }) },
  { name: "a rule that needs types", files: one({ "typescript/no-floating-promises": "error", "no-debugger": "error" }) },
  { name: "rules from flags", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "debugger;\nvar a;\n" }, args: ["-W", "no-var", "-D", "eqeqeq", "-A", "no-debugger"] },
  {
    name: "rules of overrides",
    files: {
      ".oxlintrc.json": rc({ "no-debugger": "error" }, { overrides: [{ files: ["*.ts"], rules: { "no-var": "warn", "no-debugger": "off" } }, { files: ["*.nothing"], rules: { eqeqeq: "error", "no-empty": "off" } }] }),
      "a.js": "debugger;\nvar a;\n",
      "b.ts": "debugger;\nvar b;\n",
    },
  },
  { name: "a nested configuration", files: { ".oxlintrc.json": rc({ "no-debugger": "error" }), "a.js": "debugger;\nvar a;\n", "src/.oxlintrc.json": rc({ "no-var": "warn" }), "src/b.js": "debugger;\nvar b;\n" } },
  { name: "rules of a plugin in JavaScript", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }, undefined, { overrides: [{ files: ["*.js"], rules: { "no-debugger": "warn" } }] }) },

  // ───────────── the environment ─────────────
  { name: "no --format", files: basic, formats: [null], as: "default" },
  { name: "no --format, GITHUB_ACTIONS=true", files: basic, formats: [null], as: "github", env: { GITHUB_ACTIONS: "true" } },
  { name: "no --format, GITHUB_ACTIONS=1", files: basic, formats: [null], as: "default", env: { GITHUB_ACTIONS: "1" } },
  { name: "no --format, AI_AGENT", files: basic, formats: [null], as: "agent", env: { AI_AGENT: "something" } },
  { name: "no --format, AI_AGENT and GITHUB_ACTIONS=true", files: basic, formats: [null], as: "agent", env: { AI_AGENT: "something", GITHUB_ACTIONS: "true" } },
  { name: "GITHUB_ACTIONS=true", files: basic, env: { GITHUB_ACTIONS: "true" } },
  { name: "AI_AGENT", files: basic, env: { AI_AGENT: "something" } },
  { name: "without NO_COLOR", exact: true, files: marked({ "a.js": "⟦x⟧; ⟪y⟫;\n", "b.js": "⟪x⟫;\n" }), env: { NO_COLOR: undefined } },
  { name: "without NO_COLOR, only warnings", exact: true, files: marked({ "a.js": "⟪y⟫;\n" }), env: { NO_COLOR: undefined } },
  { name: "NO_COLOR is empty", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }), env: { NO_COLOR: "" } },
  { name: "FORCE_COLOR=0, without NO_COLOR", exact: true, files: marked({ "a.js": "⟦x⟧;\n" }), env: { FORCE_COLOR: "0", NO_COLOR: undefined } },

  // ───────────── refused ─────────────
  { name: "a format that there is not", files: basic, formats: ["nothing"], loose: true },
  { name: "a configuration that is not JSON", files: { ...basic, ".oxlintrc.json": "{" }, loose: true },
  { name: "a rule that there is not", files: { ...basic, ".oxlintrc.json": rc({ "no-such-rule": "error" }) }, loose: true },
  { name: "a plugin that there is not", files: { ...basic, ".oxlintrc.json": rc({ "nothing/rule": "error" }) }, loose: true },
  { name: "options that a rule refuses", files: { ...basic, ".oxlintrc.json": rc({ eqeqeq: ["error", "sometimes"] }) }, loose: true },
  { name: "the file of -c does not exist", files: basic, args: ["-c", "nothing.json"], loose: true },
  { name: "a flag that there is not", files: basic, args: ["--nothing"], loose: true },
  { name: "a value that --max-warnings refuses", files: basic, args: ["--max-warnings=x"], loose: true },
];

// ───────────── running ─────────────

function write(root, files) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

async function run(command, root, test, format) {
  write(root, test.files);
  const args = [...(format === null ? [] : [`--format=${format}`]), ...(test.args ?? []).map(it => it.replace("{root}", root))];
  // Nothing of the environment of whoever runs this: both choose a format and colors by it.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1", ...test.env };
  const options = { cwd: path.join(root, test.cwd ?? "."), env, encoding: "utf8", maxBuffer: 1 << 28, timeout: 120_000 };
  const { promise, resolve } = Promise.withResolvers();
  const done = (error, stdout, stderr) => resolve({ args, stdout, stderr, status: error ? error.code : 0 });
  execFile(command[0], [...command.slice(1), ...args], options, done).stdin.end();
  return promise;
}

// ───────────── blocks ─────────────

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The texts of `blocks` in an order that does not depend on when they came: by `file`, then, unless `--order`, by text. */
function sorted(blocks) {
  return blocks
    .map((block, at) => ({ ...block, at }))
    .sort((a, b) => compare(a.file, b.file) || (keepsOrder ? a.at - b.at : compare(a.text, b.text)))
    .map(block => block.text);
}

/** `text` cut before every line that `start` matches. What is before the first such line is the first piece. */
function pieces(text, start) {
  const out = [""];
  for (const line of text.split(/(?<=\n)/)) {
    if (start.test(line)) out.push(line);
    else out[out.length - 1] += line;
  }
  return out;
}

/** A format that has a line for a diagnostic, or more where a message has line breaks. `start` captures the path. From `tail` on there are none. */
function lines(text, start, tail) {
  const end = tail?.exec(text)?.index ?? text.length;
  const [before, ...blocks] = pieces(text.slice(0, end), start);
  return before + sorted(blocks.map(block => ({ file: start.exec(block)[1] ?? "", text: block }))).join("") + text.slice(end);
}

/** What `JSON.parse` returns, if `text` is laid out as `to_string_pretty` of serde_json lays it out. */
function pretty(text) {
  try {
    const value = JSON.parse(text);
    return JSON.stringify(value, null, 2) === text ? value : undefined;
  } catch {}
}

const string = String.raw`"(?:[^"\\]|\\.)*"`;

/** By format: what it has printed without what oxlint does not know of a problem without a place. */
const withoutTheLost = {
  unix: text => text.replace(/^(.*?:0:0: )[^]*?( \[)\w+((?:\/[^\]\n]*)?\])$/gm, "$1lost$2lost$3"),
  github: text => text.replace(/^::\w+( file=.*?,line=0,endLine=0,col=0,endColumn=0,title=.*?::.*?:0:0: ).*$/gm, "::lost$1lost"),
  checkstyle: text => text.replace(/(<error line="0" column="0" severity=")\w+(" message=")[^"]*/g, "$1lost$2lost"),
  junit: text => text.replace(/(<(error|failure) message=")[^"]*(">line 0, column 0, )[^]*?(<\/\2>)/g, "$1lost$3lost$4"),
  gitlab(text) {
    const value = pretty(text);
    if (!Array.isArray(value)) return text;
    for (const it of value) if (it.location?.lines?.begin === 0) Object.assign(it, { description: "lost", fingerprint: "lost", severity: "lost" });
    return JSON.stringify(value, null, 2);
  },
};

/** By format: what it has printed without the words of rules, which have no line breaks. */
const masked = {
  unix: text => text.replace(/^(.*?:\d+:\d+: ).*( \[\w+(?:\/[^\]]*)?\])$/gm, "$1<message>$2"),
  // The help is after the message.
  agent: text => text.replace(/^(.*?(?::\d+:\d+)?: (?:error|warning|advice)(?: \S+)?: ).*$/gm, "$1<message>"),
  github: text => text.replace(/^(::\w+ .*?title=.*?::(?:.*?:\d+:\d+: )?).*$/gm, "$1<message>"),
  stylish: text => text.replace(/^(  \d+:\d+ *  \w+  ).*(  \S*)$/gm, "$1<message>$2"),
  checkstyle: text => text.replace(/ message="[^"]*"/g, ' message="<message>"'),
  junit: text => text.replace(/(<(error|failure) message=")[^"]*(">line \d+, column \d+, ).*(<\/\2>)/g, "$1<message>$3<message>$4"),
  // The fingerprint is made of the message.
  gitlab: text => text.replace(new RegExp(`^( +"(description|fingerprint)": )${string}`, "gm"), '$1"<$2>"'),
  sarif: text => text.replace(new RegExp(`("message": \\{\\s*"text": )${string}`, "g"), '$1"<message>"'),
  json: text => text.replace(new RegExp(`(\\{"message": )${string}`, "g"), '$1"<message>"').replace(new RegExp(`"(?:help|note|label)": ${string},`, "g"), ""),
};

/**
 * By format: what it has printed, so that two runs on the same project give the same. A text that does not have the form of the
 * format is returned as it is.
 */
const normal = {
  unix: text => lines(text, /^(.*?):\d+:\d+: /, /\n\d+ problems?\n$/),
  agent: text => lines(text, /^(.*?)(?::\d+:\d+)?: (?:error|warning|advice)(?: \S+)?: /),
  github: text => lines(text.replace(/^Finished in \S+ on (.*) using \d+ threads\.$/m, "Finished in <time> on $1 using <threads> threads."), /^::\w+ (?:file=(.*?),line=\d+,)?/, /^(?!::)/m),
  stylish(text) {
    const end = /\n(?:\x1B\[\d+m)?✖ \d+ problems? \(\d+ errors?, \d+ warnings?\)(?:\x1B\[0m)?\n$/.exec(text)?.index ?? text.length;
    const row = /^  (?:\x1B\[2m)?(\d+):\d+ *(?:\x1B\[0m)?  (?:\x1B\[\d+m)?(?:error|warning)(?:\x1B\[0m)?  /;
    // A file is an empty line, the path, and the rows, which are in the order of their lines.
    const files = text.slice(0, end).split(/(?<=\n)(?=\n)/).map(block => {
      const [name, ...rows] = pieces(block, row);
      return { file: name, text: name + sorted(rows.map(it => ({ file: row.exec(it)[1].padStart(9), text: it }))).join("") };
    });
    return sorted(files).join("") + text.slice(end);
  },
  checkstyle(text) {
    const error = String.raw`<error line="\d+" column="\d+" severity="\w+" message="[^"]*" source="[^"]*" />`;
    const files = [...text.matchAll(new RegExp(`(<file name="[^]*?">)((?:${error})+)</file>`, "g"))];
    const whole = inside => `<?xml version="1.0" encoding="utf-8"?><checkstyle version="4.3">${inside.join(" ")}</checkstyle>\n`;
    if (whole(files.map(it => it[0])) !== text) return text;
    const errors = it => sorted(it.match(new RegExp(error, "g")).map(one => ({ file: "", text: one }))).join("");
    return whole(sorted(files.map(it => ({ file: it[1], text: `${it[1]}${errors(it[2])}</file>` }))));
  },
  junit(text) {
    // oxlint sorts the files.
    const [head, ...suites] = pieces(text, /^ {4}<testsuite name="/);
    const inOrder = suite => {
      const end = suite.lastIndexOf("    </testsuite>\n");
      const [name, ...tests] = pieces(suite.slice(0, end), /^ {8}<testcase name="/);
      return name + sorted(tests.map(it => ({ file: "", text: it }))).join("") + suite.slice(end);
    };
    return head + suites.map(inOrder).join("");
  },
  gitlab(text) {
    const value = pretty(text);
    if (!Array.isArray(value)) return text;
    return JSON.stringify(sorted(value.map(it => ({ file: it.location?.path ?? "", text: JSON.stringify(it) }))).map(it => JSON.parse(it)), null, 2);
  },
  sarif(text) {
    const value = pretty(text);
    const run = value?.runs?.[0];
    if (!run?.results) return text;
    const place = location => location.physicalLocation.artifactLocation;
    // An index says when a rule or a file was first met. What it points to says more.
    for (const result of run.results) {
      if ("ruleIndex" in result) result.ruleIndex = `-> ${run.tool.driver.rules[result.ruleIndex]?.id}`;
      for (const location of result.locations ?? []) if ("index" in place(location)) place(location).index = `-> ${run.artifacts?.[place(location).index]?.location.uri}`;
    }
    const inOrder = (list, file) => sorted(list.map(it => ({ file: file(it), text: JSON.stringify(it) }))).map(it => JSON.parse(it));
    run.tool.driver.rules = inOrder(run.tool.driver.rules, it => it.id);
    if (run.artifacts) run.artifacts = inOrder(run.artifacts, it => it.location.uri);
    run.results = inOrder(run.results, it => (it.locations ? place(it.locations[0]).uri : ""));
    return JSON.stringify(value, null, 2);
  },
  json(text) {
    const match = /^([^]*?\{ "diagnostics": \[)([^]*)(\],\n {14}"number_of_files": \d+,\n {14}"number_of_rules": (?:\d+|null),\n {14}"threads_count": )\d+(,\n {14}"start_time": )[\d.]+(\n {12}\}\n {12})$/.exec(text);
    if (!match) return text;
    const blocks = (match[2] ? match[2].split(",\n") : []).map(it => ({ file: new RegExp(`"filename": (${string})`).exec(it)?.[1] ?? "", text: it }));
    return `${match[1]}${sorted(blocks).join(",\n")}${match[3]}<threads>${match[4]}<time>${match[5]}`;
  },
};

/** What of a run is compared. */
function comparable(result, format, test) {
  const name = test.as ?? format;
  const whether = text => (text === "" ? "nothing" : "something");
  const stderr = result.stderr.replace(/^note: .*\n/gm, "");
  if (test.loose || !normal[name]) return { "exit code": result.status, stdout: whether(result.stdout), stderr: whether(stderr) };
  const known = withoutTheLost[name]?.(result.stdout) ?? result.stdout;
  const stdout = test.exact || everythingIsExact ? known : masked[name](known);
  return { "exit code": result.status, stdout: normal[name](stdout), stderr };
}

/** The first lines that are not the same. */
function difference(expected, actual) {
  const [a, b] = [String(expected).split("\n"), String(actual).split("\n")];
  const at = a.findIndex((line, i) => line !== b[i]);
  const line = at < 0 ? a.length : at;
  return `  line ${line + 1}\n  oxlint   ${JSON.stringify(a[line])}\n  bun lint ${JSON.stringify(b[line])}`;
}

// ───────────── the run ─────────────

const formatsOf = test => (test.formats ?? formats).filter(it => !flag("format") || it === flag("format"));
const chosen = cases.filter(test => (!only || test.name.includes(only)) && formatsOf(test).length > 0);

if (record) {
  for (const test of chosen) {
    const directory = path.join(record, test.name.replace(/[^\w.,=+-]+/g, "_"));
    fs.rmSync(directory, { recursive: true, force: true });
    const commands = [];
    for (const format of formatsOf(test)) {
      const result = await run(oxlint, path.join(directory, "project"), test, format);
      const name = path.join(directory, format ?? "no-format");
      fs.writeFileSync(`${name}.stdout`, result.stdout);
      fs.writeFileSync(`${name}.stderr`, result.stderr);
      fs.writeFileSync(`${name}.exit`, `${result.status}\n`);
      commands.push(`oxlint ${result.args.join(" ")}`);
    }
    const env = Object.entries({ NO_COLOR: "1", ...test.env }).filter(([, value]) => value !== undefined);
    fs.writeFileSync(path.join(directory, "command.txt"), `${test.name}\ncwd: project/${test.cwd ?? ""}\nenv: ${env.map(([key, value]) => `${key}=${value}`).join(" ")}\n${commands.join("\n")}\n`);
    // A run can have written to the project.
    write(path.join(directory, "project"), test.files);
  }
  console.log(`${chosen.length} cases below ${record}`);
  process.exit(0);
}

// Both run in the same directory, one after the other: paths are part of the output. Eight directories at a time.
const jobs = chosen.flatMap(test => formatsOf(test).map(format => ({ test, format })));
let next = 0;
async function work(_, lane) {
  const root = path.join(path.resolve(flag("scratch")), `oxlint-formats-${lane}`);
  for (let job; (job = jobs[next++]); ) {
    job.expected = comparable(await run(oxlint, root, job.test, job.format), job.format, job.test);
    job.actual = comparable(await run(bin, root, job.test, job.format), job.format, job.test);
  }
  fs.rmSync(root, { recursive: true, force: true });
}
await Promise.all(Array.from({ length: 8 }, work));

const table = {};
let failed = 0;
for (const { test, format, expected, actual } of jobs) {
  const row = (table[format ?? "(none)"] ??= { inputs: 0, "the same": 0, differ: 0 });
  row.inputs++;
  const differences = Object.keys(expected).filter(key => expected[key] !== actual[key]);
  if (differences.length === 0) {
    row["the same"]++;
    continue;
  }
  row.differ++;
  failed++;
  console.log(`FAIL ${format ?? "(none)"}: ${test.name}: ${differences.join(", ")}`);
  if (show) for (const key of differences) console.log(`${key}\n${difference(expected[key], actual[key])}`);
}
console.table(table);
console.log(`oxlint formats: ${jobs.length - failed} of ${jobs.length} agree`);
process.exit(failed ? 1 : 0);
