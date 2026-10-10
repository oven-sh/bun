// Inputs on which `bun lint` once crashed, ran out of memory or took time in proportion to the square (or worse) of their size.
// robustness.test.ts runs them with `bun lint`, check.ts with any `bun-lint` executable.
//
// A case says what is reported, not how long it takes. Its size is such that the code as it was before overflows the stack, exceeds
// the memory limit or needs many times the time limit, and the code as it is needs a small part of a second in a release build.

import { cases as reactCompiler } from "./shapes-react-compiler";

/** `text` n times. `"".repeat` is slow in a debug build of JavaScriptCore. */
const rep = (text: string, n: number) => Buffer.alloc(Buffer.byteLength(text) * n, text).toString();
const seq = (n: number, f: (i: number) => string, separator = "") => {
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i++) parts[i] = f(i);
  return parts.join(separator);
};

export type Case = {
  name: string;
  /** The name of the file that is linted. */
  file: string;
  text: () => string;
  /** Of `.oxlintrc.json`, or with `eslint: true` of `eslint.config.js`. */
  rules: Record<string, unknown>;
  eslint?: boolean;
  /** Comments that disable nothing are errors. */
  reportsUnusedDirectives?: boolean;
  args?: string[];
  /** How many lines of `-f unix` name each rule, or what else the output is to match. */
  reports?: Record<string, number>;
  matches?: RegExp;
  lacks?: RegExp;
  /** How often the file matches this when the command has run. */
  keeps?: [RegExp, number];
  /** How many bytes the file has when the command has run. `"as before"`: it is also the same text. */
  length?: number | "as before";
  /** Several: any of them, where the size of the stack decides how the run ends. */
  exitCode: number | number[];
  /** It takes hundreds of megabytes, or more than three seconds in a debug build: not for a debug build or one with a sanitizer. */
  isHeavy?: boolean;
  /** It takes more than half a second in a release build: for check.ts alone. */
  isSlow?: boolean;
  /** It fails, and what it takes to pass. For check.ts alone until then. */
  waitsFor?: string;
};

const fn = (body: string) => `function f(a, b) {\n${body}\n}\n`;
/** A parser as PEG.js generates it: rules that call each other in a ring, collect what they get in arrays, in loops, and one of them tries `alternatives` one after the other. */
const generatedParser = (alternatives: number) => {
  let tried = "(J = r, J !== r ? (O = J) : (W = O, O = r))";
  for (let i = 1; i < alternatives; i++) tried = `(J = r, J !== r ? (O = J) : (W = O, O = r), O === r && ${tried})`;
  return `export function parse() {
  var r = {}, W = 0, A = function (O: unknown) {}, A2 = function (O: unknown, J: unknown) {};
  function start() { many(); }
  function list() { var O, re, de; if (re = []) for (; de !== r;) re.push(de), de = item(); else re = r; return O; }
  function item() { var J, re; return re = many(), J = A(re); }
  function many() { var J, re; for (; re !== r;) re = choice(); return J !== r && (J = A(J)); }
  function choice() { var O, J; return O === r && (J = rule()); }
  function rule() { var O, J, re, Ke; return Ke = list(), J = A2(re, Ke), O = J, O === r && ${tried}; }
  return start();
}
`;
};
const typed = ["--type-aware", "-f", "unix"];

export const cases: Case[] = [
  // ── the stack ──
  {
    name: "a chain of 100,000 logical operators",
    isHeavy: true,
    file: "a.js",
    text: () => `if (${rep("a && ", 100_000)}a) {}\nx = ${rep("a || b && ", 50_000)}a;\n`,
    rules: { "no-constant-binary-expression": "error", "no-constant-condition": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "an import of a path with 30,000 segments",
    file: "a.ts",
    text: () => `import "./${rep("a/", 30_000)}a";\nexport {};\n`,
    rules: { "typescript/no-floating-promises": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "an array type with 30,000 suffixes in a parameter of a function type",
    file: "a.ts",
    text: () => `export type A = (a: B${rep("[]", 30_000)}) => void;\n`,
    rules: { "typescript/no-unused-vars": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "a concatenation of 40,000 strings and variables is turned into a template",
    file: "a.js",
    text: () => `x = ${rep('"a" + b + ', 20_000)}"a";\n`,
    rules: { "prefer-template": "error" },
    args: ["--fix-dry-run"],
    reports: {},
    exitCode: 0,
  },
  {
    name: "a pattern that is nested as deeply as the parser allows",
    file: "a.js",
    text: () => `const ${rep("[", 29_000)}a${rep("]", 29_000)} = b; a = 1;\n`,
    rules: { "no-const-assign": "error", "no-dupe-args": "error" },
    // How deep that is depends on the size of the stack frames of the build.
    matches: /re-assignment of `const` variable a|nested too deeply/,
    exitCode: 1,
  },
  {
    name: "100,000 signs that begin a decorator",
    file: "a.js",
    text: () => `${rep("@", 100_000)}\n`,
    rules: { "no-debugger": "error" },
    matches: /nested too deeply/,
    exitCode: 1,
  },
  {
    // Each level took three times as long as the one in it. No deeper: a debug build has large frames.
    name: "a mapped type in parentheses in the as clause of the next, 40 deep",
    file: "a.ts",
    text: () => `export type X = ${rep("({[K in a as ", 40)}x${rep("]: b})", 40)};\n`,
    rules: { "no-debugger": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "30,000 modifiers that start no declaration",
    file: "a.ts",
    text: () => `${rep("accessor ", 30_000)}a\n`,
    rules: { "no-debugger": "error" },
    matches: /^a\.ts:\d+:\d+: .* \[Error\]$/m,
    exitCode: 1,
  },
  {
    name: "800 speculative parses, each with the errors of those in it",
    file: "a.ts",
    text: () => `x = ${rep("new a<", 800)}A${rep(">()", 800)};\n`,
    rules: { "no-debugger": "error" },
    matches: /^a\.ts:\d+:\d+: .* \[Error\]$/m,
    exitCode: 1,
  },
  {
    name: "20,000 comments before the first token",
    file: "a.js",
    text: () => `${rep("// a\n/* b */ ", 10_000)}debugger;\n`,
    rules: { "no-debugger": "error" },
    reports: { "no-debugger": 1 },
    exitCode: 1,
  },

  {
    name: "a constant behind 27,000 operators, and one that 44,000 assignments pass on",
    file: "a.js",
    text: () => `if (${rep("!", 27_000)}1) {}\nif ((${rep("a = ", 44_000)}1)) {}\n`,
    rules: { "no-constant-condition": "error" },
    // How deep the parser goes depends on the size of the stack frames of the build.
    matches: /Unexpected constant condition|nested too deeply/,
    exitCode: 1,
  },
  {
    name: "an assignment to a member at the end of 100,000 dots",
    file: "a.js",
    text: () => `a${rep(".b", 100_000)} = x;\n`,
    rules: { "no-debugger": "error" },
    reports: {},
    exitCode: 0,
  },

  // ── more than the square ──
  {
    name: "40 constants that are each the sum of the one before with itself",
    file: "a.js",
    text: () => `const v0 = "a";\n${seq(40, i => `const v${i + 1} = v${i} + v${i};\n`)}v40.at(0);\n`,
    rules: { "node/no-unsupported-features/es-syntax": "error" },
    matches: /^/,
    exitCode: 0,
  },
  {
    name: "4,000 assignments to one variable in branches",
    file: "a.js",
    text: () => fn(`let v = 0;\n${rep("if (a) { v = 1; }\n", 4_000)}return v;`),
    rules: { "no-useless-assignment": "error" },
    reports: {},
    exitCode: 0,
  },

  // ── what a rule can report ──
  {
    name: "a rule that reports each pair stops at 65,536 problems and says so",
    isHeavy: true,
    file: "a.js",
    text: () => fn(rep("for (var i = 0; i < 10; i++) { b(() => i); }\n", 2_000)),
    rules: { "block-scoped-var": "error" },
    reports: { "block-scoped-var": 65_537 },
    matches: /This rule reported more than 65,536 problems in this file\. The rest are not shown\./,
    exitCode: 1,
  },

  // ── what is cut, and the comments that disable ──
  ...[false, true].flatMap((eslint): Case[] => {
    const flavor = eslint ? "ESLint" : "oxlint";
    const disabled = "a == b; // eslint-disable-line eqeqeq\n";
    // Each line has 4,000 array types in each other, whose messages quote them: 30 MB. 16 lines have fewer than 65,536 reports.
    const arrays = `let a: T${rep("[]", 4_000)}; // eslint-disable-line @typescript-eslint/array-type\n`;
    const arrayType = {
      [eslint ? "@typescript-eslint/array-type" : "typescript/array-type"]: ["error", { default: "generic" }],
    };
    const common = { eslint, reportsUnusedDirectives: true, lacks: /Unused eslint-disable/ };
    return [
      {
        ...common,
        name: `${flavor}: that reports are missing is said, whatever comment is where the first of them would be`,
        isHeavy: true,
        file: "a.js",
        text: () => rep(`${disabled}c == d;\n`, 40_000),
        rules: { eqeqeq: "error" },
        reports: { eqeqeq: 32_769 },
        matches: /This rule reported more than 65,536 problems/,
        exitCode: 1,
      },
      {
        ...common,
        name: `${flavor}: 70,000 comments that each disable a problem are all in use`,
        isHeavy: true,
        file: "a.js",
        text: () => rep(disabled, 70_000),
        rules: { eqeqeq: "error" },
        reports: {},
        exitCode: 0,
      },
      {
        ...common,
        name: `${flavor}: --fix removes none of 70,000 comments that are in use`,
        isHeavy: !eslint,
        file: "a.js",
        text: () => rep(disabled, 70_000),
        rules: { eqeqeq: "error" },
        args: ["--fix", "-f", "unix"],
        reports: {},
        keeps: [/eslint-disable-line eqeqeq/g, 70_000],
        exitCode: 0,
      },
      {
        ...common,
        name: `${flavor}: that reports are missing is said if those that are kept are all in a part in which the rule is disabled`,
        isHeavy: eslint,
        file: "a.js",
        text: () =>
          `/* eslint-disable eqeqeq */\n${rep("a == b;\n", 70_000)}/* eslint-enable eqeqeq */\n${rep("c == d;\n", 10)}`,
        rules: { eqeqeq: "error" },
        reports: { eqeqeq: 1 },
        matches: /This rule reported more than 65,536 problems/,
        exitCode: 1,
      },
      {
        ...common,
        // Whether anything is wrong with the rest is not known.
        name: `${flavor}: and also if nothing is wrong with the rest`,
        isHeavy: eslint,
        file: "a.js",
        text: () => `/* eslint-disable eqeqeq */\n${rep("a == b;\n", 70_000)}/* eslint-enable eqeqeq */\nc === d;\n`,
        rules: { eqeqeq: "error" },
        reports: { eqeqeq: 1 },
        matches: /This rule reported more than 65,536 problems/,
        exitCode: 1,
      },
      {
        ...common,
        name: `${flavor}: and also if there is code before the comment that disables the rule`,
        isHeavy: eslint,
        file: "a.js",
        text: () => `"use strict";\n/* eslint-disable eqeqeq */\n${rep("a == b;\n", 70_000)}`,
        rules: { eqeqeq: "error" },
        reports: { eqeqeq: 1 },
        matches: /This rule reported more than 65,536 problems/,
        exitCode: 1,
      },
      {
        ...common,
        name: `${flavor}: it is not said if the rule is disabled from the first token to the last`,
        isHeavy: eslint,
        file: "a.js",
        text: () => `// A comment.\n\n/* eslint-disable eqeqeq */\n${rep("a == b;\n", 70_000)}\n// Another.\n`,
        rules: { eqeqeq: "error" },
        reports: {},
        exitCode: 0,
      },
      {
        ...common,
        name: `${flavor}: by bytes: that reports are missing is said`,
        file: "a.ts",
        text: () => rep(`${arrays}let b: U[];\n`, 16),
        rules: arrayType,
        isHeavy: true,
        matches: /take more than 256 MB with their fixes/,
        exitCode: 1,
      },
      {
        ...common,
        name: `${flavor}: by bytes: 16 comments that each disable 4,000 problems are all in use`,
        file: "a.ts",
        text: () => rep(arrays, 16),
        rules: arrayType,
        isHeavy: true,
        reports: {},
        exitCode: 0,
      },
      {
        ...common,
        name: `${flavor}: by bytes: --fix removes none of 16 comments that are in use`,
        file: "a.ts",
        text: () => rep(arrays, 16),
        rules: arrayType,
        isHeavy: true,
        args: ["--fix", "-f", "unix"],
        keeps: [/eslint-disable-line/g, 16],
        exitCode: 0,
      },
    ];
  }),

  // ── fixes that make a file much larger ──
  ...[false, true].flatMap((eslint): Case[] => {
    const flavor = eslint ? "ESLint" : "oxlint";
    // With a line for each part, and each `?` indented by four more than the one before: 4n² + 12n + 7 bytes.
    // oxlint fixes once, so there each part has its line already, and `indent` does the rest.
    const ternaries = (n: number) => `x = ${rep(eslint ? "a ? b : " : "a\n? b\n: ", n)}c;\n`;
    const rules = { indent: "error", "multiline-ternary": "error", "brace-style": "error" };
    const given = /Fixes would grow this file from \d+ KB to more than 64 MB\. It is left as it is\./;
    return [
      {
        name: `${flavor}: fixes that make 32 KB a little less than 64 MB are made`,
        file: "a.js",
        text: () => ternaries(4_094),
        eslint,
        rules,
        isSlow: true,
        args: ["--fix", "-f", "unix"],
        lacks: given,
        length: 67_092_479,
        exitCode: 0,
      },
      {
        name: `${flavor}: fixes that make 32 KB a little more than 64 MB are not made, which is said`,
        file: "a.js",
        text: () => ternaries(4_095),
        eslint,
        rules,
        isHeavy: true,
        args: ["--fix", "-f", "unix"],
        matches: given,
        length: "as before",
        exitCode: 1,
      },
      {
        name: `${flavor}: nor are they printed`,
        file: "a.js",
        text: () => ternaries(4_095),
        eslint,
        rules,
        isHeavy: true,
        args: ["--fix-dry-run", "-f", eslint ? "json" : "unix"],
        matches: given,
        lacks: /"output":/,
        length: "as before",
        exitCode: 1,
      },
      {
        name: `${flavor}: 9,000 statements in each other are not indented`,
        file: "a.js",
        text: () => `${rep(eslint ? "if (a) { " : "if (a) {\n", 9_000)}b();${rep(eslint ? " }" : "\n}", 9_000)}\n`,
        eslint,
        rules,
        isSlow: true,
        args: ["--fix", "-f", "unix"],
        // How deep the parser goes depends on the size of the stack frames of the build.
        matches: /Fixes would grow this file from \d+ KB to more than 64 MB|nested too deeply/,
        length: "as before",
        exitCode: 1,
      },
      {
        name: `${flavor}: a file that fixes make twice as large is fixed`,
        isHeavy: eslint,
        file: "a.js",
        text: () => `function f() {\n${rep("a;\n", 1_000)}}\n`,
        eslint,
        rules,
        args: ["--fix", "-f", "unix"],
        reports: {},
        keeps: [/^    a;$/gm, 1_000],
        length: 7_017,
        exitCode: 0,
      },
    ];
  }),

  // ── lists ──
  {
    name: "20,000 getters and setters in a class",
    isHeavy: true,
    file: "a.js",
    text: () =>
      `class A {\n${seq(20_000, i => `get p${i}() { return 1; }\n`)}${seq(20_000, i => `set p${i}(v) {}\n`)}}\n`,
    rules: { "grouped-accessor-pairs": "error", "accessor-pairs": "error", "no-dupe-class-members": "error" },
    reports: { "grouped-accessor-pairs": 20_000 },
    exitCode: 1,
  },
  {
    name: "65,000 clauses in a switch",
    isHeavy: true,
    file: "a.js",
    text: () => fn(`switch (a) {\n${seq(65_000, i => `case "k${i}": b(); break;\n`)}}`),
    rules: { "no-duplicate-case": "error", "max-statements-per-line": "error", "no-fallthrough": "error" },
    reports: { "max-statements-per-line": 65_000 },
    exitCode: 1,
  },
  {
    name: "65,000 declarators in one declaration",
    isHeavy: true,
    file: "a.js",
    text: () => `let ${seq(65_000, i => `v${i} = ${i}`, ", ")};\n`,
    rules: { "prefer-const": "error" },
    reports: { "prefer-const": 65_000 },
    exitCode: 1,
  },
  {
    name: "120,000 directives",
    isHeavy: true,
    file: "a.js",
    text: () => rep('"use strict";\n', 120_000),
    rules: { "no-unused-expressions": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "60,000 functions between commas",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep("(function () {}), ", 60_000)}a;\n`,
    rules: { "func-names": "error" },
    reports: { "func-names": 60_000 },
    exitCode: 1,
  },
  {
    name: "60,000 runs of spaces in one block",
    isHeavy: true,
    file: "a.js",
    text: () => rep("a  (b);\n", 60_000),
    rules: { "no-multi-spaces": "error" },
    reports: { "no-multi-spaces": 60_000 },
    exitCode: 1,
  },

  // ── regular expressions ──
  {
    name: "60,000 groups with names and as many references to them",
    isHeavy: true,
    file: "a.js",
    text: () => `x = /${seq(60_000, i => `(?<g${i}>a)\\k<g${i}>`)}/;\n`,
    rules: { "no-invalid-regexp": "error", "no-useless-backreference": "error", "no-empty-character-class": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "90,000 groups of one name in as many alternatives",
    isHeavy: true,
    file: "a.js",
    text: () => `x = /(?:${rep("(?<g>a)|", 90_000)}b)/;\n`,
    rules: { "prefer-named-capture-group": "error", "no-useless-backreference": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "a pattern in a comment that splits a line of 3,000 characters in four in every way",
    waitsFor: "a limit on the steps of a search in JavaScriptCore's interpreter, which counts only attempts at groups: it does not end",
    file: "a.js",
    text: () => `/* eslint max-len: ["error", { "code": 10, "ignorePattern": ".*.*.*.*x" }] */\n// ${rep("a", 3_000)}\n`,
    rules: {},
    eslint: true,
    reports: { "max-len": 1 },
    exitCode: 1,
  },

  // ── comments ──
  {
    name: "a comment that declares 65,000 globals",
    isHeavy: true,
    // oxlint does not read such comments.
    eslint: true,
    file: "a.js",
    text: () => `/* global ${seq(65_000, i => `g${i}`, ", ")} */\n${seq(65_000, i => `f(g${i});\n`)}`,
    rules: { "no-undef": "error" },
    reports: { "no-undef": 65_000 },
    exitCode: 1,
  },

  // ── one long line, and the formats ──
  {
    name: "40,000 problems on one line that is not ASCII",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep('a == "é😀"; ', 40_000)}\n`,
    rules: { eqeqeq: "error" },
    reports: { eqeqeq: 40_000 },
    exitCode: 1,
  },
  {
    name: "oxlint's json of 40,000 problems on one line",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep('a == "é😀"; ', 40_000)}\n`,
    rules: { eqeqeq: "error" },
    args: ["-f", "json"],
    // The last operator: a statement has 15 bytes, and 12 UTF-16 code units.
    matches: /"span": \{"offset": 599987,"length": 2,"line": 1,"column": 599988\}/,
    exitCode: 1,
  },
  {
    name: "every one of 60,000 problems with the lines around it",
    isHeavy: true,
    file: "a.js",
    text: () => rep("a == b;\n", 60_000),
    rules: { eqeqeq: "error" },
    // oxlint's `agent` has a line for a problem, without the code.
    eslint: true,
    args: ["-f", "agent", "--all"],
    matches: /line="60000" column="3"/,
    exitCode: 1,
  },

  // ══ the rules that need types ══
  // ── a body that is too large for control flow analysis (TS2563): every reference in it that would be narrowed has the error type ──
  ...((): Case[] => {
    const head = "export {};\ndeclare const a: boolean, b: number, p: Promise<void>; let x: number;\n";
    // Each of the three is reported, if `b` and `p` have their types.
    const three = "await b;\nx = b as number;\np;\n";
    const conditions = (n: number, name = "x") => rep(`if (a) { ${name} = 1; }\n`, n);
    const warning =
      /This file is too large for control flow analysis\. What rules that need types say about it may be wrong or incomplete\./;
    const [awaited, asserted, floating] = ["await-thenable", "no-unnecessary-type-assertion", "no-floating-promises"];
    const common = {
      file: "a.ts",
      rules: {
        [`typescript/${awaited}`]: "error",
        [`typescript/${asserted}`]: "error",
        [`typescript/${floating}`]: "error",
      },
      args: typed,
      // With the stack frames of a debug build the type checker overflows the stack from about 800 such statements on, in `bun check` too.
      isHeavy: true,
    };
    const all = {
      [`@typescript-eslint/${awaited}`]: 1,
      [`@typescript-eslint/${asserted}`]: 1,
      [`@typescript-eslint/${floating}`]: 1,
    };
    return [
      {
        ...common,
        name: "1,000 statements with a condition are not too many for the types",
        text: () => head + three + conditions(1_000),
        reports: all,
        lacks: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "what stands before 1,100 statements with a condition has its types, and the file a warning",
        text: () => head + three + conditions(1_100),
        reports: all,
        matches: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "what stands behind 1,100 statements with a condition has no types, which the warning says",
        text: () => head + conditions(1_100) + three,
        reports: {},
        matches: warning,
        exitCode: 0,
      },
      {
        ...common,
        name: "a function with 1,000 statements with a condition, about which a rule asks, gives the file the warning",
        text: () => `${head}function f() { let y: number = 0;\n${conditions(1_000, "y")}y as number; }\n${three}`,
        matches: warning,
        exitCode: 1,
      },
    ];
  })(),

  // ── fixes that make a file much larger, in the passes with types ──
  ...[380, 440].map((count): Case => {
    const isLeft = count === 440;
    return {
      name: `${count} statements of 200 conditions in each other, with types, are ${isLeft ? "left as they are" : "fixed"}`,
      file: "a.ts",
      text: () =>
        "export {};\ndeclare const a: boolean, b: number, c: number; let x: number;\nawait b;\nx = b as number;\n" +
        rep(`x = ${rep("a ? b : ", 200)}c;\n`, count),
      // With oxlint's configuration there is one pass.
      eslint: true,
      rules: {
        indent: "error",
        "multiline-ternary": "error",
        "@typescript-eslint/await-thenable": "error",
        "@typescript-eslint/no-unnecessary-type-assertion": "error",
      },
      isSlow: true,
      args: ["--type-aware", "--fix", "-f", "unix"],
      // That the rules with types report shows that these are the passes with types.
      matches: isLeft
        ? /Fixes would grow this file from 690 KB to more than 64 MB\. It is left as it is\./
        : /await-thenable/,
      keeps: [/b as number/g, isLeft ? 1 : 0],
      length: isLeft ? "as before" : 61_714_750,
      exitCode: 1,
    };
  }),

  // ── time that doubles with each line ──
  // Seven times as long for each alternative. Yarn's release bundle, which many repositories commit, has such a parser.
  ...["", "// @ts-nocheck\n"].map(
    (comment): Case => ({
      name: `a generated parser with a rule of 16 alternatives${comment && ", in a file that is not checked"}`,
      file: "a.ts",
      text: () => comment + generatedParser(16),
      rules: { "typescript/no-floating-promises": "error" },
      args: typed,
      reports: {},
      exitCode: 0,
    }),
  ),
  {
    name: "interfaces that extend each other in 60 diamonds",
    file: "a.ts",
    text: () =>
      "interface T0 { m(): void }\n" +
      seq(
        60,
        i =>
          `interface A${i} extends T${i} {}\ninterface B${i} extends T${i} {}\ninterface T${i + 1} extends A${i}, B${i} {}\n`,
      ) +
      "declare const o: T60;\no;\no.m;\nfunction f() { throw o; }\nfunction g() { return o; }\nPromise.reject(o);\n",
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/only-throw-error": "error",
      "typescript/unbound-method": "error",
      "typescript/promise-function-async": "error",
      "typescript/prefer-promise-reject-errors": "error",
    },
    args: typed,
    // The last is for `Promise.reject(o);`.
    reports: {
      "@typescript-eslint/unbound-method": 1,
      "@typescript-eslint/only-throw-error": 1,
      "@typescript-eslint/no-floating-promises": 1,
      "@typescript-eslint/prefer-promise-reject-errors": 1,
    },
    exitCode: 1,
  },
  {
    name: "40 diamonds on top of Promise and of Error",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      ["Promise<number>", "Error"]
        .map(
          (base, k) =>
            `interface T${k}_0 extends ${base} {}\n` +
            seq(
              40,
              i =>
                `interface A${k}_${i} extends T${k}_${i} {}\ninterface B${k}_${i} extends T${k}_${i} {}\ninterface T${k}_${i + 1} extends A${k}_${i}, B${k}_${i} {}\n`,
            ) +
            `declare const o${k}: T${k}_40;\no${k};\nfunction f${k}() { throw o${k}; }\nfunction g${k}() { return o${k}; }\n`,
        )
        .join(""),
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/only-throw-error": "error",
      "typescript/promise-function-async": "error",
    },
    args: typed,
    reports: {
      "@typescript-eslint/no-floating-promises": 1,
      "@typescript-eslint/only-throw-error": 1,
      "@typescript-eslint/promise-function-async": 1,
    },
    exitCode: 1,
  },
  {
    name: "a tuple of two of a tuple of two, 60 times",
    file: "a.ts",
    text: () =>
      "type T0 = string;\ntype M0 = string[];\n" +
      seq(60, i => `type T${i + 1} = readonly [T${i}, T${i}];\ntype M${i + 1} = readonly [M${i}, M${i}];\n`) +
      "function f(p: T60) {}\nfunction g(p: M60) {}\n",
    rules: { "typescript/prefer-readonly-parameter-types": "error" },
    args: typed,
    reports: { "@typescript-eslint/prefer-readonly-parameter-types": 1 },
    exitCode: 1,
  },
  {
    name: "two readonly tuple types that refer to each other",
    file: "a.ts",
    text: () =>
      "type T = readonly [T, U];\ntype U = readonly [T, readonly string[]];\nfunction f(p: T, q: U) {}\n" +
      "type V = readonly [V, W];\ntype W = readonly [V, string[]];\nfunction g(p: V, q: W) {}\n",
    rules: { "typescript/prefer-readonly-parameter-types": "error" },
    args: typed,
    reports: { "@typescript-eslint/prefer-readonly-parameter-types": 2 },
    exitCode: 1,
  },
  {
    name: "a tuple of two of a tuple of two, 40 times, of what may have no useful toString",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      "type T0 = {} | string;\n" +
      seq(40, i => `type T${i + 1} = [T${i}, T${i}];\n`) +
      "declare const o: T40;\n`${o}`;\no.join();\n",
    rules: { "typescript/no-base-to-string": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-base-to-string": 2 },
    exitCode: 1,
  },

  // ── the stack ──
  {
    name: "two chains of 8,000 calls, joined by &&",
    // With the larger stack frames of a debug build the rule gives up on a chain of this length, and reports nothing.
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `type R = () => R;\ndeclare const a: R;\nexport const x = a${rep("()", 8_000)} && a${rep("()", 8_000)}();\n`,
    rules: { "typescript/prefer-optional-chain": "error" },
    args: typed,
    reports: { "@typescript-eslint/prefer-optional-chain": 1 },
    exitCode: 1,
  },

  // ── time and memory ──
  {
    name: "60,000 declarations with the name of a type",
    isHeavy: true,
    file: "a.ts",
    text: () => "type T = 1;\n" + rep("let v: T;\n", 60_000),
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a union of 30,000 template literal types, and one of object types",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `export type A = ${seq(30_000, i => "`a${number}b" + i + "`", " | ")};\nexport type B = ${seq(30_000, i => `{a: ${i}}`, " | ")};\n`,
    rules: { "typescript/no-duplicate-type-constituents": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a class with 30,000 async methods that an interface declares as void",
    isSlow: true,
    file: "a.ts",
    text: () =>
      `interface I {${seq(30_000, i => `m${i}(): void`, "; ")}}\nexport class A implements I {\n${seq(30_000, i => `async m${i}() {}\n`)}}\n`,
    rules: { "typescript/no-misused-promises": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-misused-promises": 30_000 },
    exitCode: 1,
  },
  {
    name: "60,000 properties of one object, each before a ??",
    isSlow: true,
    file: "a.ts",
    text: () =>
      `declare const o: {${seq(60_000, i => `p${i}: string`, "; ")}};\n${seq(60_000, i => `o.p${i} ?? 1;\n`)}`,
    rules: { "typescript/no-unnecessary-condition": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-unnecessary-condition": 60_000 },
    exitCode: 1,
  },
  {
    name: "a predicate that returns a union of 100,000",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `type U = ${seq(100_000, i => `"s${i}"`, " | ")};\ndeclare const a: U[];\n${rep("a.filter(x => x);\n", 16)}`,
    rules: { "typescript/strict-boolean-expressions": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a constructor with 100,000 private parameter properties",
    isHeavy: true,
    file: "a.ts",
    text: () => `export class A { constructor(${seq(100_000, i => `private p${i}: number`, ", ")}) {} }\n`,
    rules: { "typescript/prefer-readonly": "error" },
    args: typed,
    matches: /prefer-readonly/,
    exitCode: 1,
  },
  {
    name: "assertions to a union of 8,000",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `type U = ${seq(8_000, i => `"s${i}"`, " | ")};\ndeclare const u: U | null, s: string;\n${rep("u as U; u!; s as U;\n", 500)}`,
    rules: { "typescript/no-unnecessary-type-assertion": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a callback with 200,000 parameters that have defaults",
    isSlow: true,
    file: "a.ts",
    text: () =>
      `declare function g(cb: (${seq(200_000, i => `p${i}: string`, ", ")}) => void): void;\ng((${seq(200_000, i => `p${i} = ''`, ", ")}) => {});\n`,
    rules: { "typescript/no-useless-default-assignment": "error" },
    args: typed,
    matches: /no-useless-default-assignment/,
    exitCode: 1,
  },
  {
    name: "a switch over an enum of 12,000 members",
    isSlow: true,
    file: "a.ts",
    text: () =>
      `enum E {${seq(12_000, i => `M${i}`, ", ")}}\ndeclare const u: E;\nswitch (u) {\n${seq(12_000, i => `case E.M${i}: break;\n`)}}\n`,
    rules: { "typescript/no-unsafe-enum-comparison": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "12,000 overloads, each with a type parameter",
    isHeavy: true,
    file: "a.ts",
    text: () => seq(12_000, i => `export function f<T${i}>(a: string): void;\n`) + "export function f(a: any) {}\n",
    rules: { "typescript/no-unnecessary-type-parameters": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-unnecessary-type-parameters": 12_000 },
    exitCode: 1,
  },
  {
    name: "12,000 overloads with a callback, called 750 times with an async function",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      seq(12_000, i => `declare function g(a: ${i}, cb: () => void): void;\n`) +
      seq(750, i => `function f${i}() { g(0, async () => {}); }\n`),
    rules: { "typescript/no-misused-promises": "error", "typescript/strict-void-return": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-misused-promises": 750, "@typescript-eslint/strict-void-return": 750 },
    exitCode: 1,
  },
  {
    name: "a type with 8,000 properties, and a union of 8,000, that 8,000 functions take",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `type O = {${seq(8_000, i => `readonly p${i}: string`, "; ")}};\n` +
      `type U = ${seq(8_000, i => `{readonly p${i}: string}`, " | ")};\n` +
      seq(8_000, i => `export function f${i}(p: O, q: U) {}\n`),
    rules: { "typescript/prefer-readonly-parameter-types": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a union of 8,000 function types that is the type of 8,000 statements",
    isHeavy: true,
    file: "a.ts",
    text: () =>
      `declare const u: ${seq(8_000, i => `((a: ${i}) => Promise<${i}>)`, " | ")};\n` +
      seq(8_000, i => `function f${i}() { u; }\n`),
    rules: { "typescript/no-floating-promises": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "six chains of 9,000 property accesses on any",
    isHeavy: true,
    file: "a.ts",
    text: () => `declare const a: any;\n${rep(`a${rep(".b", 9_000)};\n`, 6)}`,
    rules: { "typescript/no-unsafe-member-access": "error", "typescript/no-deprecated": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-unsafe-member-access": 6 },
    exitCode: 1,
  },
  {
    name: "a sum of 100,000 names",
    isHeavy: true,
    file: "a.ts",
    text: () => `declare const a: number;\nexport const x = ${rep("a + ", 100_000)}a;\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a template literal type with 16,000 substitutions",
    isHeavy: true,
    file: "a.ts",
    text: () => "type B = 'b';\nexport type A = `" + rep("${B}", 16_000) + "`;\n",
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  // Up to some depth the types are computed, beyond another the parser refuses the file. Between the two the checker runs
  // out of stack, and where that is depends on the platform and the build: so every depth, and either end.
  ...[2_000, 3_000, 4_000, 5_000, 6_000, 6_500, 7_000, 7_500, 8_000].map(
    (depth): Case => ({
      name: `type arguments ${depth} deep, six times`,
      isHeavy: true,
      file: "a.ts",
      text: () => seq(6, i => `export type A${i} = ${rep("Array<", depth)}string${rep(">", depth)};\n`),
      rules: { "typescript/no-deprecated": "error" },
      args: typed,
      reports: {},
      exitCode: [0, 1],
    }),
  ),
  ...[5_000, 6_000, 6_500, 7_000, 7_500].map(
    (depth): Case => ({
      name: `tuple types ${depth} deep`,
      isHeavy: true,
      file: "a.ts",
      text: () => `export type A = ${rep("[", depth)}string${rep("]", depth)};\n`,
      rules: { "typescript/no-deprecated": "error" },
      args: typed,
      reports: {},
      exitCode: [0, 1],
    }),
  ),
  ...[4_000, 8_000, 12_000, 20_000, 40_000].map(
    (depth): Case => ({
      name: `${depth} indexed access types in a row`,
      isHeavy: true,
      file: "a.ts",
      text: () => `export type A = string${rep('["length"]', depth)};\n`,
      rules: { "typescript/no-deprecated": "error" },
      args: typed,
      reports: {},
      exitCode: [0, 1],
    }),
  ),
  {
    name: "100,000 commas in a row, with types",
    isHeavy: true,
    file: "a.ts",
    text: () => `export const a = (${rep("1, ", 100_000)}1);\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    // Each starts where the first does and ends further on, all on one line.
    name: "100,000 commas in a row, and the type errors",
    isHeavy: true,
    file: "a.ts",
    text: () => `export const a = (${rep("1, ", 100_000)}1);\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: ["--type-check", ...typed],
    matches: /^100000 problems$/m,
    exitCode: 1,
  },
  {
    name: "a regular expression in a variable that 30,000 functions match with",
    isHeavy: true,
    file: "a.ts",
    text: () => "const r = /a/;\n" + seq(30_000, i => `export function f${i}(s: string) { s.match(r); }\n`),
    rules: { "typescript/prefer-regexp-exec": "error" },
    args: typed,
    reports: { "@typescript-eslint/prefer-regexp-exec": 30_000 },
    exitCode: 1,
  },
  {
    name: "intersection types 1,200 deep",
    isSlow: true,
    file: "a.ts",
    text: () => `export type A = ${rep("{a: 1} & ({a: 1} & ", 1_200)}{b: 1}${rep(")", 1_200)};\n`,
    rules: { "typescript/no-duplicate-type-constituents": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-duplicate-type-constituents": 2_399 },
    exitCode: 1,
  },
  {
    name: "a function with 200,000 parameters",
    isHeavy: true,
    file: "a.js",
    text: () => `function f(${seq(200_000, i => `b${i}`, ", ")}) {}\nfunction g({ ${seq(200_000, i => `b${i}`, ", ")} }) {}\n`,
    rules: {},
    eslint: true,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a function with 200,000 parameters, the last of which is there twice",
    isHeavy: true,
    file: "a.js",
    text: () => `function f(${seq(200_000, i => `b${i}`, ", ")}, b7 = 1) {}\n`,
    rules: {},
    eslint: true,
    // Where espree says it.
    matches: /a\.js:1:1688902: Parsing error: Argument name clash \[Error\]$/m,
    exitCode: 1,
  },
  // ── a number in the options that is the length of a text ──
  {
    name: "2 ** 53 empty lines after an import",
    file: "a.js",
    text: () => 'import "a";\nfoo();\n',
    rules: { "import/newline-after-import": ["error", { count: 2 ** 53 }] },
    args: ["--fix", "-f", "unix"],
    reports: { "import/newline-after-import": 1 },
    length: "as before",
    exitCode: 1,
  },
  {
    name: "2 ** 53 empty lines after an import, in the format for a person, which reads the fixes",
    file: "a.js",
    text: () => 'import "a";\nfoo();\n',
    rules: { "import/newline-after-import": ["error", { count: 2 ** 53 }] },
    args: [],
    matches: /Expected 9007199254740992 empty lines after import statement/,
    exitCode: 1,
  },
  {
    name: "an indentation of 2 ** 31 spaces: the rule throws, as ESLint's",
    file: "a.js",
    text: () => "if (a) {\n  b();\n}\n",
    rules: { indent: ["error", 2 ** 31] },
    eslint: true,
    args: ["--fix", "-f", "unix"],
    reports: {},
    length: "as before",
    exitCode: 2,
  },
  {
    name: "2,000 lines with an indentation of 2 ** 28 spaces, which JavaScript has",
    file: "a.js",
    text: () => `if (a) {\n${rep("  b();\n", 2_000)}}\n`,
    rules: { indent: ["error", 2 ** 28] },
    eslint: true,
    args: ["--fix", "-f", "unix"],
    reports: { indent: 2_000 },
    length: "as before",
    exitCode: 1,
  },
  // ── eslint-plugin-react: what many components share, and what is asked once for each of them ──
  {
    name: "5,000 components with one object of 5,000 prop types",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `import T from "prop-types";\nconst t = {${seq(5_000, i => `a${i}: T.any`, ",")}};\n` +
      seq(5_000, i => `function C${i}(props) { return <a/>; }\nC${i}.propTypes = t;\n`),
    rules: { "react/no-unused-prop-types": "error" },
    reports: { "react/no-unused-prop-types": 65_537 },
    exitCode: 1,
  },
  {
    name: "5,000 components with one interface of 5,000 members",
    isHeavy: true,
    file: "a.tsx",
    text: () =>
      `interface P {${seq(5_000, i => `a${i}?: string`, ";")}}\n` +
      seq(5_000, i => `function C${i}(props: P) { return <a/>; }\n`),
    rules: { "react/prefer-read-only-props": "error" },
    reports: { "react/prefer-read-only-props": 65_537 },
    exitCode: 1,
  },
  {
    name: "5,000 components with one object of 5,000 default props",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `import T from "prop-types";\nconst d = {${seq(5_000, i => `a${i}: 1`, ",")}};\n` +
      seq(5_000, i => `function C${i}(props) { return <a/>; }\nC${i}.propTypes = { x: T.any };\nC${i}.defaultProps = d;\n`),
    rules: { "react/default-props-match-prop-types": "error" },
    reports: { "react/default-props-match-prop-types": 65_537 },
    exitCode: 1,
  },
  {
    name: "5,000 prop types that are one shape of 5,000",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `import T from "prop-types";\nconst s = T.shape({${seq(5_000, i => `b${i}: T.any`, ",")}});\n` +
      `function C(props) { return <a/>; }\nC.propTypes = {${seq(5_000, i => `a${i}: s`, ",")}};\n`,
    rules: { "react/no-unused-prop-types": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "30,000 components that are properties of one object, each with its prop types",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `const A = {${seq(30_000, i => `p${i}: () => <a/>`, ",")}};\n` + seq(30_000, i => `A.p${i}.propTypes = {};\n`),
    rules: { "react/prop-types": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "60,000 components in React.memo",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `import React from "react";\n` + seq(60_000, i => `const C${i} = React.memo((props) => <a>{props.x}</a>);\n`),
    rules: { "react/prop-types": "error" },
    reports: { "react/prop-types": 60_000 },
    exitCode: 1,
  },
  {
    name: "60,000 components whose props are the ReturnType of a member",
    isHeavy: true,
    file: "a.tsx",
    text: () =>
      `const a = { b: () => ({ x: 1 }) };\n` +
      seq(60_000, i => `function C${i}(props: ReturnType<typeof a.b>) { return <a/>; }\n`),
    rules: { "react/prop-types": "error" },
    reports: {},
    exitCode: 0,
  },
  // ── the type checker alone: the rule asks for nothing ──
  ...(
    [
      ["120,000 call statements in a row", false, () => "declare const a: any;\n" + rep("a();\n", 120_000)],
      [
        "a variable with 24,000 assignments that 24,000 functions refer to",
        false,
        () =>
          `export function f() {\n  let v = 0;\n${seq(24_000, i => `  { { { { { { v = ${i}; } } } } } }\n`)}` +
          `  return [\n${rep("    () => v,\n", 24_000)}  ];\n}\n`,
      ],
      [
        "an array literal with 60,000 functions, for an array type",
        false,
        () => `export const a: readonly (() => void)[] = [\n${rep("  () => {},\n", 60_000)}];\n`,
      ],
      [
        "a pattern with 120,000 properties",
        false,
        () => `export const {\n${seq(120_000, i => `  p${i} = 0,\n`)}} = {};\n`,
      ],
      ["array literals 1,200 deep", true, () => `export default ${rep("[", 1_200)}${rep("]", 1_200)};\n`],
      [
        "a diamond of 6,000 interfaces",
        true,
        () =>
          "interface T0 { m(): void }\n" +
          seq(
            2_000,
            i =>
              `interface A${i} extends T${i} {}\ninterface B${i} extends T${i} {}\n` +
              `interface T${i + 1} extends A${i}, B${i} {}\n`,
          ) +
          "export declare const o: T2000;\n",
      ],
    ] as const
  ).map(
    ([name, isSlow, text]): Case => ({
      name,
      isHeavy: true,
      isSlow,
      file: "a.ts",
      text,
      rules: { "typescript/await-thenable": "error" },
      args: typed,
      reports: {},
      exitCode: 0,
    }),
  ),
  ...reactCompiler,
];
