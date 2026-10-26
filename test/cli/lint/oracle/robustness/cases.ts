// Inputs that once made `bun lint` crash, run out of memory, or take quadratic (or worse) time.
// robustness.test.ts runs them.
//
// A case specifies what's reported, not how long it takes. Each input is large enough that the old code overflows the
// stack, exceeds the memory limit or takes many times the time limit, while the current code takes a fraction of a
// second in a release build.

import { cases as reactCompiler } from "./shapes-react-compiler";

/** Repeats `text` n times. `"".repeat` is slow in a debug build of JavaScriptCore. */
const rep = (text: string, n: number) => Buffer.alloc(Buffer.byteLength(text) * n, text).toString();
const seq = (n: number, f: (i: number) => string, separator = "") => {
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i++) parts[i] = f(i);
  return parts.join(separator);
};

export type Case = {
  name: string;
  /** The file to lint. */
  file: string;
  text: () => string;
  /** The `rules` in `.oxlintrc.json`, or in `eslint.config.js` with `eslint: true`. */
  rules: Record<string, unknown>;
  eslint?: boolean;
  /** Report unused disable comments as errors. */
  reportsUnusedDirectives?: boolean;
  args?: string[];
  /** `compilerOptions` for a `tsconfig.json`. Without them, no `tsconfig.json` is written. */
  compilerOptions?: Record<string, unknown>;
  /** The expected number of `-f unix` lines per rule. */
  reports?: Record<string, number>;
  /** The output may match this instead of `reports`. Which one happens depends on the stack size. */
  orWarns?: RegExp;
  matches?: RegExp;
  lacks?: RegExp;
  /** The number of times the file matches this after the run. */
  keeps?: [RegExp, number];
  /** The file's size in bytes after the run. `"as before"` means the text is unchanged. */
  length?: number | "as before";
  /** With several, any of them is accepted, for cases whose outcome depends on the stack size. */
  exitCode: number | number[];
  /** Takes hundreds of megabytes, or over three seconds in a debug build, so debug and sanitizer builds skip it. */
  isHeavy?: boolean;
};

const fn = (body: string) => `function f(a, b) {\n${body}\n}\n`;
/**
 * A parser like the ones PEG.js generates. Its rules call each other in a cycle and collect results into arrays in
 * loops, and one rule tries `alternatives` alternatives in sequence.
 */
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
  // ── stack depth ──
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
  // At every nesting level, the type checker repeated the work it had already given up on at the previous level. That
  // took minutes to days.
  ...(
    [
      ["calls", "f(", ")"],
      ["array literals", "[", "]"],
      ["object literals", "{ a: ", " }"],
    ] as const
  ).map(([what, open, close]): Case => ({
    name: `3,000 nested ${what} with a type-aware rule`,
    isHeavy: true,
    file: "a.ts",
    text: () => `declare const f: any;\nexport const r = ${rep(open, 3_000)}1${rep(close, 3_000)};\n`,
    rules: { "typescript/no-floating-promises": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  })),
  {
    name: "an array type with 30,000 `[]` suffixes in a function type's parameter",
    file: "a.ts",
    text: () => `export type A = (a: B${rep("[]", 30_000)}) => void;\n`,
    rules: { "typescript/no-unused-vars": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "--fix-dry-run turns a concatenation of 40,000 strings and variables into a template literal",
    file: "a.js",
    text: () => `x = ${rep('"a" + b + ', 20_000)}"a";\n`,
    rules: { "prefer-template": "error" },
    args: ["--fix-dry-run"],
    reports: {},
    exitCode: 0,
  },
  {
    name: "a destructuring pattern nested as deeply as the parser allows",
    file: "a.js",
    text: () => `const ${rep("[", 29_000)}a${rep("]", 29_000)} = b; a = 1;\n`,
    rules: { "no-const-assign": "error", "no-dupe-args": "error" },
    // The parser's depth limit depends on the build's stack frame size.
    matches: /re-assignment of `const` variable a|nested too deeply/,
    exitCode: 1,
  },
  {
    name: "100,000 `@` in a row",
    file: "a.js",
    text: () => `${rep("@", 100_000)}\n`,
    rules: { "no-debugger": "error" },
    matches: /nested too deeply/,
    exitCode: 1,
  },
  {
    // Each level took three times as long as the level inside it. It isn't deeper because a debug build has large stack
    // frames.
    name: "parenthesized mapped types nested 40 deep in `as` clauses",
    file: "a.ts",
    text: () => `export type X = ${rep("({[K in a as ", 40)}x${rep("]: b})", 40)};\n`,
    rules: { "no-debugger": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "30,000 modifiers with no declaration after them",
    file: "a.ts",
    text: () => `${rep("accessor ", 30_000)}a\n`,
    rules: { "no-debugger": "error" },
    matches: /^a\.ts:\d+:\d+: .* \[Error\]$/m,
    exitCode: 1,
  },
  {
    name: "800 nested speculative parses, each with the errors of the ones inside it",
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
    name: "a constant after 27,000 `!` operators, and one at the end of 44,000 chained assignments",
    file: "a.js",
    text: () => `if (${rep("!", 27_000)}1) {}\nif ((${rep("a = ", 44_000)}1)) {}\n`,
    rules: { "no-constant-condition": "error" },
    // The parser's depth limit depends on the build's stack frame size.
    matches: /Unexpected constant condition|nested too deeply/,
    exitCode: 1,
  },
  {
    name: "an assignment to a chain of 100,000 property accesses",
    file: "a.js",
    text: () => `a${rep(".b", 100_000)} = x;\n`,
    rules: { "no-debugger": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "RegExp flags that are a concatenation of 1,000,000 constants",
    isHeavy: true,
    file: "a.js",
    text: () => `const g = "g";\nnew RegExp("a", ${rep("g + ", 1_000_000)}g);\n`,
    rules: { "require-unicode-regexp": "error" },
    // The evaluation gives up when it runs out of stack, so the flags are unknown.
    reports: {},
    exitCode: 0,
  },

  // ── worse than quadratic ──
  {
    name: "40 string constants, each the previous one concatenated with itself",
    file: "a.js",
    text: () => `const v0 = "a";\n${seq(40, i => `const v${i + 1} = v${i} + v${i};\n`)}v40.at(0);\n`,
    rules: { "node/no-unsupported-features/es-syntax": "error" },
    matches: /^/,
    exitCode: 1,
  },
  {
    name: "4,000 assignments to one variable in branches",
    file: "a.js",
    text: () => fn(`let v = 0;\n${rep("if (a) { v = 1; }\n", 4_000)}return v;`),
    rules: { "no-useless-assignment": "error" },
    reports: {},
    exitCode: 0,
  },

  // ── disable comments ──
  ...[false, true].flatMap((eslint): Case[] => {
    const flavor = eslint ? "ESLint" : "oxlint";
    const disabled = "a == b; // eslint-disable-line eqeqeq\n";
    const common = { eslint, reportsUnusedDirectives: true, lacks: /Unused eslint-disable/ };
    return [
      {
        ...common,
        name: `${flavor}: none of 70,000 disable comments that each suppress a problem is reported as unused`,
        isHeavy: true,
        file: "a.js",
        text: () => rep(disabled, 70_000),
        rules: { eqeqeq: "error" },
        reports: {},
        exitCode: 0,
      },
      {
        ...common,
        name: `${flavor}: --fix keeps all 70,000 disable comments that are in use`,
        isHeavy: !eslint,
        file: "a.js",
        text: () => rep(disabled, 70_000),
        rules: { eqeqeq: "error" },
        args: ["--fix", "-f", "unix"],
        reports: {},
        keeps: [/eslint-disable-line eqeqeq/g, 70_000],
        exitCode: 0,
      },
    ];
  }),

  // ── fixes that grow the file ──
  ...[false, true].flatMap((eslint): Case[] => {
    const flavor = eslint ? "ESLint" : "oxlint";
    const rules = { "no-implicit-coercion": "error" };
    return [
      {
        name: `${flavor}: --fix works when the fixes double the file's size`,
        isHeavy: eslint,
        file: "a.js",
        text: () => `function f(a) {\n${rep("!!a;\n", 1_000)}}\n`,
        eslint,
        rules,
        args: ["--fix", "-f", "unix"],
        reports: {},
        keeps: [/^Boolean\(a\);$/gm, 1_000],
        length: 12_018,
        exitCode: 0,
      },
    ];
  }),

  // ── long lists ──
  {
    name: "20,000 getters and setters in a class",
    isHeavy: true,
    file: "a.js",
    text: () =>
      `class A {\n${seq(20_000, i => `get p${i}() { return 1; }\n`)}${seq(20_000, i => `set p${i}(v) {}\n`)}}\n`,
    rules: { "no-dupe-class-members": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "a switch with 65,000 cases",
    isHeavy: true,
    file: "a.js",
    text: () => fn(`switch (a) {\n${seq(65_000, i => `case "k${i}": b(); break;\n`)}}`),
    rules: { "default-case": "error", "no-fallthrough": "error" },
    reports: { "default-case": 1 },
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
    name: "60,000 comma-separated function expressions",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep("(function () {}), ", 60_000)}a;\n`,
    rules: { "func-names": "error" },
    reports: { "func-names": 60_000 },
    exitCode: 1,
  },
  // ── sorting reports in oxlint's order, which looks up each problem's node again ──
  {
    name: "a chain of 60,000 comparisons, each reported at its operator",
    isHeavy: true,
    file: "a.js",
    text: () => `x = ${rep("a == ", 60_000)}a;\n`,
    rules: { "eqeqeq": "error" },
    reports: { "eqeqeq": 60_000 },
    exitCode: 1,
  },
  {
    name: "a sum of 60,001 numbers, all reported",
    isHeavy: true,
    file: "a.js",
    text: () => `x = ${rep("2 + ", 60_000)}2;\n`,
    rules: { "no-magic-numbers": "error" },
    reports: { "no-magic-numbers": 60_001 },
    exitCode: 1,
  },
  {
    name: "60,000 comma-separated function expressions, each reported at its name",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep("(function a() {}), ", 60_000)}a;\n`,
    rules: { "id-length": "error" },
    reports: { "id-length": 60_000 },
    exitCode: 1,
  },
  {
    name: "a chain of 60,000 calls, each with a reported argument",
    isHeavy: true,
    file: "a.js",
    text: () => `x${rep(".b(2)", 60_000)};\n`,
    rules: { "no-magic-numbers": "error" },
    reports: { "no-magic-numbers": 60_000 },
    exitCode: 1,
  },
  {
    name: "a chain of 60,000 property accesses, all reported",
    isHeavy: true,
    file: "a.js",
    text: () => `a${rep("._b", 60_000)};\n`,
    rules: { "no-underscore-dangle": "error" },
    reports: { "no-underscore-dangle": 60_000 },
    exitCode: 1,
  },
  {
    name: "an array of 60,000 comparisons, each reported at its operator",
    isHeavy: true,
    file: "a.js",
    text: () => `x = [${rep("a == a, ", 60_000)}];\n`,
    rules: { "eqeqeq": "error" },
    reports: { "eqeqeq": 60_000 },
    exitCode: 1,
  },
  {
    name: "10,000 chained assignments, all but the first reported",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep("a = ", 10_000)}2;\n`,
    rules: { "no-multi-assign": "error" },
    reports: { "no-multi-assign": 9_999 },
    exitCode: 1,
  },
  {
    name: "10,000 nested conditional expressions, each with a reported number",
    isHeavy: true,
    file: "a.js",
    text: () => `x = ${rep("a ? 2 : ", 10_000)}2;\n`,
    rules: { "no-magic-numbers": "error" },
    reports: { "no-magic-numbers": 10_001 },
    exitCode: 1,
  },
  {
    name: "10,000 nested arrow functions, each reported at its parameter",
    isHeavy: true,
    file: "a.js",
    text: () => `x = ${rep("a => ", 10_000)}a;\n`,
    rules: { "id-length": "error" },
    reports: { "id-length": 10_000 },
    exitCode: 1,
  },
  {
    name: "a chain of 10,000 `else if`, each with a reported body",
    isHeavy: true,
    file: "a.js",
    text: () => `if (a) b;${rep(" else if (a) b;", 10_000)}\n`,
    rules: { "curly": "error" },
    reports: { "curly": 10_001 },
    exitCode: 1,
  },

  // ── regular expressions ──
  {
    name: "60,000 named groups and as many backreferences",
    isHeavy: true,
    file: "a.js",
    text: () => `x = /${seq(60_000, i => `(?<g${i}>a)\\k<g${i}>`)}/;\n`,
    rules: { "no-invalid-regexp": "error", "no-useless-backreference": "error", "no-empty-character-class": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "90,000 groups with the same name, one per alternative",
    isHeavy: true,
    file: "a.js",
    text: () => `x = /(?:${rep("(?<g>a)|", 90_000)}b)/;\n`,
    rules: { "prefer-named-capture-group": "error", "no-useless-backreference": "error" },
    reports: {},
    exitCode: 0,
  },

  // ── comments ──
  {
    name: "a comment that declares 65,000 globals",
    isHeavy: true,
    // oxlint ignores `/* global */` comments.
    eslint: true,
    file: "a.js",
    text: () => `/* global ${seq(65_000, i => `g${i}`, ", ")} */\n${seq(65_000, i => `f(g${i});\n`)}`,
    rules: { "no-undef": "error" },
    reports: { "no-undef": 65_000 },
    exitCode: 1,
  },

  // ── one long line, and output formats ──
  {
    name: "40,000 problems on one non-ASCII line",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep('a == "é😀"; ', 40_000)}\n`,
    rules: { eqeqeq: "error" },
    reports: { eqeqeq: 40_000 },
    exitCode: 1,
  },
  {
    name: "40,000 problems on one line in oxlint's JSON format",
    isHeavy: true,
    file: "a.js",
    text: () => `${rep('a == "é😀"; ', 40_000)}\n`,
    rules: { eqeqeq: "error" },
    args: ["-f", "json"],
    // This is the last operator. A statement is 15 bytes and 12 UTF-16 code units.
    matches: /"span": \{"offset": 599987,"length": 2,"line": 1,"column": 599988\}/,
    exitCode: 1,
  },
  {
    name: "60,000 problems, each printed with its surrounding lines",
    isHeavy: true,
    file: "a.js",
    text: () => rep("a == b;\n", 60_000),
    rules: { eqeqeq: "error" },
    // With an oxlint config, `-f agent` prints one line per problem, without the code.
    eslint: true,
    args: ["-f", "agent", "--all"],
    matches: /line="60000" column="3"/,
    exitCode: 1,
  },

  // ══ type-aware rules ══ ── a body that's too large for control flow analysis (TS2563): every reference in it that
  // would be narrowed gets the error type ──
  ...((): Case[] => {
    const head = "export {};\ndeclare const a: boolean, b: number, p: Promise<void>; let x: number;\n";
    // All three statements are reported if `b` and `p` have their real types.
    const three = "await b;\nx = b as number;\np;\n";
    const conditions = (n: number, name = "x") => rep(`if (a) { ${name} = 1; }\n`, n);
    const loop = (n: number) =>
      `declare function must(v: unknown): asserts v;\nlet y: string | number | undefined = 0;\nwhile (b) {\nif (a) { y = "s"; }\n${rep("must(b);\n", n)}const z = y;\n}\n`;
    const warning =
      /This file is too large for control flow analysis\. Reports from rules that need type information may be wrong or incomplete\./;
    const [awaited, asserted, floating] = ["await-thenable", "no-unnecessary-type-assertion", "no-floating-promises"];
    const common = {
      file: "a.ts",
      rules: {
        [`typescript/${awaited}`]: "error",
        [`typescript/${asserted}`]: "error",
        [`typescript/${floating}`]: "error",
      },
      args: typed,
      // With a debug build's stack frames, the type checker overflows the stack at about 800 of these statements, in
      // `bun check` too.
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
        name: "1,000 `if` statements stay under the control flow limit",
        text: () => head + three + conditions(1_000),
        reports: all,
        lacks: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "code before 1,100 `if` statements still has types, and the file gets a warning",
        text: () => head + three + conditions(1_100),
        reports: all,
        matches: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "code after 1,100 `if` statements has no types, and the file gets a warning",
        text: () => head + conditions(1_100) + three,
        reports: {},
        matches: warning,
        exitCode: 0,
      },
      {
        ...common,
        name: "warns when a rule queries a type after 1,000 `if` statements in a function",
        text: () => `${head}function f() { let y: number = 0;\n${conditions(1_000, "y")}y as number; }\n${three}`,
        matches: warning,
        exitCode: 1,
      },
      // A loop's body is walked twice: from `y` to the start of the loop, then from the end of the loop back to its
      // start. No rule queries `y`.
      {
        ...common,
        name: "a loop of 996 statements stays under the control flow limit",
        text: () => head + three + loop(996),
        reports: all,
        lacks: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "a loop of 997 statements hits the control flow limit and warns",
        text: () => head + three + loop(997),
        reports: all,
        matches: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "a `// @ts-nocheck` file over the control flow limit warns too",
        text: () => "// @ts-nocheck\n" + head + three + conditions(1_100),
        reports: all,
        matches: warning,
        exitCode: 1,
      },
      {
        ...common,
        name: "400 small functions with loops stay under the control flow limit",
        text: () =>
          head +
          seq(
            400,
            i => `function f${i}() { let y: number = 0;\nwhile (a) {\n${conditions(20, "y")}}\ny as number; }\n`,
          ) +
          three,
        reports: { ...all, [`@typescript-eslint/${asserted}`]: 401 },
        lacks: warning,
        exitCode: 1,
      },
    ];
  })(),

  // ── TypeScript caches a reference's type at the start of a loop. With a `finally` block, the cached type depends on
  // which query comes first, because a walk that starts after the block sees fewer paths into it.
  // `no-floating-promises` queries the last statement. ──
  ...((): Case[] => {
    const common = {
      rules: { "typescript/no-floating-promises": "error", "typescript/no-unnecessary-condition": "error" },
      reports: {},
      exitCode: 0,
    };
    const loopInBlock = `let x = 0;
try {
  try {
    while (a) {}
  } finally {
    do {} while (a);
  }
} finally {
  a && (x = 1);
}
export { x };
`;
    const declarations =
      "declare function c(): boolean;\ndeclare const d: boolean;\ndeclare function mayThrow(): void;\n";
    const blockInLoop = (
      before: string,
      jump: string,
      after: string,
    ) => `${declarations}let x: string | undefined = undefined;
while (c()) {
  if (x) {}
  ${before}
    try {
      if (c()) { x = "s"; mayThrow(); x = undefined; }
    } finally {
      ${jump};
    }
    x && mayThrow();
  ${after}
}
export {};
`;
    const flags = [[], ["--type-check"]];
    return [
      {
        ...common,
        name: "a loop in a `finally` block: no false report when another rule queries the code after the block first",
        file: "a.ts",
        text: () => `declare const a: boolean; ${loopInBlock}`,
        args: typed,
      },
      // `d` can be narrowed, so its condition gets a flow node. `c()` doesn't get one.
      ...["if (c()) ", "if (d) "].flatMap(condition =>
        [
          ["", "continue", ""],
          ["block: {", "break block", "}"],
          ["(() => {", "return", "})();"],
        ].map(([before, jump, after]) => ({
          ...common,
          name: `a \`finally\` block in a loop that exits with \`${condition}${jump}\`: no false report before the block`,
          file: "a.ts",
          text: () => blockInLoop(before, condition + jump, after),
          args: typed,
        })),
      ),
      // The jump is the only way to reach `mayThrow()`, so the binder doesn't create a label before it, and the call
      // directly follows a flow node inside the `finally` block.
      ...["if (c()) ", "if (d) "].flatMap(condition =>
        (
          [
            ["for (;;) {", "break", "}", 0],
            ["while (true) {", "break", "}", 1],
            ["do {", "break", "} while (true);", 1],
            ["(() => {", "return", "throw 0; })();", 0],
          ] as const
        ).map(([before, jump, after, constantConditions]) => ({
          ...common,
          name: `a \`finally\` block in a loop, where \`${condition}${jump}\` is the only way out of \`${before}\`: no false report before the block`,
          file: "a.ts",
          text: () => blockInLoop(before, condition + jump, `${after}\n  mayThrow();`),
          args: typed,
          // The rule reports `true` as a loop condition.
          reports: constantConditions ? { "@typescript-eslint/no-unnecessary-condition": constantConditions } : {},
          exitCode: constantConditions ? 1 : 0,
        })),
      ),
      // These two have no loop around the block. A walk from the last line enters the block twice, along two different
      // paths, and the second time it reuses a type it cached the first time. The second walk is for the loop.
      {
        ...common,
        name: "a `finally` block that an exception can exit, and a loop in the `catch` around it: no false report in the loop",
        file: "a.ts",
        text: () => `${declarations}let x: string | undefined = undefined;
try {
  try {
    if (c()) { x = "s"; mayThrow(); x = undefined; }
  } finally {
    if (d) {}
  }
} catch {
  for (;;) { if (x) {} if (d) break; }
}
x && mayThrow();
export {};
`,
        args: typed,
      },
      {
        ...common,
        name: "a `finally` block that exits with `break`, and a loop after it: no false report in the loop",
        file: "a.ts",
        text: () => `${declarations}let x: string | number | undefined = 0;
block: {
  try {
    x = "s";
  } finally {
    if (d) break block;
  }
  for (;;) { if (x) {} else { break; } }
}
x && mayThrow();
export {};
`,
        rules: { "typescript/no-floating-promises": "error", "typescript/strict-boolean-expressions": "error" },
        args: typed,
        // Only the last line is reported, because `x` is a string in the loop.
        reports: { "@typescript-eslint/strict-boolean-expressions": 1 },
        exitCode: 1,
      },
      // These files are still type-checked internally, but their type errors aren't reported.
      ...flags.map(flag => ({
        ...common,
        name: `a loop in a \`finally\` block in a \`// @ts-nocheck\` file${flag.length ? `, with ${flag}` : ""}`,
        file: "a.ts",
        text: () => `// @ts-nocheck\ndeclare const a: boolean; ${loopInBlock}export const wrong: number = "";\n`,
        args: [...typed, ...flag],
      })),
      ...flags.map(flag => ({
        ...common,
        name: `a loop in a \`finally\` block in a JavaScript file without \`checkJs\`${flag.length ? `, with ${flag}` : ""}`,
        file: "a.js",
        text: () =>
          `/** @type {boolean} */ const a = globalThis.a; ${loopInBlock}/** @type {number} */ export const wrong = "";\n`,
        compilerOptions: { allowJs: true, checkJs: false, strict: true, noEmit: true },
        args: [...typed, ...flag],
      })),
    ];
  })(),

  // ── the type checker runs out of stack while answering a rule's query, with no file checked before it's linted ──
  {
    name: "3,000 nested generic calls: reports the promise, or warns that the type checker ran out of stack",
    file: "a.ts",
    text: () =>
      `declare function f<T>(x: T): T;\ndeclare const p: Promise<void>;\n${rep("f(", 3_000)}p${rep(")", 3_000)};\n`,
    rules: { "typescript/no-floating-promises": "error" },
    args: typed,
    reports: { "@typescript-eslint/no-floating-promises": 1 },
    orWarns: /^warn: The type checker ran out of stack in a\.ts$/m,
    exitCode: [0, 1],
    isHeavy: true,
  },

  // ── exponential time ── Each alternative made it seven times slower. Yarn's release bundle, which many repositories
  // commit, has a parser like this.
  ...["", "// @ts-nocheck\n"].map((comment): Case => ({
    name: `a generated parser with a rule of 16 alternatives${comment && ", in a `// @ts-nocheck` file"}`,
    file: "a.ts",
    text: () => comment + generatedParser(16),
    rules: { "typescript/no-floating-promises": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  })),
  {
    name: "60 stacked diamonds of interface inheritance",
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
    // The last one is for `Promise.reject(o);`.
    reports: {
      "@typescript-eslint/unbound-method": 1,
      "@typescript-eslint/only-throw-error": 1,
      "@typescript-eslint/no-floating-promises": 1,
      "@typescript-eslint/prefer-promise-reject-errors": 1,
    },
    exitCode: 1,
  },
  {
    name: "40 stacked inheritance diamonds on top of Promise and Error",
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
    name: "a tuple of two copies of the previous tuple, 60 levels deep",
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
    name: "a tuple of two copies of the previous tuple, 40 levels deep, whose elements may lack a useful toString",
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

  // ── stack depth ──
  {
    name: "two chains of 8,000 calls, joined by &&",
    // With a debug build's larger stack frames, the rule gives up on a chain this long and reports nothing.
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
    name: "60,000 declarations annotated with a type alias",
    isHeavy: true,
    file: "a.ts",
    text: () => "type T = 1;\n" + rep("let v: T;\n", 60_000),
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    // oxc rejects a file that declares `v` twice.
    exitCode: 1,
  },
  {
    name: "a union of 30,000 template literal types, and one of 30,000 object types",
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
    name: "a filter callback that returns a union of 100,000 members",
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
    name: "assertions to a union of 8,000 members",
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
    name: "8,000 functions that take a type with 8,000 properties and a union of 8,000 members",
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
    name: "8,000 expression statements whose type is a union of 8,000 function types",
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
    name: "a sum of 100,000 identifiers",
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
  // Up to some depth the types are computed, and past a larger depth the parser rejects the file. In between, the
  // checker runs out of stack. Those depths depend on the platform and the build, so this tries many depths and accepts
  // either exit code.
  ...[2_000, 3_000, 4_000, 5_000, 6_000, 6_500, 7_000, 7_500, 8_000].map((depth): Case => ({
    name: `type arguments ${depth} deep, six times`,
    isHeavy: true,
    file: "a.ts",
    text: () => seq(6, i => `export type A${i} = ${rep("Array<", depth)}string${rep(">", depth)};\n`),
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: [0, 1],
  })),
  ...[5_000, 6_000, 6_500, 7_000, 7_500].map((depth): Case => ({
    name: `tuple types ${depth} deep`,
    isHeavy: true,
    file: "a.ts",
    text: () => `export type A = ${rep("[", depth)}string${rep("]", depth)};\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: [0, 1],
  })),
  ...[4_000, 8_000, 12_000, 20_000, 40_000].map((depth): Case => ({
    name: `${depth} indexed access types in a row`,
    isHeavy: true,
    file: "a.ts",
    text: () => `export type A = string${rep('["length"]', depth)};\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: [0, 1],
  })),
  {
    name: "100,000 comma operators in a row, with a type-aware rule",
    isHeavy: true,
    file: "a.ts",
    text: () => `export const a = (${rep("1, ", 100_000)}1);\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  },
  {
    // Each error starts where the first one does and ends further along, all on one line.
    name: "100,000 comma operators in a row, with --type-check",
    isHeavy: true,
    file: "a.ts",
    text: () => `export const a = (${rep("1, ", 100_000)}1);\n`,
    rules: { "typescript/no-deprecated": "error" },
    args: ["--type-check", ...typed],
    matches: /^100000 problems$/m,
    exitCode: 1,
  },
  {
    name: "30,000 functions that match against a regular expression in one variable",
    isHeavy: true,
    file: "a.ts",
    text: () => "const r = /a/;\n" + seq(30_000, i => `export function f${i}(s: string) { s.match(r); }\n`),
    rules: { "typescript/prefer-regexp-exec": "error" },
    args: typed,
    reports: { "@typescript-eslint/prefer-regexp-exec": 30_000 },
    exitCode: 1,
  },
  {
    name: "a function with 200,000 parameters",
    isHeavy: true,
    file: "a.js",
    text: () =>
      `function f(${seq(200_000, i => `b${i}`, ", ")}) {}\nfunction g({ ${seq(200_000, i => `b${i}`, ", ")} }) {}\n`,
    rules: {},
    eslint: true,
    reports: {},
    exitCode: 0,
  },
  {
    name: "a function with 200,000 parameters and one duplicate at the end",
    isHeavy: true,
    file: "a.js",
    text: () => `function f(${seq(200_000, i => `b${i}`, ", ")}, b7 = 1) {}\n`,
    rules: {},
    eslint: true,
    // espree reports it at this position.
    matches: /a\.js:1:1688902: Parsing error: Argument name clash \[Error\]$/m,
    exitCode: 1,
  },
  {
    name: "a rule with 100,000 options that its schema requires to be unique",
    isHeavy: true,
    file: "a.js",
    text: () => "a;\n",
    rules: { "id-denylist": ["error", ...Array.from({ length: 100_000 }, (_, i) => `b${i}`)] },
    eslint: true,
    reports: {},
    exitCode: 0,
  },
  // ── an option that sets the length of inserted text ──
  {
    // The largest value oxlint accepts, because the option is a `u32`.
    name: "--fix doesn't insert 2 ** 32 - 1 empty lines after an import",
    file: "a.js",
    text: () => 'import "a";\nfoo();\n',
    rules: { "import/newline-after-import": ["error", { count: 2 ** 32 - 1 }] },
    args: ["--fix", "-f", "unix"],
    reports: { "import/newline-after-import": 1 },
    length: "as before",
    exitCode: 1,
  },
  {
    name: "2 ** 32 - 1 empty lines after an import in the default format, which reads the fixes",
    file: "a.js",
    text: () => 'import "a";\nfoo();\n',
    rules: { "import/newline-after-import": ["error", { count: 2 ** 32 - 1 }] },
    args: [],
    matches: /Expected 4294967295 empty lines after import statement/,
    exitCode: 1,
  },
  // ── eslint-plugin-react: state shared by many components, and work done once per component ──
  {
    name: "30,000 components that are properties of one object, each with its own propTypes",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      `const A = {${seq(30_000, i => `p${i}: () => <a/>`, ",")}};\n` + seq(30_000, i => `A.p${i}.propTypes = {};\n`),
    rules: { "react/prop-types": "error" },
    reports: {},
    exitCode: 0,
  },
  {
    name: "30,000 statements that use `this` inside 1,500 nested callbacks in a component's method",
    isHeavy: true,
    file: "a.jsx",
    text: () =>
      "class A extends React.Component { componentDidMount() {\n" +
      rep("a(() => {\n", 1_500) +
      rep("this.setState({}); this.state.b = 1; this.refs.c;\n", 30_000) +
      rep("});\n", 1_500) +
      "} render() { return <div />; } }\n",
    rules: { "react/prop-types": "error", "react/no-this-in-sfc": "error" },
    reports: {},
    exitCode: 0,
  },
  // ── only the type checker: the rule never queries a type ──
  ...(
    [
      ["120,000 call statements in a row", () => "declare const a: any;\n" + rep("a();\n", 120_000)],
      [
        "a variable with 24,000 assignments that 24,000 functions refer to",
        () =>
          `export function f() {\n  let v = 0;\n${seq(24_000, i => `  { { { { { { v = ${i}; } } } } } }\n`)}` +
          `  return [\n${rep("    () => v,\n", 24_000)}  ];\n}\n`,
      ],
      [
        "an array literal with 60,000 functions and an array type annotation",
        () => `export const a: readonly (() => void)[] = [\n${rep("  () => {},\n", 60_000)}];\n`,
      ],
      [
        "a destructuring pattern with 120,000 properties",
        () => `export const {\n${seq(120_000, i => `  p${i} = 0,\n`)}} = {};\n`,
      ],
    ] as const
  ).map(([name, text]): Case => ({
    name,
    isHeavy: true,
    file: "a.ts",
    text,
    rules: { "typescript/await-thenable": "error" },
    args: typed,
    reports: {},
    exitCode: 0,
  })),
  ...reactCompiler,
];
