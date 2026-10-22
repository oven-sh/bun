// The rules that report what the React Compiler finds: the 22 `react/*` of oxlint, and the 27 `react-hooks/*` of
// eslint-plugin-react-hooks. What oxlint and ESLint report for the same inputs is in oracle/react-compiler/expected.json;
// expected.ts there writes it.
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

/** What expected.json has for a directory. The order in a file is left out. */
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
const placesOf = (found: unknown[]) =>
  (found as Found[]).map(it => [it.code, it.labels[0].span.line, it.labels[0].span.column]).sort();

const memo = (params: string, values: string, listed: string) => `import { useMemo } from "react";

export function Component({ ${params} }) {
  const value = useMemo(() => [${values}], [${listed}]);
  return <div>{value}</div>;
}
`;
/** Dependencies that are not listed. The two tools sort them differently. */
const unlisted: Files = {
  "case.jsx": memo("Foo, bar", "Foo, bar", ""),
  "names.jsx": memo("_a, $a, a1, a10, a9, A, a, B, b, é, e, f, z", "z, f, é, e, b, B, a, A, a9, a10, a1, $a, _a", ""),
  "number.jsx": memo("x", "x.z, x[10], x[9], x.B, x.b, x.a, x.A, x.$d, x._c", ""),
  "paths.jsx": memo("x", "x.z, x.B, x.b, x.a, x.A, x.$d, x._c, x.a9, x.a10, x.a1, x.é, x.e, x.f", ""),
  "some.jsx": memo("Zed, alpha, Beta, gamma", "gamma, Zed, alpha, Beta", "gamma, Beta"),
};
const missingIn = (text: string) => Array.from(text.matchAll(/Missing dependency `([^`]+)`/g), it => it[1]);

describe.concurrent(`bun lint: the rules of the React Compiler report what oxlint ${expected.oxlint} reports`, () => {
  test(
    "for oxlint's own test cases",
    async () => {
      const { diagnostics, files, exit } = await report({ ".oxlintrc.json": rc(), ...expected.cases });
      expect(diagnostics).toEqual(expected.reports.cases.diagnostics);
      // A case that is not valid has a diagnostic of its rule, a valid one has none.
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
    "for fixtures of the compiler",
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
        "react(rule-suppression)",
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

  test("nothing for what is neither a component nor a hook, unless 'use memo' asks for it", async () => {
    const { diagnostics, files, exit } = await report(small["not React"]);
    expect(diagnostics).toEqual(expected.reports["not React"].diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["asked-for.js"]);
    expect(files).toBe(3);
    expect(exit).toBe(1);
  });

  test("disable comments: by any name of the plugin or none, of ESLint and of oxlint, at the first label", async () => {
    const { diagnostics, files, exit } = await report(small.comments);
    expect(diagnostics).toEqual(expected.reports.comments.diagnostics);
    // All others are silenced.
    expect(Object.keys(diagnostics)).toEqual([
      "before-the-second-label.jsx",
      "eslint/react.purity.jsx",
      "oxlint/react.purity.jsx",
      "until-enabled.jsx",
    ]);
    expect(files).toBe(expected.reports.comments.files);
    expect(exit).toBe(1);
  });

  test("react/todo on, off or alone: the other rules report the same", async () => {
    const { diagnostics, exit } = await report(small.todo);
    expect(diagnostics).toEqual(expected.reports.todo.diagnostics);
    const isTodo = (it: unknown) => (it as { code: string }).code === "react(todo)";
    expect(diagnostics["on/a.jsx"].filter(it => !isTodo(it))).toEqual(diagnostics["off/a.jsx"]);
    expect(diagnostics["on/a.jsx"].filter(isTodo)).toEqual(diagnostics["alone/a.jsx"]);
    expect(diagnostics["alone/a.jsx"]).toHaveLength(2);
    expect(exit).toBe(1);
  });

  test("what oxc's fork of the compiler takes or says otherwise", async () => {
    const { diagnostics, files, exit } = await report(small.fork);
    expect(diagnostics).toEqual(expected.reports.fork.diagnostics);
    // The others are compiled.
    expect(Object.keys(diagnostics)).toEqual([
      "arguments.jsx",
      "captured-target.jsx",
      "catch.jsx",
      "clock.jsx",
      "computed-string.jsx",
      "default.jsx",
      "import.jsx",
      "own-name-of-the-component.jsx",
      "parentheses.tsx",
      "ref-in-memo.jsx",
      "tagged-template.jsx",
      "unreachable.jsx",
      "update.jsx",
      "virtual.jsx",
    ]);
    expect(placesOf(diagnostics["captured-target.jsx"])).toEqual([["react(invariant)", 12, 9]]);
    expect(files).toBe(expected.reports.fork.files);
    expect(exit).toBe(1);
  });

  test("a type cast has a place of its own, and hides what it is a cast of", async () => {
    const { diagnostics, exit } = await report(small.casts);
    expect(diagnostics).toEqual(expected.reports.casts.diagnostics);
    expect(diagnostics["casts.tsx"]).toHaveLength(8);
    expect(exit).toBe(1);
  });

  test("`for (;;)` is compiled, and `x = d` in a pattern has a place of its own", async () => {
    const { diagnostics, exit } = await report(small.lowering);
    expect(diagnostics).toEqual(expected.reports.lowering.diagnostics);
    expect(rulesIn({ it: diagnostics["forever.tsx"] })).toEqual(["react(immutability)", "react(refs)"]);
    expect(diagnostics["defaults.tsx"]).toHaveLength(12);
    expect(exit).toBe(1);
  });

  test("loops behind loops are gone over in the compiler's order", async () => {
    const { diagnostics, exit } = await report(small.order);
    expect(diagnostics).toEqual(expected.reports.order.diagnostics);
    expect(diagnostics["order.jsx"]).toHaveLength(4);
    expect(exit).toBe(1);
  });

  test("each write to a captured variable is reported where it is", async () => {
    const { diagnostics, exit } = await report(small.writes);
    expect(diagnostics).toEqual(expected.reports.writes.diagnostics);
    expect(placesOf(diagnostics["writes.jsx"])).toEqual([
      ["react(immutability)", 5, 3],
      ["react(immutability)", 7, 5],
      ["react(immutability)", 9, 3],
    ]);
    expect(exit).toBe(1);
  });

  test("a module's own useMemo is not React's, and what has JSX in it cannot be evaluated earlier", async () => {
    const { diagnostics, exit } = await report(small.names);
    expect(diagnostics).toEqual(expected.reports.names.diagnostics);
    expect(diagnostics["own-hooks.tsx"]).toBeUndefined();
    expect(diagnostics["callback-of-map.jsx"]).toBeUndefined();
    expect(placesOf(diagnostics["react-by-its-name.jsx"]).map(it => it[1])).toEqual([5, 5]);
    expect(placesOf(diagnostics["fbt.jsx"])).toEqual([
      ["react(todo)", 2, 3],
      ["react(todo)", 5, 8],
    ]);
    // Not for D, whose default has no JSX in it.
    expect(placesOf(diagnostics["defaults-with-jsx.jsx"])).toEqual([
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

  // oxlint 1.87.0 reports the same up to 1,500 of them, in the last line but two, and ends by SIGSEGV from 2,000.
  test(
    "what is declared at the top is read behind 4,000 optional chains",
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

  // oxlint and eslint-plugin-react-hooks take all the memory there is for functions like these.
  test(
    "a small function whose types are made of each other takes no time to speak of",
    async () => {
      const { diagnostics, exit } = await report({
        ".oxlintrc.json": rc(),
        "types.jsx": `function Component(props) { let a, b, c, d, e; l1: for (let i2 = 0; i2 < 0; i2++) {  try {  do { try { switch (props.x) { case 0: { }  case 1: { [a = 3, b = b] = props.l;  }  case 2: { } default: { } case 3: { b = a; }  } } catch (err) { }  } while (props.x); } catch (err) { } } return <div>{a}{b}{c}{d}{e}</div>; }`,
        "cycle.jsx": `function Component(props) { let a, b, c, d, e; while (props.x) { switch (c?.p) { case 0: { while (props.y) { switch (f0) { default: {   try { } catch (err) { } for (const x3 of 0) {  e = ((props.x && (props.x ?? d)) || { });  } ({p: a = e, q: c} = props.o); } case 0: { if (fprops.x) {  d = (props.y && (fprops.x ? a : f0)); } }  case 1: { }  }  while ((f((props.x ? null : a)) < props.x)) { if ((0 === 0)) { ({p: e = b, q: a} = props.o); d = d;  }  } } } case 1: { } default: { } }   }    a = { };  return <div>{a}{b}{c}{d}{e}</div>; }`,
      });
      // Nothing is wrong in them.
      expect(diagnostics).toEqual({});
      expect(exit).toBe(0);
    },
    slow,
  );

  // oxlint does not end in a minute on this one.
  test(
    "a small function whose refs' types are made of each other takes no time and no memory to speak of",
    async () => {
      const { diagnostics, exit, peak } = await report({
        ".oxlintrc.json": rc(),
        "refs.jsx": `function Component(props) { let a, b, c, d, e; a += (([props.x, c] || props.x) ? ({k: props.x} ?? \`\${props.x}-\${props.x}\`) : d.p?.q); e = ((() => (d.p?.q)) ? [<b x={b}>{c}</b>, f(b)] : ((e ? a : c) < e)); if (([(null || props.x), {k: c, [props.x]: d}] || c)) { for (let i7 = 0; i7 < f(null); i7++) { while (c.m(d)) { const n8 = {}; n8.p = ((null ?? 2) || d); f(n8); for (let i9 = 0; i9 < (props.x === c); i9++) { if (2) { b = [a, f(0)]; b -= ((() => ((b ? props.x : d))) ? null : \`\${(a - d)}-\${d}\`); b = [props.x, ([props.x, props.y] ? \`\${null}-\${props.y}\` : (null || props.x))]; } } f(d, a); a = [a, c]; c = [a, c]; c = {k: c, j: a}; { const s = (props.y ? (null + b) : {k: 1}); f(s); { const s = a; f(() => s); } } } } } else { if ((props.x ? [(props.x + e), c] : ({k: c} && (c ? c : props.y)))) { for (const z2 of props.l) { switch (3) { case 0: {  } case 1: { if ((e?.p.q && props.x)) { f(b, d); e = (() => ((c?.p === (c < null)))); } else {  } e = null; l1: { b = (f((props.x ? c : a)) === (c - c.p.q)); f(e, props.x); b = b + 1; f(d, props.x); } } break; default: {  } } f(e); e = \`\${\`\${null}-\${a}\`}-\${c}\`; } f(e); [d = 6, a = 4] = props.l; } a = c?.p?.[0]; if (1) { for (let z6 = 0; z6 < 3; z6++) { if (((d < 4) ? (props.y - props.x) : [e, props.y])) { do { e = ((() => ((null === a))) === f(a)); } while (props.x); try { f(e); a = a; const t3 = [([props.y, null] || a), ((props.y || null) ? {k: c} : {k: null})]; f(t3); f(e, 2); f(e); } catch (err) { d = e; d = f(a); f(c, props.x); e = (((a - null) + props.x) < ([d, props.y] ?? (props.y - props.y))); } a = {k: b}; f(d, a); if (null) { a = []; } d = {k: d, j: a}; } else if ((props.x ? {k: a} : null)) { if (c) { d = d; d = (() => (b)); } } else { while ({k: {k: f(d)}}) {  } } f(c); c = (() => ({k: c})); } f(c); e = d + 1; } e = props.y; } if (props.o.m((() => (props.o.m(e))))) { const o12 = { m() { return ((() => (d)) + null); }, n: () => (a.p?.q), k: props.x }; f(o12.m(), o12.n()); } c = (<b x={(b ? e : null)}>{[props.y, b]}</b> ? f((c === a)) : props.x); return <C a={a} b={b} {...e}>{c}{d}</C>; }`,
      });
      // Upstream's own, after ten rounds: "Ref type environment did not converge".
      expect(rulesIn(diagnostics)).toEqual(["react(invariant)"]);
      expect(peak).toBeLessThan((isDebug || isASAN ? 1500 : 300) * 1024 * 1024);
      expect(exit).toBe(1);
    },
    slow,
  );

  // oxlint 1.87.0 finds nothing either up to 1,000 of them, in 16 s, and does not end in a minute at 3,000.
  test(
    "objects that each hold the one before, and the first a ref, take memory in proportion",
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

  // The threads of `bun lint` have more stack than a thread usually has. That is for what cannot ask how much is left.
  // A thread usually has 4 MB, which hold some 700 levels, and 18 MB on Windows. With all of the stack it would be eight times as deep.
  test.skipIf(isDebug || isASAN)(
    "what is nested deeper than the stack of a usual thread holds is left alone",
    async () => {
      const depth = isWindows ? 10_000 : 2_000;
      const { diagnostics, exit } = await report({
        ".oxlintrc.json": rc(),
        "deep.tsx": long(
          1,
          () => "if (props.a) {".repeat(depth) + "f(bad);" + "}".repeat(depth),
          units => [units, "<div>{bad}</div>"],
        ),
      });
      expect(placesOf(diagnostics["deep.tsx"])).toEqual([["react(todo)", 3, 17]]);
      expect(exit).toBe(1);
    },
  );

  // What oxlint 1.87 reports.
  test("dependencies that are missing are in the order of their bytes, after the list", async () => {
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

  test("a try in which nothing but a read that nobody uses can throw does not end the process", async () => {
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

  test("nothing for a path that has node_modules in it", async () => {
    const { diagnostics, files, exit } = await report(small.node_modules);
    expect(diagnostics).toEqual(expected.reports.node_modules.diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["a.jsx"]);
    // They are linted, but not compiled.
    expect(files).toBe(4);
    expect(exit).toBe(1);
  });
});

describe.concurrent("bun lint: all labels, the help and the note of a diagnostic", () => {
  const files = { ".oxlintrc.json": rc(["react/set-state-in-effect"]), "a.jsx": twoLabels };

  test("pretty", async () => {
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

  test("agent, which is the default for an agent, is oxlint's: a line, with the help", async () => {
    const [named, detected] = await Promise.all([lint(files, ["-f", "agent"]), lint(files, [], { AGENT: "1" })]);
    expect(named.stdout).toMatchInlineSnapshot(
      `"a.jsx:4:5: error react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders help: Effects should synchronize React with external systems. Calling setState synchronously inside an effect starts another render and is usually unnecessary. Derive the value during render, initialize state directly, or update it from the event that caused the change. Use an effect only when synchronizing with an external system."`,
    );
    expect(detected.stdout).toBe(named.stdout);
    expect({ named: named.exitCode, detected: detected.exitCode }).toEqual({ named: 1, detected: 1 });
  });
});

describe.concurrent(
  `bun lint: the rules of the React Compiler report what eslint-plugin-react-hooks ${expected.eslint.plugin} reports`,
  () => {
    /** What ESLint's `-f json` has for each file that has messages. */
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
      "for oxlint's test cases: the rule, the place, the first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.cases));
        expect(briefly(files)).toEqual(expected.eslint.cases);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    test(
      "for fixtures of the compiler: the rule, the place, the first line",
      async () => {
        const { files, exitCode } = await messages(linted(expected.fixtures));
        expect(briefly(files)).toEqual(expected.eslint.fixtures);
        expect(exitCode).toBe(1);
      },
      slow,
    );

    // What the plugin reports. The report is at the first.
    test("dependencies that are missing are in the order of localeCompare", async () => {
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

    // The value is one of two, so it has the reasons of both, and so has what is read from it.
    test("of two reasons for which a value is frozen the message has the one that the compiler prefers, whichever came first", async () => {
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

    test("the whole message, suggestions, comments, and files that the plugin does not compile", async () => {
      const { files, exitCode } = await messages(eslintSmall);
      expect(files).toEqual(expected.eslint.small);
      // Nothing for `$FlowFixMe[react-rule-hook]` and `[react-rule-unsafe-ref]`, for a file with a decorator, and for a component
      // without a name.
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
          place =>
            `react-hooks/hooks ${place} Error: Hooks may not be referenced as normal values, they must be called. See https://react.dev/reference/rules/react-calls-components-and-hooks#never-pass-around-hooks-as-regular-values`,
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
        // Two rules at one place: in the order of the configuration, whatever their ends.
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
        // All at the first.
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
      // The middle of a place of more than ten lines is left out. A diagnostic of the older kind ends in two line breaks.
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
