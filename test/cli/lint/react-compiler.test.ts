// Tests for the React Compiler rules: oxlint's 22 `react/*` rules and eslint-plugin-react-hooks's 27 `react-hooks/*`
// rules. oracle/react-compiler/expected.json has what oxlint and ESLint report for the same inputs. expected.ts in that
// directory writes it.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { realpathSync } from "node:fs";
import { endChildren, spawn } from "../children";
import expected from "./oracle/react-compiler/expected.json";
import {
  briefly,
  byEslintFile,
  byFile,
  eslintConfig,
  eslintSmall,
  type Files,
  long,
  rc,
  small,
  twoLabels,
} from "./oracle/react-compiler/inputs";

afterAll(endChildren);

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

async function lint(files: Files, args: string[], more: Record<string, string> = {}) {
  using dir = tempDir("bun-lint-react-compiler", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...env, ...more },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    raw: stdout,
    peak: proc.resourceUsage()!.maxRSS,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr,
    exitCode,
    directories: [realpathSync(String(dir)), String(dir)],
  };
}

/** Lints a directory and returns its report in the shape expected.json uses. The order within a file isn't compared. */
async function report(files: Files) {
  const { raw, stderr, exitCode, peak } = await lint(files, ["-f", "json"]);
  if (!raw.startsWith("{")) throw new Error(`No report (exit ${exitCode}): ${stderr}`);
  const { diagnostics, number_of_files } = JSON.parse(raw);
  return { diagnostics: byFile({ diagnostics }), files: number_of_files, exit: exitCode, peak };
}

const rulesIn = (diagnostics: Record<string, unknown[]>) =>
  [...new Set(Object.values(diagnostics).flatMap(found => found.map(it => (it as { code: string }).code)))].sort();

const slow = isDebug || isASAN ? 120_000 : undefined;

type Found = { code: string; labels: { span: { line: number; column: number } }[] };
const locationsOf = (found: unknown[]) =>
  (found as Found[]).map(it => [it.code, it.labels[0].span.line, it.labels[0].span.column]).sort();
/** The lines of the diagnostics of `rule`, in order. */
const linesOf = (found: unknown[] = [], rule: string) =>
  (found as Found[])
    .filter(it => it.code === `react(${rule})`)
    .map(it => it.labels[0].span.line)
    .sort((a, b) => a - b);

/** Lints one of the directories of inputs.ts and compares the whole report with oxlint's. Returns its diagnostics. */
async function matches(name: keyof typeof expected.reports) {
  const { diagnostics, files, exit } = await report(small[name]);
  expect(diagnostics).toEqual(expected.reports[name].diagnostics);
  expect(files).toBe(expected.reports[name].files);
  expect(exit).toBe(expected.reports[name].exit);
  return diagnostics;
}

const memo = (params: string, values: string, listed: string) => `import { useMemo } from "react";

export function Component({ ${params} }) {
  const value = useMemo(() => [${values}], [${listed}]);
  return <div>{value}</div>;
}
`;
/** Missing dependencies. The two tools sort them differently. */
const unlisted: Files = {
  "case.jsx": memo("Foo, bar", "Foo, bar", ""),
  "names.jsx": memo("_a, $a, a1, a10, a9, A, a, B, b, é, e, f, z", "z, f, é, e, b, B, a, A, a9, a10, a1, $a, _a", ""),
  "number.jsx": memo("x", "x.z, x[10], x[9], x.B, x.b, x.a, x.A, x.$d, x._c", ""),
  "paths.jsx": memo("x", "x.z, x.B, x.b, x.a, x.A, x.$d, x._c, x.a9, x.a10, x.a1, x.é, x.e, x.f", ""),
  "some.jsx": memo("Zed, alpha, Beta, gamma", "gamma, Zed, alpha, Beta", "gamma, Beta"),
};
const missingIn = (text: string) => Array.from(text.matchAll(/Missing dependency `([^`]+)`/g), it => it[1]);

describe.concurrent(`bun lint: the React Compiler rules match oxlint ${expected.oxlint}`, () => {
  test(
    "on oxlint's own test cases",
    async () => {
      const { diagnostics, files, exit } = await report({ ".oxlintrc.json": rc(), ...expected.cases });
      expect(diagnostics).toEqual(expected.reports.cases.diagnostics);
      // An invalid case has a diagnostic from its rule, and a valid one doesn't.
      for (const path of Object.keys(expected.cases)) {
        const code = `react(${path.slice(0, path.indexOf("/"))})`;
        const found = (diagnostics[path] ?? []).some(it => (it as { code: string }).code === code);
        expect([path, found]).toEqual([path, path.includes(".invalid.")]);
      }
      expect(files).toBe(expected.reports.cases.files);
      expect(exit).toBe(expected.reports.cases.exit);
    },
    slow,
  );

  test(
    "on the compiler's fixtures",
    async () => {
      const { diagnostics, files, exit } = await report({ ".oxlintrc.json": rc(), ...expected.fixtures });
      expect(diagnostics).toEqual(expected.reports.fixtures.diagnostics);
      expect(rulesIn(diagnostics)).toEqual([
        "react(error-boundaries)",
        "react(exhaustive-effect-dependencies)",
        "react(globals)",
        "react(hooks)",
        "react(immutability)",
        "react(invariant)",
        "react(memo-dependencies)",
        "react(no-deriving-state-in-effects)",
        "react(preserve-manual-memoization)",
        "react(purity)",
        "react(refs)",
        "react(set-state-in-effect)",
        "react(set-state-in-render)",
        "react(static-components)",
        "react(todo)",
        "react(unsupported-syntax)",
        "react(use-memo)",
        "react(void-use-memo)",
      ]);
      expect(files).toBe(expected.reports.fixtures.files);
      expect(exit).toBe(expected.reports.fixtures.exit);
    },
    slow,
  );

  test("reports nothing in a function that's neither a component nor a hook, unless it has 'use memo' in a file that's compiled", async () => {
    const { diagnostics, files, exit } = await report(small["not React"]);
    expect(diagnostics).toEqual(expected.reports["not React"].diagnostics);
    // asked-for.js has the same function and nothing else, so it isn't compiled.
    expect(Object.keys(diagnostics)).toEqual(["asked-for-beside-a-hook.js"]);
    expect(files).toBe(4);
    expect(exit).toBe(1);
  });

  test("disable comments work with any plugin prefix or none, in ESLint's and oxlint's syntax, at the first label", async () => {
    const { diagnostics, files, exit } = await report(small.comments);
    expect(diagnostics).toEqual(expected.reports.comments.diagnostics);
    // The diagnostics in all the other files are suppressed.
    expect(Object.keys(diagnostics)).toEqual([
      "before-the-second-label.jsx",
      "eslint/react.purity.jsx",
      "oxlint/react.purity.jsx",
      "until-enabled.jsx",
    ]);
    expect(files).toBe(expected.reports.comments.files);
    expect(exit).toBe(1);
  });

  test("turning react/todo on or off doesn't change what the other rules report", async () => {
    const { diagnostics, exit } = await report(small.todo);
    expect(diagnostics).toEqual(expected.reports.todo.diagnostics);
    const isTodo = (it: unknown) => (it as { code: string }).code === "react(todo)";
    expect(diagnostics["on/a.jsx"].filter(it => !isTodo(it))).toEqual(diagnostics["off/a.jsx"]);
    expect(diagnostics["on/a.jsx"].filter(isTodo)).toEqual(diagnostics["alone/a.jsx"]);
    expect(diagnostics["alone/a.jsx"]).toHaveLength(2);
    expect(exit).toBe(1);
  });

  test("on code that oxc's fork of the compiler accepts or reports differently", async () => {
    const { diagnostics, files, exit } = await report(small.fork);
    expect(diagnostics).toEqual(expected.reports.fork.diagnostics);
    // own-name-of-the-component.jsx and update.jsx aren't compiled. The other files compile without diagnostics.
    expect(Object.keys(diagnostics)).toEqual([
      "arguments.jsx",
      "captured-target.jsx",
      "catch.jsx",
      "clock.jsx",
      "computed-string.jsx",
      "default.jsx",
      "import.jsx",
      "own-name-beside-a-component.jsx",
      "parentheses.tsx",
      "ref-in-memo.jsx",
      "tagged-template.jsx",
      "unreachable.jsx",
      "update-beside-a-component.jsx",
      "virtual.jsx",
    ]);
    expect(locationsOf(diagnostics["captured-target.jsx"])).toEqual([["react(invariant)", 12, 9]]);
    expect(files).toBe(expected.reports.fork.files);
    expect(exit).toBe(1);
  });

  test("a type cast has its own location, and hides the expression it casts", async () => {
    const { diagnostics, exit } = await report(small.casts);
    expect(diagnostics).toEqual(expected.reports.casts.diagnostics);
    expect(diagnostics["casts.tsx"]).toHaveLength(8);
    expect(exit).toBe(1);
  });

  test("`for (;;)` is compiled, and `x = d` in a pattern has its own location", async () => {
    const { diagnostics, exit } = await report(small.lowering);
    expect(diagnostics).toEqual(expected.reports.lowering.diagnostics);
    expect(rulesIn({ it: diagnostics["forever.tsx"] })).toEqual(["react(immutability)", "react(refs)"]);
    expect(diagnostics["defaults.tsx"]).toHaveLength(12);
    expect(exit).toBe(1);
  });

  test("consecutive loops are visited in the compiler's order", async () => {
    const { diagnostics, exit } = await report(small.order);
    expect(diagnostics).toEqual(expected.reports.order.diagnostics);
    expect(diagnostics["order.jsx"]).toHaveLength(4);
    expect(exit).toBe(1);
  });

  test("each write to a captured variable is reported at its own location", async () => {
    const { diagnostics, exit } = await report(small.writes);
    expect(diagnostics).toEqual(expected.reports.writes.diagnostics);
    expect(locationsOf(diagnostics["writes.jsx"])).toEqual([
      ["react(immutability)", 5, 3],
      ["react(immutability)", 7, 5],
      ["react(immutability)", 9, 3],
    ]);
    expect(exit).toBe(1);
  });

  test("a module's own useMemo isn't React's, and an expression that contains JSX can't be evaluated earlier", async () => {
    const { diagnostics, exit } = await report(small.names);
    expect(diagnostics).toEqual(expected.reports.names.diagnostics);
    expect(diagnostics["own-hooks.tsx"]).toBeUndefined();
    expect(diagnostics["callback-of-map.jsx"]).toBeUndefined();
    expect(locationsOf(diagnostics["react-by-its-name.jsx"]).map(it => it[1])).toEqual([5, 5]);
    expect(locationsOf(diagnostics["fbt.jsx"])).toEqual([
      ["react(todo)", 2, 3],
      ["react(todo)", 5, 8],
    ]);
    // D isn't reported, because its default has no JSX.
    expect(locationsOf(diagnostics["defaults-with-jsx.jsx"])).toEqual([
      ["react(static-components)", 6, 11],
      ["react(todo)", 1, 28],
      ["react(todo)", 17, 28],
      ["react(todo)", 21, 28],
      ["react(todo)", 5, 29],
      ["react(todo)", 9, 28],
    ]);
    expect(exit).toBe(1);
  });

  test(
    "a long component is compiled",
    async () => {
      const { diagnostics, exit } = await report(small.long);
      expect(diagnostics).toEqual(expected.reports.long.diagnostics);
      for (const path of ["statements.tsx", "states.tsx", "callbacks.tsx", "children.tsx"])
        expect([path, rulesIn({ it: diagnostics[path] })]).toEqual([path, ["react(refs)"]]);
      expect(exit).toBe(1);
    },
    slow,
  );

  // oxlint 1.95.0 reports the same with up to 1,500 of them, on the third line from the end, and crashes with SIGSEGV
  // from 2,000.
  test(
    "reports a ref value that's used after 4,000 optional chains",
    async () => {
      const { diagnostics, exit } = await report({
        ".oxlintrc.json": rc(),
        "chains.tsx": long(
          4000,
          k => `  const v${k} = props.o${k}?.b?.c;`,
          units => [units, "<div>{bad + v0 + v3999}</div>"],
        ),
      });
      const found = diagnostics["chains.tsx"] as {
        code: string;
        labels: { span: { line: number; column: number } }[];
      }[];
      expect(found.map(it => [it.code, it.labels[0].span.line, it.labels[0].span.column])).toEqual([
        ["react(refs)", 4006, 16],
      ]);
      expect(exit).toBe(1);
    },
    slow,
  );

  // eslint-plugin-react-hooks and oxlint 1.87.0 use up all available memory on functions like these. oxlint 1.95.0
  // reports nothing in them either.
  test(
    "a small function with mutually recursive inferred types compiles quickly",
    async () => {
      const { diagnostics, exit } = await report({
        ".oxlintrc.json": rc(),
        "types.jsx": `function Component(props) { let a, b, c, d, e; l1: for (let i2 = 0; i2 < 0; i2++) {  try {  do { try { switch (props.x) { case 0: { }  case 1: { [a = 3, b = b] = props.l;  }  case 2: { } default: { } case 3: { b = a; }  } } catch (err) { }  } while (props.x); } catch (err) { } } return <div>{a}{b}{c}{d}{e}</div>; }`,
        "cycle.jsx": `function Component(props) { let a, b, c, d, e; while (props.x) { switch (c?.p) { case 0: { while (props.y) { switch (f0) { default: {   try { } catch (err) { } for (const x3 of 0) {  e = ((props.x && (props.x ?? d)) || { });  } ({p: a = e, q: c} = props.o); } case 0: { if (fprops.x) {  d = (props.y && (fprops.x ? a : f0)); } }  case 1: { }  }  while ((f((props.x ? null : a)) < props.x)) { if ((0 === 0)) { ({p: e = b, q: a} = props.o); d = d;  }  } } } case 1: { } default: { } }   }    a = { };  return <div>{a}{b}{c}{d}{e}</div>; }`,
      });
      // There's nothing to report in them.
      expect(diagnostics).toEqual({});
      expect(exit).toBe(0);
    },
    slow,
  );

  // oxlint 1.87.0 doesn't finish this one within a minute.
  test(
    "a small function with mutually recursive ref types compiles quickly and without much memory",
    async () => {
      const { diagnostics, exit, peak } = await report({
        ".oxlintrc.json": rc(),
        "refs.jsx": `function Component(props) { let a, b, c, d, e; a += (([props.x, c] || props.x) ? ({k: props.x} ?? \`\${props.x}-\${props.x}\`) : d.p?.q); e = ((() => (d.p?.q)) ? [<b x={b}>{c}</b>, f(b)] : ((e ? a : c) < e)); if (([(null || props.x), {k: c, [props.x]: d}] || c)) { for (let i7 = 0; i7 < f(null); i7++) { while (c.m(d)) { const n8 = {}; n8.p = ((null ?? 2) || d); f(n8); for (let i9 = 0; i9 < (props.x === c); i9++) { if (2) { b = [a, f(0)]; b -= ((() => ((b ? props.x : d))) ? null : \`\${(a - d)}-\${d}\`); b = [props.x, ([props.x, props.y] ? \`\${null}-\${props.y}\` : (null || props.x))]; } } f(d, a); a = [a, c]; c = [a, c]; c = {k: c, j: a}; { const s = (props.y ? (null + b) : {k: 1}); f(s); { const s = a; f(() => s); } } } } } else { if ((props.x ? [(props.x + e), c] : ({k: c} && (c ? c : props.y)))) { for (const z2 of props.l) { switch (3) { case 0: {  } case 1: { if ((e?.p.q && props.x)) { f(b, d); e = (() => ((c?.p === (c < null)))); } else {  } e = null; l1: { b = (f((props.x ? c : a)) === (c - c.p.q)); f(e, props.x); b = b + 1; f(d, props.x); } } break; default: {  } } f(e); e = \`\${\`\${null}-\${a}\`}-\${c}\`; } f(e); [d = 6, a = 4] = props.l; } a = c?.p?.[0]; if (1) { for (let z6 = 0; z6 < 3; z6++) { if (((d < 4) ? (props.y - props.x) : [e, props.y])) { do { e = ((() => ((null === a))) === f(a)); } while (props.x); try { f(e); a = a; const t3 = [([props.y, null] || a), ((props.y || null) ? {k: c} : {k: null})]; f(t3); f(e, 2); f(e); } catch (err) { d = e; d = f(a); f(c, props.x); e = (((a - null) + props.x) < ([d, props.y] ?? (props.y - props.y))); } a = {k: b}; f(d, a); if (null) { a = []; } d = {k: d, j: a}; } else if ((props.x ? {k: a} : null)) { if (c) { d = d; d = (() => (b)); } } else { while ({k: {k: f(d)}}) {  } } f(c); c = (() => ({k: c})); } f(c); e = d + 1; } e = props.y; } if (props.o.m((() => (props.o.m(e))))) { const o12 = { m() { return ((() => (d)) + null); }, n: () => (a.p?.q), k: props.x }; f(o12.m(), o12.n()); } c = (<b x={(b ? e : null)}>{[props.y, b]}</b> ? f((c === a)) : props.x); return <C a={a} b={b} {...e}>{c}{d}</C>; }`,
      });
      // oxlint 1.95.0 reports nothing in it either.
      expect(diagnostics).toEqual({});
      expect(peak).toBeLessThan((isDebug || isASAN ? 1500 : 300) * 1024 * 1024);
      expect(exit).toBe(0);
    },
    slow,
  );

  // oxlint 1.95.0 also reports nothing with up to 1,000 of them, in 5 s, and doesn't finish within a minute at 3,000.
  test(
    "a chain of objects that each contain the previous one, starting from a ref, takes linear memory",
    async () => {
      const n = isDebug || isASAN ? 2000 : 10000;
      const chain = Array.from({ length: n }, (_, k) => `  const o${k + 1} = { a: o${k} };`).join("\n");
      const { diagnostics, exit, peak } = await report({
        ".oxlintrc.json": rc(),
        "chain.jsx": `import { useRef } from "react";

export function Chain(props) {
  const ref = useRef(0);
  const o0 = { a: ref };
${chain}
  return <div data-x={o${n}}>{props.a}</div>;
}
`,
      });
      expect(diagnostics).toEqual({});
      expect(peak).toBeLessThan((isDebug || isASAN ? 1500 : 600) * 1024 * 1024);
      expect(exit).toBe(0);
    },
    slow,
  );

  // `bun lint`'s threads have a larger stack than usual, for code that can't check how much stack is left. The compiler
  // only uses as much as a normal thread has: 4 MB, which fits about 700 levels, or 18 MB on Windows. With the whole
  // stack it could go eight times as deep.
  test.skipIf(isDebug || isASAN)("code nested deeper than a normal thread's stack allows isn't compiled", async () => {
    const depth = isWindows ? 10_000 : 2_000;
    const { diagnostics, exit } = await report({
      ".oxlintrc.json": rc(),
      "deep.tsx": long(
        1,
        () => "if (props.a) {".repeat(depth) + "f(bad);" + "}".repeat(depth),
        units => [units, "<div>{bad}</div>"],
      ),
    });
    expect(locationsOf(diagnostics["deep.tsx"])).toEqual([["react(todo)", 3, 17]]);
    expect(exit).toBe(1);
  });

  // Matches oxlint 1.95.
  test("missing dependencies are sorted by bytes, and the report is located after the dependency list", async () => {
    const { diagnostics, exit } = await report({ ".oxlintrc.json": rc(["react/memo-dependencies"]), ...unlisted });
    const labels = (name: string) =>
      (diagnostics[name] as { labels: { label: string; span: { line: number; column: number } }[] }[]).map(it => [
        `${it.labels[0].span.line}:${it.labels[0].span.column}`,
        ...missingIn(it.labels.map(label => label.label).join("\n")),
      ]);
    expect({
      case: labels("case.jsx"),
      names: labels("names.jsx"),
      paths: labels("paths.jsx"),
      some: labels("some.jsx"),
    }).toEqual({
      case: [["4:43", "Foo", "bar"]],
      names: [["4:79", "$a", "A", "B", "_a", "a", "a1", "a10", "a9", "b", "e", "f", "z", "é"]],
      paths: [
        ["4:105", "x.$d", "x.A", "x.B", "x._c", "x.a", "x.a1", "x.a10", "x.a9", "x.b", "x.e", "x.f", "x.z", "x.é"],
      ],
      some: [["4:58", "Zed", "alpha"]],
    });
    expect(exit).toBe(1);
  });

  test("a try block whose only throwing statement is an unused property read doesn't crash", async () => {
    const { files, exit } = await report({
      ".oxlintrc.json": rc(),
      "a.jsx": `export default function Component(props) {
        let a = props.a;
        try {
          props.d.m;
        } catch (err) {
          a = props.x;
        }
        return <div>{a}</div>;
      }`,
    });
    expect(files).toBe(1);
    expect([0, 1]).toContain(exit);
  });

  test("reports nothing for a path that contains node_modules", async () => {
    const { diagnostics, files, exit } = await report(small.node_modules);
    expect(diagnostics).toEqual(expected.reports.node_modules.diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["a.jsx"]);
    // Those files are linted, but not compiled.
    expect(files).toBe(4);
    expect(exit).toBe(1);
  });

  // The tests from here to the end of this block are about what oxlint 1.95 reports differently from 1.87.

  // oven-sh/bun#49620
  test("a component that's declared in another function is only compiled beside a top-level component or hook", async () => {
    const diagnostics = await matches("nested components");
    expect(Object.keys(diagnostics)).toEqual(["beside-a-component.tsx", "beside-a-hook.ts"]);
  });

  // oven-sh/bun#49621
  test("a callback that reads `.current` of a value depends on the value, whether or not it's known to be a ref", async () => {
    const diagnostics = await matches("ref arguments");
    // The first two list `.current` as a dependency.
    expect(Object.keys(diagnostics)).toEqual(["callback-in-memo.ts", "current-is-listed.ts", "other-dependency.ts"]);
  });

  test("a file is compiled if a top-level function is named like a component or a hook, or is a default export without a name", async () => {
    const diagnostics = await matches("gate");
    const compiled = Object.keys(diagnostics).filter(name => linesOf(diagnostics[name], "globals").length === 1);
    expect(compiled.map(name => name.slice(0, 2)).join(" ")).toBe(
      "01 02 04 05 06 07 14 15 16 19 23 28 29 32 35 39 43 44 47",
    );
  });

  test("a shared value that's imported from react-native-reanimated can be written outside of render", async () => {
    const diagnostics = await matches("reanimated");
    expect(rulesIn({ it: diagnostics["imported.tsx"] })).toEqual(["react(capitalized-calls)"]);
    expect(Object.keys(diagnostics)).toEqual([
      "default.jsx",
      "from-another-module.jsx",
      "imported.tsx",
      "not-imported.jsx",
      "other-names-imported.jsx",
      "required.js",
      "type-imported.tsx",
    ]);
  });

  test("a method whose name is in capitals isn't a capitalized call", async () => {
    const diagnostics = await matches("all caps");
    // `Child`, `Foo_BAR`, `FOo` and `F_o`.
    expect(linesOf(diagnostics["methods.jsx"], "capitalized-calls")).toEqual([2, 38, 42, 46]);
    expect(linesOf(diagnostics["functions.jsx"], "capitalized-calls")).toEqual([4, 40, 44, 48]);
  });

  test("`allow` and `allowPattern` of react/capitalized-calls allow the names that aren't local", async () => {
    const diagnostics = await matches("allowed calls");
    const count = Object.entries(diagnostics).map(([name, found]) => [name.slice(0, name.indexOf("/")), found.length]);
    expect(Object.fromEntries(count)).toEqual({
      "allow": 9,
      "alone": 10,
      "alternation": 8,
      "both": 8,
      "case-insensitive": 8,
      "default": 12,
      "empty": 12,
      "empty-pattern": 1,
      "pattern": 10,
      "unanchored": 7,
    });
  });

  test("an impure call in an async component isn't reported", async () => {
    const diagnostics = await matches("async components");
    expect(diagnostics["declarations.jsx"]).toBeUndefined();
    expect(rulesIn({ it: diagnostics["callbacks.jsx"] })).toEqual(["react(static-components)"]);
    expect(rulesIn({ it: diagnostics["other-rules.jsx"] })).toEqual(["react(immutability)", "react(refs)"]);
  });

  test("`count++` on a captured variable is compiled, and reported where the function runs after render", async () => {
    const diagnostics = await matches("update expressions");
    expect(diagnostics["render.jsx"]).toBeUndefined();
    for (const path of ["in-effects.jsx", "in-handlers.jsx", "in-array-callbacks.jsx", "timers.js", "typescript.ts"])
      expect([path, rulesIn({ it: diagnostics[path] })]).toEqual([path, ["react(immutability)"]]);
  });

  test("a nested function may reassign a variable that's declared in a callback", async () => {
    const diagnostics = await matches("callback locals");
    expect(diagnostics["array-callbacks.jsx"]).toBeUndefined();
    // The variables that are declared during render.
    expect(linesOf(diagnostics["effects.ts"], "immutability")).toEqual([85, 85]);
    expect(linesOf(diagnostics["handlers.tsx"], "immutability")).toEqual([54, 54]);
  });

  test("`||=`, `&&=` and `??=` are compiled, except on a `const`", async () => {
    const diagnostics = await matches("logical assignment");
    expect(diagnostics["locals.jsx"]).toBeUndefined();
    expect(rulesIn({ it: diagnostics["refs.jsx"] })).toEqual(["react(refs)"]);
    expect(rulesIn({ it: diagnostics["const.jsx"] })).toEqual(["react(todo)"]);
  });

  test("`new Date()` without arguments is reported in render, and not in a callback", async () => {
    const diagnostics = await matches("new Date");
    // `Date.now()` in a handler that's passed to a function, and `new Date()` in a function that's called in render.
    expect(linesOf(diagnostics["callbacks.jsx"], "purity")).toEqual([16, 52]);
    expect(diagnostics["render.jsx"]).toHaveLength(9);
  });

  test("a callback may capture a function declaration that comes after it", async () => {
    const diagnostics = await matches("hoisted functions");
    expect(rulesIn({ it: diagnostics["captured-before-declaration.jsx"] })).toEqual([
      "react(preserve-manual-memoization)",
      "react(todo)",
    ]);
    expect(linesOf(diagnostics["reassigned.jsx"], "immutability")).toEqual([2, 33, 33]);
  });

  test("passing a member of an object as a `ref` doesn't make the object a ref", async () => {
    const diagnostics = await matches("ref receiver");
    expect(Object.keys(diagnostics)).toEqual(["reads.tsx"]);
  });

  test("a variable that's assigned in a `try` block can be used after it, and a ref can be compared with a function's result", async () => {
    const diagnostics = await matches("catch phis");
    expect(diagnostics["phis.jsx"]).toBeUndefined();
    expect(rulesIn({ it: diagnostics["callbacks.jsx"] })).toEqual(["react(refs)"]);
    expect(linesOf(diagnostics["catch-parameter.js"], "invariant")).toEqual([15, 25]);
  });

  test("a comment that disables a react-hooks rule isn't reported, and the function it's in is compiled", async () => {
    const diagnostics = await matches("suppressions");
    expect(rulesIn(diagnostics)).not.toContain("react(rule-suppression)");
    expect(Object.keys(diagnostics)).toEqual([
      "block.jsx",
      "dependencies.jsx",
      "flow.jsx",
      "next-line.jsx",
      "unclosed-exhaustive-deps.jsx",
      "unclosed.jsx",
      "use-no-forget.jsx",
    ]);
  });

  test("a `declare` statement in a function is compiled", async () => {
    const diagnostics = await matches("ambient declarations");
    expect(locationsOf(diagnostics["inside.tsx"])).toEqual([
      ["react(globals)", 61, 3],
      ["react(refs)", 68, 16],
    ]);
  });

  test("what the blocks of a `try` statement with `finally` do is reported, and so is the statement", async () => {
    const diagnostics = await matches("try finally");
    expect(rulesIn({ it: diagnostics["render.jsx"] })).toEqual([
      "react(immutability)",
      "react(purity)",
      "react(refs)",
      "react(set-state-in-render)",
      "react(todo)",
    ]);
    expect(linesOf(diagnostics["dependencies.jsx"], "memo-dependencies")).toEqual([64, 79, 94]);
  });

  test("a `catch` block that can't be reached is removed", async () => {
    const diagnostics = await matches("unreachable catch");
    expect(Object.keys(diagnostics)).toEqual(["with-a-report.jsx"]);
    // The third is in a `catch` block that can be reached.
    expect(locationsOf(diagnostics["with-a-report.jsx"])).toEqual([
      ["react(immutability)", 34, 3],
      ["react(refs)", 11, 19],
      ["react(refs)", 44, 9],
    ]);
  });

  test("a property key that's half of a surrogate pair is reported, and a string value isn't", async () => {
    const diagnostics = await matches("lone surrogates");
    expect(linesOf(diagnostics["keys.jsx"], "todo")).toEqual([2, 6, 9, 12, 15, 21, 27, 36, 46, 50, 54, 59]);
    expect(rulesIn({ it: diagnostics["values.jsx"] })).toEqual(["react(refs)"]);
  });

  test(
    "a function with a chain of more than 500 members isn't compiled",
    async () => {
      const diagnostics = await matches("member chains");
      for (const path of ["499.jsx", "500.jsx", "computed-500.jsx", "call-at-the-end-500.jsx", "optional-501.jsx"])
        expect([path, rulesIn({ it: diagnostics[path] })]).toEqual([path, ["react(refs)"]]);
      for (const path of ["501.jsx", "5000.jsx", "computed-501.jsx", "call-at-the-end-501.jsx"])
        expect([path, locationsOf(diagnostics[path])]).toEqual([path, [["react(todo)", 6, 17]]]);
    },
    slow,
  );

  test("functions that access a ref in different places have the same type", async () => {
    const diagnostics = await matches("ref types");
    expect(linesOf(diagnostics["convergence.jsx"], "invariant")).toEqual([55]);
  });

  test("the help for modifying `.current` suggests a name that ends in Ref", async () => {
    const diagnostics = await matches("ref hints");
    const hinted = (diagnostics["hints.tsx"] as (Found & { help: string })[])
      .filter(it => it.help.endsWith('rename the variable to end in "Ref".'))
      .map(it => it.labels[0].span.line);
    expect(hinted.sort((a, b) => a - b)).toEqual([4, 10, 17, 25, 35, 65, 70, 81, 88]);
  });

  test("a function that an event handler calls isn't called during render, even in a callback that is", async () => {
    const diagnostics = await matches("captured functions");
    expect(linesOf(diagnostics["handlers-in-a-map.jsx"], "purity")).toEqual([51, 56, 91]);
    expect(diagnostics["mutating-callbacks.jsx"]).toBeUndefined();
  });

  test("on manual dependencies with optional and non-optional members", async () => {
    const diagnostics = await matches("optional dependencies");
    expect(locationsOf(diagnostics["mixed.jsx"])).toEqual([["react(preserve-manual-memoization)", 10, 6]]);
    expect(locationsOf(diagnostics["non-null.tsx"])).toEqual([["react(preserve-manual-memoization)", 9, 59]]);
  });

  test("a Todo or an Invariant replaces what the other rules report only with react/todo or react/invariant enabled, or in a function with its own useMemo or useCallback", async () => {
    const diagnostics = await matches("late passes");
    const found = (path: string) => locationsOf(diagnostics[path] ?? []);
    expect({
      "all": found("all/no-memo.jsx"),
      "neither": found("neither/no-memo.jsx"),
      "refs": found("refs/no-memo.jsx"),
      // The Todo isn't reported, and it still replaces the ref access.
      "refs-and-invariant": found("refs-and-invariant/no-memo.jsx"),
    }).toEqual({
      "all": [["react(todo)", 6, 12]],
      "neither": [["react(refs)", 4, 17]],
      "refs": [["react(refs)", 4, 17]],
      "refs-and-invariant": [],
    });
    for (const path of ["own-memo.jsx", "own-callback.jsx", "missing-memo-dependency.jsx"])
      expect([path, found(`neither/${path}`)]).toEqual([path, []]);
    expect(rulesIn({ it: diagnostics["neither/memo-in-a-callback.jsx"] })).toEqual(["react(hooks)", "react(refs)"]);
    expect(found("neither/effect-alone.jsx")).toEqual([["react(exhaustive-effect-dependencies)", 5, 6]]);
    expect({
      "all": found("all/invariant.jsx"),
      "neither": found("neither/invariant.jsx"),
      "refs": found("refs/invariant.jsx"),
      "refs-and-invariant": found("refs-and-invariant/invariant.jsx"),
    }).toEqual({
      "all": [["react(invariant)", 1, 26]],
      "neither": [],
      "refs": [],
      "refs-and-invariant": [["react(invariant)", 1, 26]],
    });
  });

  test("a function with a `using` or an `await using` declaration is compiled, and the resource is a `const`", async () => {
    const diagnostics = await matches("using declarations");
    // The last of each is in a function that has a `const` instead.
    expect(linesOf(diagnostics["using.ts"], "refs")).toEqual([6, 13, 19, 25]);
    expect(linesOf(diagnostics["await-using.ts"], "refs")).toEqual([6, 13]);
    // Where the resource is assigned to.
    expect(linesOf(diagnostics["using.tsx"], "syntax")).toEqual([42]);
    expect(linesOf(diagnostics["captured.tsx"], "syntax")).toEqual([42, 44]);
  });

  test("a write to a value is reported when the value is also an operand of an operator", async () => {
    const diagnostics = await matches("operator operands");
    // The ones that aren't reported are after `x++` and in a hook.
    expect(linesOf(diagnostics["operands.jsx"], "immutability")).toEqual([
      6, 13, 20, 27, 34, 41, 48, 56, 57, 64, 80, 86, 94, 102, 110, 119, 128, 136, 148,
    ]);
  });
});

describe.concurrent("bun lint: how a diagnostic's labels, help and note are printed", () => {
  const files = { ".oxlintrc.json": rc(["react/set-state-in-effect"]), "a.jsx": twoLabels };

  test("pretty prints all of them", async () => {
    const { stdout, exitCode } = await lint(files, ["-f", "pretty"]);
    expect(stdout).toMatchInlineSnapshot(`
      "2 |   const [state, setState] = useState(0);
      3 |   useEffect(() => {
      4 |     setState(1);
              ^
      error: Calling setState synchronously within an effect can trigger cascading renders  react/set-state-in-effect
          at a.jsx:4:5

      note: Avoid calling setState() directly within an effect
      note: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system.
      note: React Compiler skipped optimizing this component or hook. Additional guidance: https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
      3 |   useEffect(() => {
            ^
      note: This is the containing effect
         at a.jsx:3:3

      Linted 1 file"
    `);
    expect(exitCode).toBe(1);
  });

  test("agent, which is the default for an agent, is oxlint's format: one line, with the help", async () => {
    const [explicit, detected] = await Promise.all([lint(files, ["-f", "agent"]), lint(files, [], { AGENT: "1" })]);
    expect(explicit.stdout).toMatchInlineSnapshot(
      `"a.jsx:4:5: error react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system."`,
    );
    expect(detected.stdout).toBe(explicit.stdout);
    expect({ explicit: explicit.exitCode, detected: detected.exitCode }).toEqual({ explicit: 1, detected: 1 });
  });
});

describe.concurrent(
  `bun lint: the React Compiler rules match eslint-plugin-react-hooks ${expected.eslint.plugin}`,
  () => {
    /** Lints with the ESLint config. Returns the `-f json` results for each file that has messages. */
    async function messages(files: Files) {
      const { raw, stderr, exitCode, directories } = await lint({ "eslint.config.js": eslintConfig, ...files }, [
        "-f",
        "json",
      ]);
      if (!raw.startsWith("[")) throw new Error(`No report (exit ${exitCode}): ${stderr}`);
      return { files: byEslintFile(JSON.parse(raw), directories), exitCode };
    }
    const linted = (files: Files) =>
      Object.fromEntries(
        Object.entries(files).filter(
          ([name]) => !expected.eslint.without.includes(name) && !name.includes("node_modules/"),
        ),
      );

    test(
      "on oxlint's test cases: the rule, location and first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.cases));
        expect(briefly(files)).toEqual(expected.eslint.cases);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    test(
      "on the compiler's fixtures: the rule, location and first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.fixtures));
        expect(briefly(files)).toEqual(expected.eslint.fixtures);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    // Matches the plugin. The report is located at the first missing dependency.
    test("missing dependencies are sorted with localeCompare", async () => {
      const { files, exitCode } = await messages(unlisted);
      const found = Object.fromEntries(
        Object.entries(files).map(([name, { messages }]) => [
          name,
          messages
            .filter(it => it.ruleId === "react-hooks/memo-dependencies")
            .map(it => [`${it.line}:${it.column}-${it.endLine}:${it.endColumn}`, ...missingIn(it.message)]),
        ]),
      );
      expect(found).toEqual({
        "case.jsx": [["4:37-4:40", "bar", "Foo"]],
        "names.jsx": [["4:73-4:75", "_a", "$a", "a", "A", "a1", "a10", "a9", "b", "B", "e", "é", "f", "z"]],
        "number.jsx": [["4:37-4:38", "x"]],
        "paths.jsx": [
          [
            "4:63-4:67",
            "x._c",
            "x.$d",
            "x.a",
            "x.A",
            "x.a1",
            "x.a10",
            "x.a9",
            "x.b",
            "x.B",
            "x.e",
            "x.é",
            "x.f",
            "x.z",
          ],
        ],
        "some.jsx": [["4:44-4:49", "alpha", "Zed"]],
      });
      expect(exitCode).toBe(1);
    });

    // The value is one of two values, so it has both of their reasons, and so does anything read from it.
    test("when a value is frozen for two reasons, the message uses the one the compiler prefers, whichever came first", async () => {
      const component = (first: string, second: string) => `function Component(props) {
  const context = useContext(Context);
  const value = props.flag ? ${first} : ${second};
  value.inner.x = 1;
  return <div />;
}
`;
      const { files, exitCode } = await messages({
        "props-first.jsx": component("props.a", "context"),
        "context-first.jsx": component("context", "props.a"),
      });
      const isAboutContext = (name: string) =>
        files[name].messages
          .filter(it => it.ruleId === "react-hooks/immutability")
          .map(it => it.message.includes("Modifying a value returned from 'useContext()' is not allowed"));
      expect({
        propsFirst: isAboutContext("props-first.jsx"),
        contextFirst: isAboutContext("context-first.jsx"),
      }).toEqual({
        propsFirst: [true],
        contextFirst: [true],
      });
      expect(exitCode).toBe(1);
    });

    test("on complete messages, suggestions, disable comments, and files the plugin doesn't compile", async () => {
      const { files, exitCode } = await messages(eslintSmall);
      expect(files).toEqual(expected.eslint.small);
      // Nothing is reported for `$FlowFixMe[react-rule-hook]` and `[react-rule-unsafe-ref]`, for a file with a
      // decorator, or for a component without a name.
      expect(briefly(files)).toEqual({
        "casts.tsx": [
          "react-hooks/static-components 7:8-7:13 Error: Cannot create components during render",
          "react-hooks/immutability 13:4-13:16 Error: This value cannot be modified",
          "react-hooks/refs 19:22-19:40 Error: Cannot access refs during render",
          "react-hooks/refs 20:19-20:30 Error: Cannot access refs during render",
          "react-hooks/memo-dependencies 25:39-25:46 Error: Found missing memoization dependencies",
          "react-hooks/use-memo 25:50-25:66 Error: Expected the dependency list to be an array of simple expressions (e.g. `x`, `x.y.z`, `x?.y?.z`)",
          "react-hooks/immutability 30:4-30:33 Error: This value cannot be modified",
          "react-hooks/immutability 35:3-35:14 Error: This value cannot be modified",
        ],
        "defaults.tsx": [
          "7:37-7:63",
          "7:48-7:63",
          "8:13-8:21",
          "12:34-12:60",
          "12:45-12:60",
          "13:14-13:22",
          "20:30-20:56",
          "20:41-20:56",
          "21:10-21:18",
          "25:11-25:37",
          "25:22-25:37",
          "26:14-26:22",
        ].map(
          position =>
            `react-hooks/hooks ${position} Error: Hooks may not be referenced as normal values, they must be called. See https://react.dev/reference/rules/react-calls-components-and-hooks#never-pass-around-hooks-as-regular-values`,
        ),
        "defaults-with-jsx.jsx": [
          ["todo 1:28-1:57 Todo", "ObjectExpression"],
          ["todo 5:29-5:42 Todo", "ArrowFunctionExpression"],
          ["static-components 6:11-6:16 Error: Cannot create components during render"],
          ["todo 9:28-9:35 Todo", "JSXElement"],
          ["todo 17:28-17:37 Todo", "ArrayExpression"],
          ["todo 21:28-21:34 Todo", "TaggedTemplateExpression"],
        ].map(([start, kind]) =>
          kind === undefined
            ? `react-hooks/${start}`
            : `react-hooks/${start}: (BuildHIR::node.lowerReorderableExpression) Expression type \`${kind}\` cannot be safely reordered`,
        ),
        // Two rules report at the same start position. They're ordered as in the config, regardless of where the
        // reports end.
        "react-by-its-name.jsx": [
          "react-hooks/memo-dependencies 5:47-5:54 Error: Found missing memoization dependencies",
          "react-hooks/use-memo 5:47-5:56 Error: Expected the dependency list to be an array of simple expressions (e.g. `x`, `x.y.z`, `x?.y?.z`)",
        ],
        "fbt.jsx": [
          "react-hooks/todo 2:3-2:13 Todo: (BuildHIR::lowerStatement) Handle var kinds in VariableDeclaration",
          "react-hooks/todo 5:8-5:18 Todo: Support duplicate fbt tags",
          "react-hooks/todo 25:8-25:18 Todo: Support duplicate fbt tags",
        ],
        "disabled.jsx": [],
        // All three are reported at the first write.
        "writes.jsx": Array(3).fill("react-hooks/immutability 5:3-5:4 Error: This value cannot be modified"),
        "flow-other.jsx": ["react-hooks/refs 4:17-4:28 Error: Cannot access refs during render"],
        "javascript.jsx": ["react-hooks/memo-dependencies 2:40-2:41 Error: Found extra memoization dependencies"],
        "long.jsx": [
          "react-hooks/todo 3:3-15:4 Todo: (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        ],
        "typescript.tsx": ["react-hooks/memo-dependencies 2:40-2:41 Error: Found extra memoization dependencies"],
      });
      expect(files["disabled.jsx"].suppressed.map(it => it.ruleId)).toEqual(["react-hooks/refs"]);
      expect(files["typescript.tsx"].messages[0].suggestions).toEqual([
        { desc: "Update dependencies", range: [92, 98], text: "[a]" },
      ]);
      expect(files["typescript.tsx"].messages[0].message).toMatchInlineSnapshot(`
        "Error: Found extra memoization dependencies

        Extra dependencies can cause a value to update more often than it should, resulting in performance problems such as excessive renders or effects firing too often.

        <dir>/typescript.tsx:2:40
          1 | function Component({ a, b }: { a: number; b: number }) {
        > 2 |   const value = useMemo(() => [a], [a, b]);
            |                                        ^ Unnecessary dependency \`b\`
          3 |   return <div>{value}</div>;
          4 | }
          5 |

        Inferred dependencies: \`[a]\`"
      `);
      expect(files["javascript.jsx"].messages[0].suggestions).toEqual([]);
      expect(files["javascript.jsx"].messages[0].message).toMatchInlineSnapshot(`
        "Error: Found extra memoization dependencies

        Extra dependencies can cause a value to update more often than it should, resulting in performance problems such as excessive renders or effects firing too often.

          1 | function Component({ a, b }) {
        > 2 |   const value = useMemo(() => [a], [a, b]);
            |                                        ^ Unnecessary dependency \`b\`
          3 |   return <div>{value}</div>;
          4 | }
          5 |"
      `);
      // The middle of a location that spans more than ten lines is omitted. An old-style diagnostic ends in two line
      // breaks.
      expect(files["long.jsx"].messages[0].message.split("\n")).toEqual([
        "Todo: (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        "",
        "   1 | function Component(props) {",
        "   2 |   let value = 0;",
        ">  3 |   try {",
        "     |   ^^^^^",
        ">  4 |     value += props.a;",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        ">  5 |     value += props.b;",
        "     …",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        "> 14 |     props.done();",
        "     | ^^^^^^^^^^^^^^^^^^^^^",
        "> 15 |   }",
        "     | ^^^^ (BuildHIR::lowerStatement) Handle TryStatement without a catch clause",
        "  16 |   return <div>{value}</div>;",
        "  17 | }",
        "  18 |",
        "",
        "",
      ]);
      expect(exitCode).toBe(1);
    });
  },
);

// With only a bunfig.toml, `react/x` is the plugin's `react-hooks/x`. It reports these inputs as it did before the
// oxlint rules moved to oxlint 1.95, which reports them differently.
describe.concurrent("bun lint: with no ESLint or oxlint config, the React Compiler rules don't follow oxlint", () => {
  /** Lints with a bunfig.toml that has only `rules`. Returns the rule, location and a line of each compiler message. */
  async function found(rules: string, files: Files, line: number) {
    const { raw, stderr, exitCode, directories } = await lint({ "bunfig.toml": `[lint.rules]\n${rules}\n`, ...files }, [
      "-f",
      "json",
    ]);
    if (!raw.startsWith("[")) throw new Error(`No report (exit ${exitCode}): ${stderr}`);
    const messages = Object.values(byEslintFile(JSON.parse(raw), directories)).flatMap(it => it.messages);
    return {
      found: messages
        .filter(it => it.ruleId?.startsWith("react"))
        .map(
          it => `${it.ruleId} ${it.line}:${it.column}-${it.endLine}:${it.endColumn} ${it.message.split("\n")[line]}`,
        ),
      exitCode,
    };
  }

  const calls: Files = {
    "calls.jsx": `import { Child, GET, Item } from "./module";

export function Month() {
  const now = new Date(0);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return <div>{start.toString()}</div>;
}

export function Method(props) {
  return <div>{props.api.GET()}</div>;
}

export function MixedCaseMethod(props) {
  return <div>{props.api.Child()}</div>;
}

export function Function() {
  return <div>{GET()}</div>;
}

export function MixedCaseFunction() {
  return <div>{Child()}</div>;
}

export function AnotherFunction() {
  return <div>{Item()}</div>;
}
`,
  };
  const reported = [
    "5:26-5:78 UTC may be a component.",
    "10:16-10:31 GET may be a component.",
    "14:16-14:33 Child may be a component.",
    "22:16-22:23 Child may be a component.",
    "26:16-26:22 Item may be a component.",
  ].map(it => `react-hooks/capitalized-calls ${it}`);

  // oxlint reports neither `Date.UTC()` nor `props.api.GET()`.
  test("a method whose name is in capitals is reported, and a function isn't", async () => {
    const result = await found(`"react/capitalized-calls" = "error"`, calls, 2);
    expect(result).toEqual({ found: reported, exitCode: 1 });
  });

  // They're options of oxlint's rule, where these allow `Child()` and `Item()`. The plugin's rule takes any object and
  // doesn't read it.
  test("`allow` and `allowPattern` of react/capitalized-calls allow nothing", async () => {
    const options = `{ allow = ["Child"], allowPattern = "^It" }`;
    const result = await found(`"react/capitalized-calls" = ["error", ${options}]`, calls, 2);
    expect(result).toEqual({ found: reported, exitCode: 1 });
  });

  // oxlint reports none of them.
  test("a shared value from react-native-reanimated is what any hook returns, and can't be written", async () => {
    const result = await found(
      `"react/immutability" = "error"`,
      {
        "shared.jsx": `import { Button, View } from "react-native";
import { useSharedValue, withSpring } from "react-native-reanimated";

export function Randomize() {
  const progress = useSharedValue(0);
  return <Button onPress={() => (progress.value = Math.random())} title="Randomize" />;
}

export function usePressToGrow() {
  const width = useSharedValue(100);
  return () => {
    width.value = withSpring(width.value + 50);
  };
}

export function InRender(props) {
  const position = useSharedValue(0);
  position.value = props.start;
  return <View data-position={position.value} />;
}
`,
      },
      0,
    );
    expect(result).toEqual({
      found: [
        "6:27-6:65 Error: Cannot modify local variables after render completes",
        "6:34-6:42 Error: This value cannot be modified",
        "11:10-13:4 Error: Cannot modify local variables after render completes",
        "12:5-12:10 Error: This value cannot be modified",
        "18:3-18:11 Error: This value cannot be modified",
      ].map(it => `react-hooks/immutability ${it}`),
      exitCode: 1,
    });
  });
});
