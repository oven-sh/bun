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
/** Each diagnostic as its labels, which say where they are. */
const labelsOf = (found: unknown[]) =>
  (found as { labels: { label: string; span: { line: number; column: number } }[] }[])
    .map(it => it.labels.map(({ label, span }) => `${span.line}:${span.column} ${label}`))
    .sort();

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

// The compiler gives a ref a new identity at each join with another ref, and in each round where a prop is
// destructured. It joined what holds such a ref once for each path to it, so these took a time that is a power of
// their size. oxlint 1.87.0 and babel-plugin-react-compiler 1.0.0 still do.
/** `v1` returns `v0`, and `v0` is then assigned what holds `v1`, so its type holds its own earlier type. */
const cycleOverTwoRefs = (handlers: string, fields: string) => `import { useRef, useState } from "react";
import { mutate } from "lib";

export function Cycle(props) {
  const [st] = useState(props.a);
  const r1 = useRef(null);
  const r2 = useRef(null);
${handlers}  const w = () => () => [props.c ? r1 : r2];
  let v0 = [st, st];
  const v1 = () => v0;
  const v2 = { k0: v1, k1: v0, kw: w${fields} };
  const v3 = { k0: v2, k1: v1, k2: v0 };
  if (props.b) v0 = [...v2, v1, v3];
  if (props.c) v0 = [v3, v2, v0];
  if (props.d) v0 = [v0, v3, v2];
  return <div data-x={v0}>{st}</div>;
}
`;
/** As it is, and with two functions in it that access different refs. */
const cycles = {
  "cycle.jsx": cycleOverTwoRefs("", ""),
  "cycle-handlers.jsx": cycleOverTwoRefs(
    "  const h1 = () => {\n    r1.current = 1;\n  };\n  const h2 = () => r2.current;\n",
    ", h1, h2",
  ),
};
/** Each `o` holds the one before it and a function that returns that one: 2 to the power of `n` paths to the first. */
const pathsToARef = (params: string, first: string, ref: string, n: number) => `import { useRef } from "react";

export function Paths(${params}) {
  const r1 = useRef(null);
  const r2 = useRef(null);
  const o0 = ${first};
  const f0 = () => o0;
${Array.from({ length: n }, (_, k) => `  const o${k + 1} = [o${k}, f${k}];\n  const f${k + 1} = () => o${k + 1};`).join("\n")}
  return <div ref={${ref}} data-x={o${n}}>{a}</div>;
}
`;
/** Over one of two refs, and over a ref that is a prop. */
const paths = (n: number) => ({
  "paths.jsx": pathsToARef("{ a, c }", "[c ? r1 : r2]", "r1", n),
  "paths-prop.jsx": pathsToARef("{ a, inputRef }", "[inputRef]", "inputRef", n),
});
/** A write to a ref behind a guard on it: a ref that is one of two, from a join of arrays, is not the ref it was. */
const guarded = (name: string, body: string, handler = "") => `import { useRef } from "react";
export function ${name}(p) {
  const aRef = useRef(null);
  const bRef = useRef(null);
${body}
  return <div ref={aRef}${handler} />;
}
`;
const guardOnOneOfTwo = (n: number) => `const [x${n}Ref] = p.c ? [aRef] : [bRef];
    const [y${n}Ref] = p.d ? [aRef] : [bRef];
    if (x${n}Ref.current == null) y${n}Ref.current = p.v;`;
const guards = {
  "one-ref.jsx": guarded(
    "OneRef",
    `  const [xRef] = p.c ? [aRef] : [aRef];
  if (xRef.current == null) {
    xRef.current = p.v;
  }`,
  ),
  "two-refs.jsx": guarded(
    "TwoRefs",
    `  const [xRef] = p.c ? [aRef] : [bRef];
  if (xRef.current == null) {
    xRef.current = p.v;
  }`,
  ),
  "two-joins.jsx": guarded(
    "TwoJoins",
    `  const [xRef] = p.c ? [aRef] : [bRef];
  const [yRef] = p.d ? [aRef] : [bRef];
  if (xRef.current == null) {
    yRef.current = p.v;
  }`,
  ),
  "in-a-function.jsx": guarded(
    "InAFunction",
    `  const holder = p.c ? [aRef] : [bRef];
  const init = () => {
    const [xRef] = holder;
    if (xRef.current == null) {
      xRef.current = p.v;
    }
  };
  init();`,
  ),
  "in-a-later-round.jsx": guarded(
    "InALaterRound",
    `  let holder = null;
  for (let i = 0; i < p.n; i++) {
    if (holder != null) {
      if (holder[p.k].current == null) {
        holder[p.k].current = p.v;
      }
    }
    holder = p.c ? [aRef] : [bRef];
  }`,
  ),
  // The compiler leaves the run in which such refs are one at the first `x1Ref.current`. If that run went on, it
  // would not find what ends the other run in its first round, and each function would take its 10 rounds for each
  // round of the one around it: 30 seconds.
  "in-three-functions.jsx": guarded(
    "InThreeFunctions",
    `  const deep = () => {
    ${guardOnOneOfTwo(1)}
    return () => {
    ${guardOnOneOfTwo(2)}
    return () => {
    ${guardOnOneOfTwo(3)}
    let v0 = [p.a, p.a];
    const v1 = () => v0;
    const v2 = { k0: v1, k1: v0 };
    if (p.b) v0 = [v2, v1];
    return v0;
    };
    };
  };`,
    " onClick={deep}",
  ),
};

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

  test("reports nothing in a function that's neither a component nor a hook, unless it has 'use memo'", async () => {
    const { diagnostics, files, exit } = await report(small["not React"]);
    expect(diagnostics).toEqual(expected.reports["not React"].diagnostics);
    expect(Object.keys(diagnostics)).toEqual(["asked-for.js"]);
    expect(files).toBe(3);
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
    // The other files compile without diagnostics.
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

  // oxlint 1.87.0 reports the same with up to 1,500 of them, on the third line from the end, and crashes with SIGSEGV
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

  // oxlint and eslint-plugin-react-hooks use up all available memory on functions like these.
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

  // oxlint doesn't finish this one within a minute.
  test(
    "a small function with mutually recursive ref types compiles quickly and without much memory",
    async () => {
      const { diagnostics, exit, peak } = await report({
        ".oxlintrc.json": rc(),
        "refs.jsx": `function Component(props) { let a, b, c, d, e; a += (([props.x, c] || props.x) ? ({k: props.x} ?? \`\${props.x}-\${props.x}\`) : d.p?.q); e = ((() => (d.p?.q)) ? [<b x={b}>{c}</b>, f(b)] : ((e ? a : c) < e)); if (([(null || props.x), {k: c, [props.x]: d}] || c)) { for (let i7 = 0; i7 < f(null); i7++) { while (c.m(d)) { const n8 = {}; n8.p = ((null ?? 2) || d); f(n8); for (let i9 = 0; i9 < (props.x === c); i9++) { if (2) { b = [a, f(0)]; b -= ((() => ((b ? props.x : d))) ? null : \`\${(a - d)}-\${d}\`); b = [props.x, ([props.x, props.y] ? \`\${null}-\${props.y}\` : (null || props.x))]; } } f(d, a); a = [a, c]; c = [a, c]; c = {k: c, j: a}; { const s = (props.y ? (null + b) : {k: 1}); f(s); { const s = a; f(() => s); } } } } } else { if ((props.x ? [(props.x + e), c] : ({k: c} && (c ? c : props.y)))) { for (const z2 of props.l) { switch (3) { case 0: {  } case 1: { if ((e?.p.q && props.x)) { f(b, d); e = (() => ((c?.p === (c < null)))); } else {  } e = null; l1: { b = (f((props.x ? c : a)) === (c - c.p.q)); f(e, props.x); b = b + 1; f(d, props.x); } } break; default: {  } } f(e); e = \`\${\`\${null}-\${a}\`}-\${c}\`; } f(e); [d = 6, a = 4] = props.l; } a = c?.p?.[0]; if (1) { for (let z6 = 0; z6 < 3; z6++) { if (((d < 4) ? (props.y - props.x) : [e, props.y])) { do { e = ((() => ((null === a))) === f(a)); } while (props.x); try { f(e); a = a; const t3 = [([props.y, null] || a), ((props.y || null) ? {k: c} : {k: null})]; f(t3); f(e, 2); f(e); } catch (err) { d = e; d = f(a); f(c, props.x); e = (((a - null) + props.x) < ([d, props.y] ?? (props.y - props.y))); } a = {k: b}; f(d, a); if (null) { a = []; } d = {k: d, j: a}; } else if ((props.x ? {k: a} : null)) { if (c) { d = d; d = (() => (b)); } } else { while ({k: {k: f(d)}}) {  } } f(c); c = (() => ({k: c})); } f(c); e = d + 1; } e = props.y; } if (props.o.m((() => (props.o.m(e))))) { const o12 = { m() { return ((() => (d)) + null); }, n: () => (a.p?.q), k: props.x }; f(o12.m(), o12.n()); } c = (<b x={(b ? e : null)}>{[props.y, b]}</b> ? f((c === a)) : props.x); return <C a={a} b={b} {...e}>{c}{d}</C>; }`,
      });
      // This is upstream's own error after ten iterations: "Ref type environment did not converge".
      expect(rulesIn(diagnostics)).toEqual(["react(invariant)"]);
      expect(peak).toBeLessThan((isDebug || isASAN ? 1500 : 300) * 1024 * 1024);
      expect(exit).toBe(1);
    },
    slow,
  );

  // oxlint 1.87.0 also reports nothing with up to 1,000 of them, in 16 s, and doesn't finish within a minute at 3,000.
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

  // Each level joined two different refs again, which made a copy of all the levels below it, as deep as the chain is
  // long: 3 GB for 10,000, and from 10,950 on, or from 2,000 in a debug build, it did not have the stack for it.
  test(
    "a chain of objects that each contain the previous one, starting from one of two refs, takes linear memory",
    async () => {
      const n = isDebug || isASAN ? 2000 : 12000;
      const chain = Array.from({ length: n }, (_, k) => `  const o${k + 1} = { a: o${k} };`).join("\n");
      const { diagnostics, exit, peak } = await report({
        ".oxlintrc.json": rc(),
        "chain.jsx": `import { useRef } from "react";

export function Chain(props) {
  const r1 = useRef(0);
  const r2 = useRef(0);
  const o0 = { a: props.c ? r1 : r2 };
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

  // oxlint 1.87.0 doesn't finish these within a minute.
  test("a type that holds its own earlier type and one of two refs doesn't converge, and that's reported at once", async () => {
    const { diagnostics, exit } = await report({ ".oxlintrc.json": rc(), ...cycles });
    expect({
      cycle: locationsOf(diagnostics["cycle.jsx"]),
      handlers: locationsOf(diagnostics["cycle-handlers.jsx"]),
    }).toEqual({
      cycle: [["react(invariant)", 4, 17]],
      handlers: [["react(invariant)", 4, 17]],
    });
    expect(exit).toBe(1);
  });

  // oxlint 1.87.0 takes 80 s for 20 of them over one of two refs, and twice that for each one more.
  test("objects that each contain the previous one and a function that returns it, starting from a ref, are done at once", async () => {
    const { diagnostics, exit } = await report({ ".oxlintrc.json": rc(), ...paths(isDebug || isASAN ? 64 : 128) });
    expect(diagnostics).toEqual({});
    expect(exit).toBe(0);
  });

  // As oxlint 1.87.0 reports each. The compiler gives one identity to the refs that come out of joins of what holds
  // them, and what it then finds must be what it finds with an identity for each.
  test("a guard on a ref that is one of two lets no write through, also in a function and in a later round", async () => {
    const { diagnostics, exit } = await report({ ".oxlintrc.json": rc(), ...guards });
    expect(Object.fromEntries(Object.entries(diagnostics).map(([path, found]) => [path, labelsOf(found)]))).toEqual({
      "in-a-function.jsx": [["12:3 This function accesses a ref value", "8:9 The ref is accessed here"]],
      "in-a-later-round.jsx": [["9:20 Cannot update ref value during render", "9:9 This value is a ref"]],
      "in-three-functions.jsx": [["2:17 Ref type environment did not converge"]],
      "two-joins.jsx": [["8:9 Cannot update ref value during render", "8:5 This value is a ref"]],
      "two-refs.jsx": [
        ["6:7 Cannot access ref value during render"],
        ["7:9 Cannot update ref value during render", "7:5 This value is a ref"],
      ],
    });
    expect(exit).toBe(1);
  });

  // The second label is where one of the functions accesses a ref. The compiler keeps one type for two that are the same
  // but for that place, and which of them it keeps must not depend on how it joins the refs next to them.
  test("a call of one of two functions that access refs has oxlint's second label, also next to joins of two refs", async () => {
    const component = (body: string) => `import { useRef } from "react";
export function Component(p) {
  const ra = useRef(null);
  const rb = useRef(null);
  const rc = useRef(null);
  const rd = useRef(null);
  const f1 = () => { ra.current = 1; };
  const f2 = () => rb.current;
${body}
  return <div />;
}
`;
    const { diagnostics, exit } = await report({
      ".oxlintrc.json": rc(),
      // One of two arrays stands for their join.
      "two-arrays.jsx": component(`  const k = p.q ? [ra] : [rb];
  const j = [rc];
  const o1 = [j, f1];
  const o2 = [k, f2];
  const o = p.e ? o1 : o2;
  const [g] = o;
  g();`),
      "two-joins.jsx": component(`  const k = p.q ? [ra] : [rb];
  const j = p.q ? [rc] : [rd];
  const o1 = [j, f1];
  const o2 = [k, f2];
  const o = p.e ? o1 : o2;
  const [g] = o;
  g();`),
      // What a variable has stands for what is stored in it.
      "stored.jsx": component(`  const k = p.q ? [ra] : [rb];
  const k2 = p.r ? [ra] : [rb];
  const o = p.e ? f1 : k;
  const s2 = p.z ? f2 : k2;
  o.x = s2;
  o();`),
      // What an array had in the round before stands for what it has, in a function.
      "in-a-loop.jsx": `import { useRef } from "react";
export function Component(p) {
  const ra = useRef(null);
  const rb = useRef(null);
  const rc = useRef(null);
  const rd = useRef(null);
  const k = p.q ? [ra] : [rb];
  const k2 = p.r ? [rc] : [rd];
  const f1 = () => { ra.current = 1; };
  const w = () => {
    let f2 = null;
    let o = null;
    for (let i = 0; i < p.n; i++) {
      o = [k, k2, f2, f1];
      f2 = () => rb.current;
    }
    return o;
  };
  const [g] = w();
  g();
  return <div />;
}
`,
      // Two paths lead to the same two types, and only what is down one of them differs: `loud`.
      "two-paths.jsx": `import { useRef } from "react";

export function Comp(props) {
  const ra = useRef(null);
  const rb = useRef(null);
  const k1 = () => [ra];
  const k2 = () => [rb];
  const loud = () => ra.current;
  const o0 = [k1];
  const f0 = () => o0;
  const o1 = [o0, f0];
  const f1 = () => o1;
  const q = [k2];
  const g = () => q;
  const p = [k2, loud];
  const pv = [p, g];
  const qr = [q, g];
  const gr = () => qr;
  const o0b = [k1];
  const f0b = () => o0b;
  const o1b = [o0b, f0b];
  const f1b = () => o1b;
  const xb = [o1b, f1b];
  const cap0 = () => xb;
  let y = cap0;
  const early = () => y;
  let x = [o1, f1];
  const cap = () => x;
  x = [pv, gr];
  y = cap;
  const e1 = early();
  const e2 = e1();
  const [a] = e2;
  const [b] = a;
  const [c] = b;
  c();
  return <div>{props.a}</div>;
}
`,
    });
    expect(Object.fromEntries(Object.entries(diagnostics).map(([path, found]) => [path, labelsOf(found)]))).toEqual({
      "in-a-loop.jsx": [["20:3 This function accesses a ref value", "15:18 The ref is accessed here"]],
      "stored.jsx": [
        ["13:4 Cannot update ref value during render", "13:3 This value is a ref"],
        ["14:3 This function accesses a ref value", "8:20 The ref is accessed here"],
      ],
      "two-arrays.jsx": [["15:3 This function accesses a ref value", "7:24 The ref is accessed here"]],
      "two-joins.jsx": [["15:3 This function accesses a ref value", "7:24 The ref is accessed here"]],
      "two-paths.jsx": [["36:3 This function accesses a ref value", "8:22 The ref is accessed here"]],
    });
    expect(exit).toBe(1);
  });

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

  // Matches oxlint 1.87.
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

    // The plugin has no rule for a type that doesn't converge, as in "cycle.jsx" and "in-three-functions.jsx".
    test(
      "types that hold their own earlier type, or the previous one twice, and one of two refs are done at once",
      async () => {
        const { files, exitCode } = await messages({ ...cycles, ...paths(isDebug || isASAN ? 64 : 128), ...guards });
        expect(briefly(files)).toEqual({
          "in-a-function.jsx": ["react-hooks/refs 12:3-12:7 Error: Cannot access refs during render"],
          "in-a-later-round.jsx": [
            "react-hooks/refs 8:11-8:30 Error: Cannot access refs during render",
            "react-hooks/refs 9:9-9:28 Error: Cannot access refs during render",
          ],
          "two-joins.jsx": ["react-hooks/refs 8:5-8:17 Error: Cannot access refs during render"],
          "two-refs.jsx": [
            "react-hooks/refs 6:7-6:19 Error: Cannot access refs during render",
            "react-hooks/refs 7:5-7:17 Error: Cannot access refs during render",
          ],
        });
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
