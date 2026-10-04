import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// Small programs generated as cross products, checked by `bun check` and by TypeScript 7, which have to agree. No
// expectation is stored: TypeScript is the oracle. Each program is one function on one line, so a line names a
// combination.
//
// These found what TypeScript's own tests and hundreds of open source projects did not: `bun check` reported nothing in
// a third of the loops in which TypeScript finds a circular reference.

const typescript = dirname(require.resolve("typescript/package.json"));
// `bun check` follows TypeScript 7. `TSC` is the path of a native `tsc` to compare with, next to its `lib.*.d.ts`.
const isTypeScript7 = parseInt(require("typescript/package.json").version) >= 7;
const tsc = process.env.TSC ? [process.env.TSC] : [bunExe(), join(typescript, "bin", "tsc")];
const [libraries, linkedAs] = process.env.TSC
  ? [dirname(dirname(process.env.TSC)), "@typescript/typescript-local"]
  : [typescript, "typescript"];

// A debug build is 10 to 100 times slower, so it checks a sample. It is always the same sample.
const every = isDebug || isASAN ? 25 : 1;

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
  BUN_INSTALL_GLOBAL_DIR: "/nowhere",
};

/** The error lines of `cmd`, which are in the format of `tsc --pretty false`, by line of `a.ts`. */
async function errorsOf(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const byLine = new Map<number, string[]>();
  for (const text of stdout.split("\n")) {
    const line = /^a\.ts\((\d+),\d+\): error TS\d+: /.exec(text)?.[1];
    if (line) byLine.set(+line, [...(byLine.get(+line) ?? []), text].sort());
  }
  return byLine;
}

async function checkBoth(declarations: string[], functions: string[]) {
  const sample = functions.filter((_, index) => index % every === 0);
  const source = [...declarations, ...sample.map((body, index) => `export async function f${index}${body}`)];
  using dir = tempDir("bun-check-differential", { "tsconfig.json": tsconfig, "a.ts": source.join("\n") + "\n" });
  mkdirSync(dirname(join(String(dir), "node_modules", linkedAs)), { recursive: true });
  symlinkSync(libraries, join(String(dir), "node_modules", linkedAs), "junction");
  const [theirs, ours] = await Promise.all([
    errorsOf([...tsc, "-p", ".", "--pretty", "false"], String(dir)),
    errorsOf([bunExe(), "check"], String(dir)),
  ]);
  // A syntax error would end both before anything is checked.
  expect(theirs.size).toBeGreaterThan(sample.length / 4);
  const only = (a: typeof ours, b: typeof ours) => [...a.keys()].filter(line => !b.has(line)).map(l => source[l - 1]);
  return { theirs, ours, onlyTypeScriptReports: only(theirs, ours), onlyBunReports: only(ours, theirs) };
}

/** Every `R` in `text` that is a word. */
const withReference = (text: string, reference: string) => text.replace(/\bR\b/g, () => reference);

function* product<T extends unknown[][]>(...lists: T): Generator<{ [K in keyof T]: T[K][number] }> {
  if (lists.length === 0) return yield [] as never;
  const [first, ...rest] = lists;
  for (const item of first) for (const others of product(...rest)) yield [item, ...others] as never;
}

const timeout = 10 * 60_000;
const differential = test.skipIf(!isTypeScript7 && !process.env.TSC);

// `while (s) { const cur = INITIALIZER; s = ASSIGNED; }`: the type of `cur` needs the type of `s`, which needs what the
// back edge of the loop assigns.
const loopDeclarations = [
  `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null>; get(): S | null }`,
  `declare function mk(id?: string): S; declare function mkN(s: S | null): S | null; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare class H { constructor(x: S | null); v: S | null } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null; declare function pr(s: S | null): Promise<S | null>;`,
];
// The initializer, and an expression of type `S | null` made from `cur`.
const loopInitializers = [
  ["await s.p", "cur"],
  ["`${s.id}`", "mk(cur)"],
  ["new G(s)", "cur.v"],
  ["tg`${s}`", "cur"],
  ["s.n + 1", "cur ? s.nxt : null"],
  ["-s.n", "cur ? s.nxt : null"],
  ["!s.nxt", "cur ? null : s.nxt"],
  ["typeof s.nxt", "cur ? s.nxt : null"],
  ["void s", "cur ?? null"],
  ["(s, s.nxt)", "cur"],
  ["s.nxt && s.nxt.nxt", "cur"],
  ["s.nxt || null", "cur"],
  ["[...s.kids]", "cur[0]"],
  ["{ ...s }", "cur.nxt"],
  ["s.nxt satisfies S | null", "cur"],
  ["<S | null>s.nxt", "cur"],
  ["s.nxt!", "cur"],
  ["s?.nxt", "cur"],
  ["s.kids?.[0]", "cur"],
  ["ov(s)", "cur"],
  ["s.over(1)", "cur"],
  ["idf(s.nxt)", "cur"],
  ["s.gen(s.nxt)", "cur"],
  ["(() => s.nxt)()", "cur"],
  ["(function () { return s; })()", "cur"],
  ["s.n++", "cur ? s.nxt : null"],
  ["s.id in s", "cur ? s.nxt : null"],
  ["s instanceof Object", "cur ? s.nxt : null"],
  ["s.n === 1", "cur ? s.nxt : null"],
  ["class { static v = s }", "cur.v"],
  ["{ get v() { return s; } }", "cur.v"],
  ["{ v() { return s; } }", "cur.v()"],
  ["[s] as const", "cur[0]"],
  ["{ v: s } as const", "cur.v"],
  ["c ? { v: s } : { v: null }", "cur.v"],
  ["[{ v: s }]", "cur[0].v"],
  ["idf({ v: s })", "cur.v"],
  ["{ v: s }.v", "cur"],
  // `getQuickTypeOfExpression`
  ["s.get()", "cur"],
  ["s.get()!", "cur"],
  ["(s.get())", "cur"],
  ["mkN(s)", "cur"],
  ["new H(s)", "cur.v"],
  ["await pr(s)", "cur"],
  ["s.nxt", "cur"],
  ["s", "cur"],
];
const loopAssignments = [
  "R",
  "R!",
  "(R)",
  "R as S",
  "R satisfies S | null",
  "<S>R",
  "R ?? null",
  "R || null",
  "R && R.nxt",
  "c ? R : null",
  "R ? R.nxt : null",
  "R?.nxt ?? null",
  "mkN(R)",
  "idf(R)",
  "await pr(R)",
  "await R",
  "new G(R).v",
  "new H(R).v",
  "tg`${R}`",
  "{ v: R }.v",
  "[R][0]",
  "(() => R)()",
  "R === null ? null : R",
  "(R, null)",
  "mk(R?.id)",
  "mk(`${R}`)",
  "R?.get() ?? null",
  "R?.gen(R) ?? null",
  "R?.over(1) ?? null",
  "R?.kids[0] ?? null",
  "R?.kids.find(k => k.id) ?? null",
  "[R].find(k => k) ?? null",
  "Object.assign({}, R)",
  "{ ...mk(), nxt: R }",
  "mkN(mkN(R))",
  'typeof R === "object" ? null : mk()',
];
const loopShapes = [
  "while (s) { const cur = I; s = A; }",
  "do { const cur = I; s = A; } while (s);",
  "for (;;) { if (!s) break; const cur = I; s = A; }",
  "for (; s; ) { const cur = I; s = A; }",
  "while (s) { let cur = I; s = A; }",
  "while (s) { const { cur } = { cur: I }; s = A; }",
  "while (s) { const [cur] = [I]; s = A; }",
  "while (s) { const cur = I; const nx = A; s = nx; }",
  "while (s) { while (c) { const cur = I; s = A; if (!s) return; } }",
  "while (s) { const cur = I; if (c) continue; s = A; }",
  "while (s) { try { const cur = I; s = A; } finally { c; } }",
  "while (s) { const cur = I; switch (c) { case true: s = A; break; default: s = null; } }",
];

differential.each(loopShapes)(
  "a variable in a loop that is assigned back: %s",
  async shape => {
    const functions = [...product(loopInitializers, loopAssignments)].map(([[initializer, read], assigned]) => {
      const body = shape.replace("I", () => initializer).replace("A", () => withReference(assigned, `(${read})`));
      return `() { let s: S | null = mk(); ${body} }`;
    });
    const { onlyTypeScriptReports, onlyBunReports } = await checkBoth(loopDeclarations, functions);
    expect(onlyTypeScriptReports).toEqual([]);
    expect(onlyBunReports).toEqual([]);
  },
  timeout,
);

differential(
  "narrowing: the reference, the guard, the control flow around it, and what happens before the use",
  async () => {
    const declarations = [
      `type U = { k: "a"; a: number; n?: U } | { k: "b"; b: string; n?: U } | string | number | null | undefined | string[] | (() => void) | Date;`,
      `interface W { p: U; q: { p: U }; readonly r: U; [i: number]: U; m(): U } declare function isStr(v: unknown): v is string; declare function f(): void; declare const c: boolean; declare const cx: U; declare const key: "p"; declare const i: number;`,
    ];
    const references = [
      ...["x", "cx", "w.p", "w.q.p", "w.r", "w[0]", 'w["p"]', "w?.p", "w!.p", "arr[0]", "arr[i]", "tup[0]", "w[key]"],
      ...["cw.p", "cw.q.p", "(x)", 'w.q["p"]', "d"],
    ];
    const guards = [
      'typeof R === "string"',
      'typeof R !== "object"',
      "R === null",
      "R == null",
      "R != undefined",
      "R",
      "!R",
      "R instanceof Date",
      "Array.isArray(R)",
      "isStr(R)",
      'typeof R === "function"',
      'typeof R === "object" && R !== null && "k" in R',
      'R === "lit"',
      "R === cx",
      'typeof R === "object" && R && !Array.isArray(R) && !(R instanceof Date) && R.k === "a"',
      'typeof R === "number" || typeof R === "string"',
      '"string" === typeof R',
      "R !== undefined && R !== null",
      'typeof R === "undefined"',
      'R?.toString() === "a"',
    ];
    const flows = [
      "if (G) { M USE }",
      "if (G) { c; } else { M USE }",
      "if (!(G)) return; M USE",
      "if (G) { M (() => { USE })(); }",
      "while (G) { M USE break; }",
      "switch (true) { case G: M USE break; }",
      "for (; G; ) { M USE break; }",
      "do { if (G) break; M USE } while (c);",
      "try { if (!(G)) throw 0; M USE } catch { c; }",
      "if (G || c) { M USE }",
      "if (G && c) { M USE }",
      "const g = G; if (g) { M USE }",
      "if (G) { M } USE",
      "if (c) { if (!(G)) return; } M USE",
      "L: { if (!(G)) break L; M USE }",
      "(G) && f(); M USE",
    ];
    const between = [
      ...["", "f();", "await 0;", "x = x;", "w = w;", "w.p = w.p;", "w.q = w.q;", "for (const e of [1]) { e; }"],
    ];
    const functions = [...product(references, guards, flows, between)].map(([reference, guard, flow, statement]) => {
      // The narrowed type is in the message.
      const body = flow
        .replace("G", () => withReference(guard, reference))
        .replace("USE", () => `const r: never = ${reference};`)
        .replace("M", () => statement);
      return `(x: U, w: W, arr: U[], tup: [U, U], cw: Readonly<W>, { d }: { d: U }) { ${body} }`;
    });
    const { theirs, ours } = await checkBoth(declarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
  timeout,
);

differential(
  "a variable without an annotation: the declaration, the write, the control flow around it, and the read",
  async () => {
    const declarations = [
      `declare const c: boolean; declare function mk(): { k: 1 } | null; declare function idf<T>(v: T): T;`,
    ];
    const variables = [
      ...["let x;", "let x = null;", "let x = undefined;", "let x = [];", "var x;", "let x, y = 1;"],
      ...["let x = c ? null : undefined;", "const x = [];", "let x = [], z = x;"],
    ];
    const writes = [
      ...["x = 1;", 'x = "a";', "x = mk();", 'x = x ? 1 : "a";', "x = [1];", "x.push(1);", "x[0] = 1;", "x ??= 1;"],
      ...["x = x + 1;", "({ x } = { x: 1 });", "[x] = [1];", "for (x of [1]) { c; }", "for (x in {}) { c; }"],
      ...["x = null;", "x = undefined;", 'x = []; x.push("a");', "x = idf(x);", "x = { v: x };", "x = () => x;"],
      ...["x.push(x);", "x = [x];", "x.length = 0;", "x = c ? [] : null;", "x++;", 'x += "a";', ""],
    ];
    const flows = [
      "W",
      "if (c) { W }",
      "if (c) { W } else { x = true; }",
      "while (c) { W }",
      "do { W } while (c);",
      "for (const i of [1]) { W }",
      "try { W } catch { c; }",
      "try { c; } finally { W }",
      "switch (c) { case true: W break; }",
      "(() => { W })();",
      "function inner() { W } inner();",
      "L: { if (c) break L; W }",
      "while (c) { if (c) continue; W }",
      "if (c) return; W",
    ];
    const reads = [
      ...["const r: never = x;", "x.foo;", "const f = () => x; f;", "return x;", "x();", "const [a] = x; a;"],
      ...["for (const e of x) { e; }", "x satisfies never;", 'typeof x === "string" && x.foo;'],
    ];
    const functions = [...product(variables, writes, flows, reads)].map(
      ([variable, write, flow, read]) => `() { ${variable} ${flow.replace("W", () => write)} ${read} }`,
    );
    const { theirs, ours } = await checkBoth(declarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
  timeout,
);

const cycleDeclarations = [
  `declare const c: boolean; declare function idf<T>(v: T): T; declare function one(v: unknown): number; declare class G<T> { constructor(v: T); v: T } declare function ov(v: string): string; declare function ov(v: unknown): number;`,
];
// The declaration of `N` with the expression `E`, and how to refer to it.
const cycleDeclared = [
  ["const N = E;", "N"],
  ["let N = E;", "N"],
  ["var N = E;", "N"],
  ["const { N } = { N: E };", "N"],
  ["const [N] = [E];", "N"],
  ["function N() { return E; }", "N()"],
  ["const N = () => E;", "N()"],
  ["const N = function () { return E; };", "N()"],
  ["class CN { static p = E; }", "CN.p"],
  ["class CN { p = E; }", "new CN().p"],
  ["const oN = { p: E };", "oN.p"],
  ["const oN = { get p() { return E; } };", "oN.p"],
  ["const oN = { p() { return E; } };", "oN.p()"],
  ["async function N() { return E; }", "N()"],
  ["function* N() { yield E; }", "N()"],
  ["const N = (x = E) => x;", "N()"],
  ["function N(x = E) { return x; }", "N()"],
  ["class CN { m() { return E; } }", "new CN().m()"],
  ["class CN { get p() { return E; } }", "new CN().p"],
  ["const N = { v: E }.v;", "N"],
  ["const N = [E][0];", "N"],
  ["const N = c ? E : 1;", "N"],
];
const cycleReferences = [
  "R",
  "idf(R)",
  "[R]",
  "{ v: R }",
  "() => R",
  "(() => R)()",
  "typeof R",
  "R as any",
  "R!",
  "R ?? 1",
  "c ? R : 1",
  "one(R)",
  "new G(R)",
  "`${R}`",
  "R.x",
  "R?.x",
  "void R",
  "[...R]",
  "{ ...R }",
  "idf(() => R)",
  "[1].map(() => R)",
  "[1].map(x => R)",
  "Promise.resolve(R)",
  "R satisfies unknown",
  "ov(R)",
  "R + 1",
  "!R",
  "(R, 1)",
  "R && 1",
  "function () { return R; }",
  "class { static q = R }",
  "{ get g() { return R; } }",
  "[1].find(x => R)",
  "new Promise(r => r(R))",
  "idf(idf)(R)",
  "<any>R",
  "R as const",
  "{ m() { return R; } }",
];

differential(
  "a circular reference: the declaration, and how its initializer or its body refers back to it",
  async () => {
    const functions = [...product(cycleDeclared, cycleReferences)].map(([[declaration, name], reference]) => {
      const expression = `(${withReference(reference, name.replaceAll("N", "a"))})`;
      return `() { ${declaration.replaceAll("N", "a").replace("E", () => expression)} }`;
    });
    const { theirs, ours } = await checkBoth(cycleDeclarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
  timeout,
);

differential(
  "a circular reference through a second declaration",
  async () => {
    const second = [0, 3, 5, 6, 8, 9, 10, 11, 15, 17].map(index => cycleDeclared[index]);
    const functions = [...product(cycleDeclared, cycleReferences, second)].map(
      ([[declaration, name], reference, [otherDeclaration, otherName]]) => {
        const expression = `(${withReference(reference, otherName.replaceAll("N", "b"))})`;
        const first = declaration.replaceAll("N", "a").replace("E", () => expression);
        const other = otherDeclaration.replaceAll("N", "b").replace("E", () => name.replaceAll("N", "a"));
        return `() { ${first} ${other} }`;
      },
    );
    const { theirs, ours } = await checkBoth(cycleDeclarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
  timeout,
);

differential(
  "callbacks: the callee, the form of the callback, and the context of the call",
  async () => {
    // `const p: never = x` and `const r: never = CALL` put the contextual type of the parameter and the inferred type of
    // the call in the messages.
    const declarations = [
      "declare const c: boolean; declare function idf<T>(v: T): T; declare const pn: Promise<number>; declare const an: number[]; declare const mp: Map<string, number>;",
      "declare function k1(cb: (x: number) => string): void; declare function k2(cb: (x: number, y: string) => void): void; declare function k3<T>(v: T, cb: (x: T) => void): T; declare function k4<T>(cb: (x: number) => T): T;",
      "declare function k5<T, U>(v: T, f: (x: T) => U, g: (y: U) => void): U; declare function k6(cb: (x: number) => void): 1; declare function k6(cb: (x: string, y: number) => void): 2; declare function k7(cb?: (x: number) => void): void;",
      "declare function k8(cb: ((x: number) => void) | ((x: string) => void)): void; declare function k9(cb: ((x: number) => void) | null): void; declare function k10(...cbs: ((x: number) => void)[]): void;",
      "declare function k11(o: { cb(x: number): void; n: number }): void; declare function k12<T>(o: { v: T; cb: (x: T) => void }): T; declare function k13(cb: (this: Date, x: number) => void): void;",
      "declare function k14(cb: (...a: [number, string]) => void): void; declare function k15<A extends unknown[]>(cb: (...a: A) => void, ...a: A): A; declare function k16(cb: (x: { a: number; b?: string }) => void): void;",
      "declare function k17<T extends string>(v: T, cb: (x: T) => void): T; declare function k18<T>(cb: (x: T) => void, v: T): T; declare function k19<T>(a: T[], cb: (x: T) => boolean): T; declare class K20<T> { constructor(v: T, cb: (x: T) => void); v: T }",
    ];
    const callees = [
      "k1(CB)",
      "k2(CB)",
      "k3(1, CB)",
      "k4(CB)",
      "k5(1, CB, y => { const q: never = y; })",
      "k6(CB)",
      "k7(CB)",
      "k8(CB)",
      "k9(CB)",
      "k10(CB, CB)",
      "k11({ cb: CB, n: 1 })",
      "k12({ v: 1, cb: CB })",
      "k13(CB)",
      "k14(CB)",
      'k15(CB, 1, "a")',
      "k16(CB)",
      'k17("a", CB)',
      "k18(CB, 1)",
      'k19([1, "a"], CB)',
      "new K20(1, CB)",
      "pn.then(CB)",
      "an.map(CB)",
      "an.filter(CB)",
      'an.reduce(CB, "")',
      "mp.forEach(CB)",
      "an.find(CB)",
      "an.sort(CB)",
      'k3(c ? 1 : "a", CB)',
      "k12({ cb: CB, v: 1 })",
      "k3(null, CB)",
      "k3([], CB)",
      "k3({ a: 1 }, CB)",
    ];
    const callbacks = [
      "x => { const p: never = x; }",
      "(x) => { const p: never = x; }",
      "(x, y) => { const p: never = y; }",
      "function (x) { const p: never = x; }",
      "async x => { const p: never = x; }",
      "function* (x) { const p: never = x; }",
      "(x = 1) => { const p: never = x; }",
      "({ a }) => { const p: never = a; }",
      "([a]) => { const p: never = a; }",
      "(...x) => { const p: never = x; }",
      "(x?) => { const p: never = x; }",
      "(x: any) => { const p: never = x; }",
      "c ? x => { const p: never = x; } : x => { const p: never = x; }",
      "(x => { const p: never = x; })",
      "idf(x => { const p: never = x; })",
      "x => x",
      "() => 1",
      "x => { return x; }",
      "function (x) { const p: never = this; }",
      "x => y => { const p: never = x; }",
      "x => ({ v: x })",
      "x => [x]",
      "(x, ...r) => { const p: never = r; }",
      "x => { if (c) return x; return 1; }",
      "async function (x) { return x; }",
      "x => x as const",
    ];
    const contexts = [
      "const r: never = CALL;",
      "CALL;",
      "return CALL;",
      "const r = CALL; const s: never = r;",
      "const r: never = idf(CALL);",
      "const r: never = [CALL];",
      "const r: never = { v: CALL };",
      "while (c) { const r: never = CALL; }",
      "const r: never = c ? CALL : 1;",
      "const f = () => CALL; const r: never = f();",
      "const r: never = await CALL;",
      "class Q { p = CALL; } const r: never = new Q().p;",
    ];
    const functions = [...product(callees, callbacks, contexts)].map(([callee, callback, context]) => {
      const call = callee.replace(/\bCB\b/g, () => callback);
      return `() { ${context.replace(/\bCALL\b/g, () => call)} }`;
    });
    const { theirs, ours } = await checkBoth(declarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
  timeout,
);
