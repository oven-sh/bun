import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// Small programs generated as cross products, checked by `bun check` and by TypeScript 7, which have to agree. No
// expectation is stored: TypeScript is the oracle. Each program is one function on one line, so a line names a
// combination.
//
// These found what TypeScript's own tests and hundreds of open source projects did not: `bun check` reported nothing in
// a third of the loops in which TypeScript finds a circular reference.

// `bun check` follows TypeScript 7, which is a native program next to its `lib.*.d.ts`: `typescript7` in
// test/package.json, beside the `typescript` that has the API in JavaScript. `TSC` is the path of another to compare with.
function nativeTypeScript() {
  if (process.env.TSC) return process.env.TSC;
  try {
    const paths = [dirname(require.resolve("typescript7/package.json"))];
    const name = `@typescript/typescript-${process.platform}-${process.arch}`;
    return join(dirname(require.resolve(`${name}/package.json`, { paths })), "lib", isWindows ? "tsc.exe" : "tsc");
  } catch {
    // There is none for this system.
  }
}
const tsc = nativeTypeScript();

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
  const [theirs, ours] = await Promise.all([
    errorsOf([tsc!, "-p", ".", "--pretty", "false"], String(dir)),
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

const timeout = 60_000;
const differential = test.concurrent.skipIf(!tsc);

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

// File names that differ only in case. On a file system that takes one for the other, `import "./Button"` finds
// `button.ts`: it is one file, under the name by which the program comes to it first, and every other spelling is an
// error (TS1149, TS1261). On a file system that does not, two files can have such names, which is an error too.
//
// Every case is a directory. Most are in one project, so that they take two processes together. An error without a file
// suppresses the other errors of its project, so a case that can have one is a project of its own.
/** What `cmd` prints about each line of `a.ts`. A line that continues a message belongs to the error above it. */
async function messagesOf(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const byLine = new Map<number, string[]>();
  let line = 0;
  for (const text of stdout.split(/\r?\n/)) {
    line = +(/^a\.ts\((\d+),\d+\): error TS\d+: /.exec(text)?.[1] ?? line);
    if (line && text.trim()) byLine.set(line, [...(byLine.get(line) ?? []), text]);
  }
  return byLine;
}

/**
 * One program, with a case on each line. Returns the cases about which the two say something else, in whole messages.
 * `step`: a debug build checks every `step`th case. `files`: the other files of the program.
 */
async function casesThatDiffer(
  options: object,
  declarations: string[],
  cases: string[],
  step = every,
  files: Record<string, string> = {},
) {
  // After a syntax error nothing is checked. The last line shows that it was.
  const source = [...declarations, ...cases.filter((_, index) => index % step === 0), `const checked: number = "";`];
  const compilerOptions = { ...JSON.parse(tsconfig).compilerOptions, ...options };
  using dir = tempDir("bun-check-differential", {
    ...files,
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "a.ts": source.join("\n") + "\n",
  });
  const [theirs, ours] = await Promise.all([
    messagesOf([tsc!, "-p", ".", "--pretty", "false"], String(dir)),
    messagesOf([bunExe(), "check"], String(dir)),
  ]);
  expect(theirs.get(source.length)?.[0]).toContain("error TS2322");
  return source.flatMap((text, index) => {
    const [typescript, bun] = [theirs.get(index + 1) ?? [], ours.get(index + 1) ?? []];
    return Bun.deepEquals(typescript, bun) ? [] : [{ text, tsc: typescript, bun }];
  });
}

// `string` is applicable to the key `string & {}`, and is not that key.
const indexKeys = [
  "string",
  "number",
  "symbol",
  "string & {}",
  "number & {}",
  "symbol & {}",
  "`a${string}`",
  "`${number}`",
  "`a${string}` & {}",
  "(string & {}) | `a${string}`",
  "(string & {}) | number",
  "string | (number & {})",
  "(string & {}) | (number & {}) | (symbol & {})",
  "string & { brand: 1 }",
];
const indexDeclarations = [
  "declare const u: unique symbol; declare const str: string; declare const num: number; declare const sym: symbol;",
  "declare const tpl: `a${string}`; declare const nstr: `${number}`;",
  "declare const bstr: string & {}; declare const bnum: number & {}; declare const bsym: symbol & {};",
  `declare const zero: 0; declare const szero: "0"; declare enum E { A = 0 }`,
];
const indexedBy = [
  "0",
  `"a"`,
  `"ab"`,
  `"0"`,
  "Symbol.iterator",
  "u",
  "str",
  "num",
  "sym",
  "tpl",
  "nstr",
  "bstr",
  "bnum",
  "bsym",
];
const indexUses = [
  "s[I];",
  `s[I] = "x";`,
  "const k: keyof typeof s = I;",
  "type T = (typeof s)[TYPE]; const t: T = 1;",
  "const { [I]: v } = s; const n: never = v;",
  "delete s[I];",
  "I in s;",
];
const namedUses = [
  "s.a;",
  "s.ab;",
  "s.a = 1;",
  "const { a } = s; const n: never = a;",
  "const { ab, ...rest } = s; const n: never = rest;",
];
// A name that is written as a number is a number, and no index signature for `string & {}` has it.
const literalNames = [
  "0",
  `"0"`,
  `"a"`,
  "a",
  "1.0",
  "0x1",
  "1e3",
  ".5",
  "[0]",
  `["0"]`,
  "[1.0]",
  "[-1]",
  `["-1"]`,
  `["a"]`,
  "[(0)]",
  "[0n]",
  // Bound late: the name is that of the value, and its type is the type of the expression.
  "[zero]",
  "[szero]",
  "[E.A]",
  "[u]",
];
const destructurings = [
  "const { L: v } = s; const n: never = v;",
  "let v; ({ L: v } = s); const n: never = v;",
  "const { L: v, ...rest } = s; const n: never = rest;",
  "let v, rest; ({ L: v, ...rest } = s); const n: never = rest;",
  "function f({ L: v }: typeof s) { const n: never = v; }",
  "const { L: v = 1 } = s; const n: never = v;",
  "let v; ({ L: v = 1 } = s); const n: never = v;",
  "for (const { L: v } of [s]) { const n: never = v; }",
];
// And one that is written as a string is a string, however much it looks like a number.
const literalsWithNames = [
  "const o = { L: 1 }; const t: typeof s = o;",
  "const t: typeof s = { L: 1 };",
  "const t: { [K in keyof typeof s]: (x: string) => void } = { L: x => x.nope };",
];
const isKeyOfIndexSignature = (key: string) => /^(string|number|symbol|`[^`]*`)$/.test(key);
const withIndex = (key: string, value: string) =>
  isKeyOfIndexSignature(key) ? `{ [k: ${key}]: ${value} }` : `{ [K in ${key}]: ${value} }`;
const literalsWithKeys = [
  `{ a: "" }`,
  `{ ab: "" }`,
  `{ 0: "" }`,
  `{ [u]: "" }`,
  `{ [str]: "" }`,
  `{ [num]: "" }`,
  `{ [sym]: "" }`,
  `{ [tpl]: "" }`,
  `{ [bstr]: "" }`,
];
const indexSources = [
  ...indexKeys.map(key => `null! as ${withIndex(key, "string")}`),
  ...[
    "{ a: string }",
    "{ ab: string }",
    "{ 0: string }",
    `{ "0": string }`,
    "{ [u]: string }",
    "{ ab: string; 1: string; [u]: string }",
    "{ a?: string }",
    "{ [k: string]: string; [k: number]: string }",
    "{ [k: `a${string}`]: string; ab: string }",
  ].map(type => `null! as ${type}`),
  ...literalsWithKeys,
];
const indexAccesses = [
  ...[...product(indexKeys, indexedBy, indexUses)].map(
    ([key, index, use]) =>
      `{ const s = null! as { [K in ${key}]: string }; ${use
        .replace(/\bI\b/g, () => index)
        // A literal is its own type.
        .replace("TYPE", () => (/^[a-z]/i.test(index) ? `typeof ${index}` : index))} }`,
  ),
  ...[...product(indexKeys, namedUses)].map(([key, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use} }`),
  ...[...product(indexKeys, literalNames, destructurings)].map(
    ([key, name, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use.replace(/\bL\b/g, () => name)} }`,
  ),
  ...[...product(indexKeys, literalNames, literalsWithNames)].map(
    ([key, name, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use.replace(/\bL\b/g, () => name)} }`,
  ),
];
const indexRelations = [
  ...[...product(indexSources, indexKeys)].flatMap(([source, key]) => [
    `{ const s = ${source}; const t: ${withIndex(key, "number")} = s; }`,
    `{ const s = ${source}; const i = null! as <V>(o: ${withIndex(key, "V")}) => V; const r: never = i(s); }`,
  ]),
  ...[...product(literalsWithKeys, indexKeys)].map(([it, key]) => `{ const t: ${withIndex(key, "number")} = ${it}; }`),
  ...[...product(indexKeys, indexKeys)].map(
    ([a, b]) => `{ var v: ${withIndex(a, "string")}; var v: ${withIndex(b, "string")}; }`,
  ),
  ...[
    ...product(indexKeys.filter(isKeyOfIndexSignature), [
      "a: number = 1;",
      "ab: number = 1;",
      "0: number = 1;",
      "[u]: number = 1;",
      "[k: `ab${string}`]: number;",
      "[k: number]: number;",
    ]),
  ].map(([key, member]) => `{ class C { [k: ${key}]: string; ${member} } }`),
];

differential(
  "index signatures: the key, and what it is indexed by",
  async () => expect(await casesThatDiffer({}, indexDeclarations, indexAccesses, 1)).toEqual([]),
  timeout,
);
differential(
  "index signatures: the key, and what it is indexed by, under the options about them",
  async () => {
    const options = { noPropertyAccessFromIndexSignature: true, noUncheckedIndexedAccess: true };
    expect(await casesThatDiffer(options, indexDeclarations, indexAccesses, 1)).toEqual([]);
  },
  timeout,
);
differential(
  "index signatures: the key of the source, and the key of the target",
  async () => expect(await casesThatDiffer({}, indexDeclarations, indexRelations, 1)).toEqual([]),
  timeout,
);

// What is found out while a circular reference is being resolved is found out again afterwards. The arguments of a call
// are checked once for each overload, and the last check gives the parameters of a callback their types.
const overloadDeclarations = [
  "declare function g<T>(cb: () => T): T; declare function h(cb: () => unknown): unknown;",
  "declare class G<T> { constructor(cb: () => T); value: T }",
  "declare function f2(o: { t: 1; m(c: string): void }): void; declare function f2(o: { t: 2; m(c: number): void }): void;",
  "declare function f2g(o: { t: 1; m(c: string): void }): void; declare function f2g<R>(o: { t: 2; m(c: R[]): void }): void;",
  "declare function fg2<R>(o: { t: 1; m(c: R[]): void }): void; declare function fg2(o: { t: 2; m(c: number): void }): void;",
  "declare function f1(o: { t: 1; m(c: string): void }): void;",
  "declare function f1g<R>(o: { t: 1; r?: R; m(c: R[]): void }): void;",
  "declare function f3(o: { t: 1; m(c: string): void }): void; declare function f3(o: { t: 2; m(c: number): void }): void; declare function f3(o: { t: 4; m(c: boolean): void }): void;",
  "declare function a2(o: [1, (c: string) => void]): void; declare function a2(o: [2, (c: number) => void]): void;",
  "declare function n2(o: { t: 1; o: { m(c: string): void } }): void; declare function n2(o: { t: 2; o: { m(c: number): void } }): void;",
  "declare function p2(t: 1, m: (c: string) => void): void; declare function p2(t: 2, m: (c: number) => void): void;",
];
const overloadedCalls = [
  ...[
    ...product(
      ["f2", "f2g", "fg2", "f1", "f1g", "f3"],
      ["1", "2", "3"],
      [
        "{ t: T, m(c) { c.nope; } }",
        "{ t: T, m: c => c.nope }",
        "{ t: T, m: function (c) { c.nope; } }",
        "{ m(c) { c.nope; }, t: T }",
      ],
    ),
  ].map(([callee, t, argument]) => `${callee}(${argument.replace("T", t)})`),
  ...["1", "2", "3"].flatMap(t => [
    `a2([${t}, c => c.nope])`,
    `n2({ t: ${t}, o: { m(c) { c.nope; } } })`,
    `p2(${t}, c => c.nope)`,
  ]),
];
// `R`: the reference back. `C`: the call.
const aroundTheCall = ["R, C", "C, R", "C", "R, C, C"];
// `X`: the name. `B`: one of `aroundTheCall`.
const circularDeclarations: [reference: string, declaration: string][] = [
  ["X", "const X = g(() => [B]);"],
  ["X", "const X = h(() => [B]);"],
  ["X", "const X = g(function () { return [B]; });"],
  ["X", "const X = new G(() => [B]);"],
  ["X", "const X = { p: g(() => [B]) };"],
  ["X", "const X = g(() => g(() => [B]));"],
  ["X", "const X = [B];"],
  ["X()", "function X() { return g(() => [B]); }"],
  ["X()", "function X() { return [B]; }"],
  ["X()", "const X = () => g(() => [B]);"],
  ["this.p", "class X { p = g(() => [B]); }"],
  ["this.p()", "class X { p() { return g(() => [B]); } }"],
];
const callsAfterCircularReferences = [...product(circularDeclarations, aroundTheCall, overloadedCalls)].map(
  ([[reference, declaration], around, call], index) =>
    declaration
      .replace("B", () => around.replace(/\bR\b/g, () => reference).replace(/\bC\b/g, () => call))
      .replace(/\bX\b/g, () => `x${index}`),
);

for (const noImplicitAny of [true, false]) {
  differential(
    `a circular reference, and a call with overloads and a callback, noImplicitAny: ${noImplicitAny}`,
    async () =>
      expect(await casesThatDiffer({ noImplicitAny }, overloadDeclarations, callsAfterCircularReferences)).toEqual([]),
    timeout,
  );
}

// In the true branch of `[a, p] extends [A[], B[]] ? .. : ..`, `[a, p]` is also `[A[], B[]]`. A conditional type there that
// checks `[a, p]` again is deferred all the same, so nothing is inferred for its `infer` type parameters: they are
// `unknown`, not what `A` and `B` would give.
const narrowedCheckTypes = [
  ["[a, p]", "[readonly A[], readonly B[]]", "[I, J]"],
  ["[a]", "[readonly A[]]", "[I]"],
  ["a", "readonly A[]", "I"],
  ["[a, p, a]", "[readonly A[], readonly B[], unknown]", "[I, J, unknown]"],
  ["{ k: a; l: p }", "{ k: readonly A[]; l: readonly B[] }", "{ k: I; l: J }"],
];
const narrowedTo = [
  ["any", "any"],
  ["string", "number"],
  ["string", "string"],
  ["{ q: 1 }", "never"],
];
const inferredFromThem = [
  ["readonly (infer x)[]", "readonly (infer y)[]"],
  ["readonly [infer x, ...any[]]", "readonly [infer y, ...any[]]"],
  ["infer x", "infer y"],
  ["readonly (infer x extends string)[]", "readonly (infer y)[]"],
];
const assignedTo = [
  "{ x: string }",
  "{ x: string | number }",
  "{ x: unknown }",
  "{ x: any[] }",
  "{ x: { q: 1 } }",
  "never",
];

differential(
  "a conditional type whose check type is narrowed by the conditional type around it",
  async () => {
    const cases = [...product(narrowedCheckTypes, narrowedTo, inferredFromThem, assignedTo)].map(
      ([[check, outer, inner], [A, B], [I, J], target], index) => {
        const result = inner.includes("J") ? "{ x: x; y: y }" : "{ x: x }";
        const inside = `${check} extends ${inner.replace("I", I).replace("J", J)} ? ${result} : never`;
        const type = `${check} extends ${outer.replace("A", A).replace("B", B)} ? (${inside}) : never`;
        return `type C${index}<a, p> = ${type}; function f${index}<a, p>(g: C${index}<a, p>) { const v: ${target} = g; }`;
      },
    );
    expect(await casesThatDiffer({}, [], cases, 1)).toEqual([]);
  },
  timeout,
);

// `interface D extends M<D>`, where the members of `M<D>` depend on those of `D`, is an error (TS2310). In a declaration
// file that `skipLibCheck` hides, only what follows from it shows: src/js/builtins.d.ts declares `promise.$then` like that.
// `M<D>` has its members from what `D` declares itself, and from the base types of `D` that are resolved before it where
// `keyof D` is evaluated at once.
const basesOfThemselves = {
  renamed: "{ [K in keyof T as `$${K & string}`]: T[K] }",
  filtered: "{ [K in keyof T as T[K] extends Function ? `$${K & string}` : never]: T[K] }",
  unconstrained: "{ [K in keyof T as T[K] extends Function ? `$${K}` : never]: T[K] }",
  plus: "{ [K in keyof T]: T[K] } & { extra: 1 }",
  getters: "{ readonly [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] }",
  record: "Partial<Record<`$${keyof T & string}`, 1>>",
  omitted: "Omit<T, 'm'> & { extra: 1 }",
};
// The declaration of `D` with the base type `M<D>`, and a type to use it by.
const extendingThemselves: ((D: string, M: string) => [string, string])[] = [
  (D, M) => [`interface ${D} extends ${M}<${D}> { m(): void; n: number }`, D],
  (D, M) => [`interface ${D}<X> extends ${M}<${D}<X>> { m(): X; n: number }`, `${D}<string>`],
  (D, M) => [`interface ${D} { m(): void } interface ${D} extends ${M}<${D}> { n: number }`, D],
  (D, M) => [`interface ${D} extends ${M}<${D}> { n: number } interface ${D} { m(): void }`, D],
  (D, M) => [`interface ${D} extends Other, ${M}<${D}> { m(): void; n: number }`, D],
  (D, M) => [`interface ${D} extends ${M}<${D}>, Other { m(): void; n: number }`, D],
  (D, M) => [`interface ${D} extends Other { m(): void; n: number } interface ${D} extends ${M}<${D}> {}`, D],
  (D, M) => [`declare class ${D} { m(): void; n: number } interface ${D} extends ${M}<${D}> {}`, D],
  (D, M) => [`interface ${D} extends ${M}<${D}> { (): void; m(): void; n: number }`, D],
];
const usesOfThemselves = [
  ...["$m", "$$m", "$n", "$b", "extra", "getM", "m", "anything"].map(name => `const v: 1 = d.${name};`),
  ...["$m", "m", "$$m", "$b", "b", "extra", "getM", "anything"].map(name => `const v: 1 = null! as Has<"${name}", D>;`),
  "const v: { $m(): void } = d;",
  "const v: { m(): void } = d;",
  "const v: D = { m() {}, n: 1 } as any as { m(): any; n: number };",
  "const v: Record<string, unknown> = d;",
];
// `M<D>` is asked for before `D`, which is then left without the members of `M<D>`.
const usesOfTheirBases = [
  ...["$m", "m", "$$m", "$b", "b", "extra", "getM", "anything"].map(name => `const v: 1 = null! as Has<"${name}", M>;`),
  "const v: M = d;",
  "const v: D = null! as M;",
  "const v: 1 = null! as (D extends M ? true : false);",
  "const v: 1 = null! as (M extends D ? true : false);",
  "type First = keyof M; const v: 1 = d.$m;",
  "type First = keyof M; const f: First = null!; const v: 1 = d.$m;",
  "const f: M = null!; f; const v: 1 = d.$m;",
  "const f: M = null!; f.$m; const v: 1 = d.$m;",
];
const declarationsForThemselves = [
  "type Has<K, T> = K extends keyof T ? true : false;",
  "interface Other { b(): void; [Symbol.iterator](): void }",
  ...Object.entries(basesOfThemselves).map(([name, type]) => `type ${name}<T> = ${type};`),
];
// What is asked for first decides in typescript-go, so every use has an interface of its own: its declaration, and the use.
const extendedAndUsed = [
  ...product(Object.keys(basesOfThemselves), extendingThemselves, usesOfThemselves),
  // Where `plus<D>` is first, typescript-go has the error type for the keys of the mapped type in it.
  ...product(
    Object.keys(basesOfThemselves).filter(base => base !== "plus"),
    extendingThemselves,
    usesOfTheirBases,
  ),
].map(([base, extending, use], index) => {
  const [declaration, type] = extending(`D${index}`, base);
  const used = use.replace(/\b[DM]\b/g, (name: string) => (name === "D" ? type : `${base}<${type}>`));
  return [declaration, `{ const d = null! as ${type}; ${used} }`];
});

differential(
  "an interface that extends a type made of its own members, in a declaration file that is not checked",
  async () => {
    const declarations = [...declarationsForThemselves, ...extendedAndUsed.map(([declaration]) => declaration)];
    const files = { "declarations.d.ts": declarations.join("\n") + "\n" };
    const cases = extendedAndUsed.map(([, use]) => use);
    expect(await casesThatDiffer({}, [], cases, 1, files)).toEqual([]);
  },
  timeout,
);

differential(
  "an interface that extends a type made of its own members, in a file that is checked",
  async () => {
    const dollar = "type Dollar<T> = { [K in keyof T as `$${K & string}`]: T[K] };";
    const programs = [
      [dollar, "interface Foo extends Dollar<Foo> { m(): void }", "const k: 1 = null! as keyof Foo;"],
      [
        "type Plus<T> = { [K in keyof T]: T[K] } & { extra: 1 };",
        "interface Foo extends Plus<Foo> { m(): void }",
        "const k: 1 = null! as keyof Foo;",
      ],
      [
        dollar,
        "interface Fn extends Dollar<Fn> {}",
        "interface Fn { (): void }",
        "const is: 1 = null! as ((() => void) extends Fn ? true : false);",
      ],
      [
        dollar,
        "interface Foo extends Dollar<Foo> { m(): void }",
        "declare const foo: Foo;",
        "foo.$m;",
        "foo.$$m;",
        "const keysOfBase: 1 = null! as keyof Dollar<Foo>;",
        "const keys: 1 = null! as keyof Foo;",
        "const base: Dollar<Foo> = foo;",
        "const other: { $m: 1 } = foo;",
      ],
    ];
    const different = await Promise.all(programs.map(lines => casesThatDiffer({}, [], lines, 1)));
    expect(different).toEqual([[], [], [], []]);

    // Every declaration on the line of its use, before it.
    const cases = extendedAndUsed.map(([declaration, use]) => `${declaration} ${use}`);
    expect(await casesThatDiffer({}, declarationsForThemselves, cases, 1)).toEqual([]);
  },
  timeout,
);

differential(
  "the interfaces of the library that extend a type made of their own members",
  async () => {
    const files = {
      "declarations.d.ts": `
        type Has<K, T> = K extends keyof T ? true : false;
        type ClassWithIntrinsics<T> = { [K in keyof T as T[K] extends Function ? \`$\${K}\` : never]: T[K] };
        declare interface Map<K, V> extends ClassWithIntrinsics<Map<K, V>> {}
        declare interface CallableFunction extends ClassWithIntrinsics<CallableFunction> {}
        declare interface Promise<T> extends ClassWithIntrinsics<Promise<T>> {}
        declare interface ArrayBufferConstructor extends ClassWithIntrinsics<ArrayBufferConstructor> {}
        declare interface PromiseConstructor extends ClassWithIntrinsics<PromiseConstructor> {}
      `,
    };
    const declarations = [
      "declare const f: () => void; declare const p: Promise<number>; declare const m: Map<string, number>;",
    ];
    const cases = [
      "null! as ((() => void) extends CallableFunction ? true : false)",
      ...["f.$call", "f.$$call", "p.$then", "p.$$then", `m.$get("a")`, "m.$size", "m.$$get"],
      ...["Promise.$resolve(1)", "Promise.$$resolve", "ArrayBuffer.$isView", "ArrayBuffer.$$isView"],
      ...product(
        ["$apply", "apply", "toString", "$toString", "$then", "$get", "$all", "all", "anything"],
        ["CallableFunction", "Promise<number>", "Map<string, number>", "PromiseConstructor", "ArrayBufferConstructor"],
      ).map(([name, type]) => `null! as Has<"${name}", ${type}>`),
      `null! as Exclude<keyof CallableFunction, "apply" | "call" | "bind">`,
      "null! as Exclude<keyof PromiseConstructor, string>",
      "(<T extends (...args: any[]) => any>(fn: T): ReturnType<T> => fn.$call(undefined))(() => 2)",
    ].map(value => `{ const v: 1 = ${value}; }`);
    cases.push("{ const v: CallableFunction = f; }", "{ const v: ClassWithIntrinsics<CallableFunction> = f; }");
    expect(await casesThatDiffer({}, declarations, cases, 1, files)).toEqual([]);
  },
  timeout,
);

// typescript-go lists the specifier of `import()` and `require()` once for each `import` and `require` in the text of the
// call, and says why a file is in the program if there is more than one reason.
differential(
  "why a file is in the program: the text of a dynamic import",
  async () => {
    const typescript = [
      `import("./import");`,
      `import("./x");`,
      `import("./import-import");`,
      `import(/* import */ "./x");`,
      `import("./x" /* require */);`,
      `/* import */ import("./x");`,
      `// import\nimport("./x");`,
      `import("./x", { with: { import: "import" } });`,
      `import("./x", /* import */ { with: {} });`,
      `import("./x", { with: {} } /* import */);`,
      `import("./x", imported);\ndeclare const imported: ImportCallOptions;`,
      `import("./x", (imported));\ndeclare const imported: ImportCallOptions;`,
      `import("./x", "import" as any);`,
      `const a = /* import */ import("./x");`,
      `async function f() { await /* require */ import("./x"); }`,
      `import("./x").then(m => "import");`,
      `import("./require");`,
      `import("./x"); import("./x");`,
      `import("./x"); /* import */`,
      "import(`./import`);",
      `import("./x",);`,
      `import("./x", /* import */);`,
      `[import("./import"), import("./x")];`,
      `import ( "./x" ) ;`,
      `import("./reimported");`,
      `import("./iimport");`,
      `import("./importimport");`,
      `import("./rrequire");`,
      `type T = typeof import("./import");`,
      `type T = import("./import").T;`,
      `import "./import";`,
      `import * as i from "./import"; i;`,
    ];
    const javascript = [
      `require("./require");`,
      `require("./x");`,
      `require(/* require */ "./x");`,
      `const a = require("./import");`,
      `import("./import");`,
      `/** import */ import("./x");`,
      `/** import */ /* import */ // import\nimport("./x");`,
      `/**/ import("./x");`,
      `x = /** import */ import("./x");`,
      `/** require */\nconst a = require("./x");`,
      `require("./x"); // require`,
      `module.exports = require("./require-import");`,
    ];
    const imported = [
      "import",
      "x",
      "import-import",
      "require",
      "reimported",
      "iimport",
      "importimport",
      "rrequire",
      "require-import",
    ];
    const cases = [
      ...typescript.map(text => ["ts", text, "export type T = 1;\n"]),
      ...javascript.map(text => ["js", text, "module.exports = 1;\n"]),
    ];
    using dir = tempDir("bun-check-differential", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { composite: true, noEmit: true, types: [], allowJs: true, skipLibCheck: true },
        files: cases.map(([extension], i) => `c${i}/a.${extension}`),
      }),
      ...Object.fromEntries(
        cases.flatMap(([extension, text, other], i) => [
          [`c${i}/a.${extension}`, text + "\n"],
          ...imported.map(name => [`c${i}/${name}.${extension}`, other]),
        ]),
      ),
    });
    const root = String(dir);
    const [bun, theirs] = await Promise.all([
      linesOf([bunExe(), "check"], root, root),
      linesOf([tsc!, "--pretty", "false", "--tsBuildInfoFile", join(root, "out.tsbuildinfo")], root, root),
    ]);
    expect(theirs.filter(line => line.includes("The file is in the program because:")).length).toBeGreaterThan(20);
    expect(bun).toEqual(theirs);
  },
  timeout,
);

const swapCase = (text: string) =>
  text.replace(/[a-z]/gi, c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
// A debug build checks a sample of the projects that take a process each.
const everyProject = isDebug || isASAN ? 4 : 1;

/** What `cmd` prints, sorted, without the path of `root`. */
async function linesOf(cmd: string[], cwd: string, root: string) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""))
    .sort();
}

/** `run` for each of `items`, a few at a time. */
async function inTurns<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let at = 0; at < items.length; at += 6) await Promise.all(items.slice(at, at + 6).map(run));
}

differential(
  "values of compiler options",
  async () => {
    // Valid, formerly valid, misspelled, empty and of the wrong type.
    const values: Record<string, unknown[]> = {
      target: ["es3", "ES3", "es5", "es6", "ES2015", "es2025", "es2026", "esnext", "latest", "foo", "", 5, true, null],
      module: [
        "none",
        "amd",
        "umd",
        "system",
        "commonjs",
        "es6",
        "es2022",
        "node16",
        "NodeNext",
        "preserve",
        "foo",
        "",
        1,
      ],
      moduleResolution: ["classic", "node", "node10", "node16", "nodenext", "bundler", "foo", ""],
      jsx: ["preserve", "react", "react-jsx", "react-jsxdev", "react-native", "foo", false],
      moduleDetection: ["auto", "legacy", "force", "foo"],
      newLine: ["crlf", "lf", "foo", 1],
      lib: [
        ["es3"],
        ["es5"],
        ["foo"],
        ["es5", "foo"],
        ["foo", "es5", "bar"],
        ["ES2025"],
        ["esnext.foo"],
        ["es5", 1],
        ["es5", null],
        ["es5", ""],
        [],
        "es5",
        1,
      ],
      types: ["node", [1], [null], [""], [1, "missing", 2]],
      moduleSuffixes: [[""], [1, ".ios"], ".ios"],
      rootDirs: [[1], ["."], "."],
      typeRoots: [[1], [null]],
      plugins: [[1], [{}], {}],
      customConditions: [[1], ["a"], "a"],
      paths: [1, [], { "a": 1 }, { "a": ["./a"] }],
      strict: ["true", 1, null, false],
      maxNodeModuleJsDepth: ["1", 1],
      ignoreDeprecations: ["5.0", "6.0", "7.0", "foo", 6],
    };
    // Next to `compilerOptions`.
    const others: Record<string, unknown[]> = {
      files: [[1], ["a.ts", 1], ["missing.ts"], [null], [""], [], "a.ts", 1, {}, null],
      include: [[1], [1, "x"], [{}], ["*.ts", true], [null], [""], [], "*.ts", null],
      exclude: [[1], ["a.ts"], [null], "a.ts", null],
      references: [[1], [{}], [{ path: 1 }], [{ path: "" }], [null], [], {}, null],
      extends: [1, true, {}, [1], [[]], [null], [""], "", [], ["./missing"], "./missing", null],
      compileOnSave: [1, "true", true, null],
      typeAcquisition: [1, {}],
      watchOptions: [1],
      buildOptions: [1],
      unknown: [1],
    };
    const cases: { compilerOptions?: object }[] = [
      ...Object.entries(values).flatMap(([name, all]) => all.map(value => ({ compilerOptions: { [name]: value } }))),
      ...Object.entries(others).flatMap(([name, all]) => all.map(value => ({ [name]: value }))),
    ].filter((_, i) => i % everyProject === 0);
    using dir = tempDir(
      "bun-check-differential",
      Object.fromEntries(
        cases.flatMap((options, i) => [
          [
            `c${i}/tsconfig.json`,
            JSON.stringify({
              ...options,
              compilerOptions: { noEmit: true, skipLibCheck: true, ...options.compilerOptions },
            }),
          ],
          [`c${i}/a.ts`, `export {};\n`],
        ]),
      ),
    );
    const root = String(dir);
    const results: { options: object; bun: string[]; tsc: string[] }[] = [];
    await inTurns([...cases.entries()], async ([i, options]) => {
      const [bun, typescript] = await Promise.all([
        linesOf([bunExe(), "check", "-p", `c${i}`], root, root),
        linesOf([tsc!, "-p", `c${i}`, "--pretty", "false"], root, root),
      ]);
      results.push({ options, bun, tsc: typescript });
    });
    expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
  },
  timeout,
);

// Every kind of value that is not JSON, and lists with `null` in them, in every kind of place.
differential(
  "what is not JSON in a configuration file",
  async () => {
    const values = [
      "tru",
      "undefined",
      "`es5`",
      "true + 1",
      "f()",
      "-x",
      "+1",
      "-1",
      "'single'",
      "1n",
      "/re/",
      "NaN",
      "(1)",
      "new X",
      "a.b",
      "!0",
      "void 0",
      "x => x",
      "[tru]",
      "{ a }",
      "[,]",
      "[1, tru, 'q']",
      `{ "a": tru }`,
      "null",
      "[null]",
      `[null, "q"]`,
      `["q", null, 1]`,
      "[]",
    ];
    // Not the `path` of a reference: TypeScript 7.0.2 crashes unless it is a string.
    const places: ((value: string) => string)[] = [
      value => `{ "compilerOptions": { "strict": ${value} } }`,
      value => `{ "compilerOptions": { "target": ${value} } }`,
      value => `{ "compilerOptions": { "outDir": ${value} } }`,
      value => `{ "compilerOptions": { "maxNodeModuleJsDepth": ${value} } }`,
      value => `{ "compilerOptions": { "lib": ${value} } }`,
      value => `{ "compilerOptions": { "types": ${value} } }`,
      value => `{ "compilerOptions": { "lib": ["es5", ${value}] } }`,
      value => `{ "compilerOptions": { "types": [${value}] } }`,
      value => `{ "compilerOptions": { "paths": ${value} } }`,
      value => `{ "compilerOptions": { "paths": { "a": ${value} } } }`,
      value => `{ "compilerOptions": { "paths": { "a": [${value}] } } }`,
      value => `{ "compilerOptions": { "qqqqqq": ${value} } }`,
      value => `{ "compilerOptions": ${value} }`,
      value => `{ "typeAcquisition": { "enable": ${value}, "include": [${value}] } }`,
      value => `{ "typeAcquisition": { "qqqqqq": ${value}, "Enable": ${value}, "exclude": ${value} } }`,
      value => `{ "typingOptions": { "enable": ${value} } }`,
      value => `{ "include": ${value} }`,
      value => `{ "include": ["a.ts", ${value}] }`,
      value => `{ "files": ${value} }`,
      value => `{ "files": ["a.ts", ${value}] }`,
      value => `{ "extends": ${value} }`,
      value => `{ "extends": [${value}] }`,
      value => `{ "references": ${value} }`,
      value => `{ "references": [${value}] }`,
      value => `{ "compileOnSave": ${value} }`,
      value => `{ "qqqqqq": ${value} }`,
      // After a comment and a line break: an error is at the end of the token before the value.
      value => `{\n  "compilerOptions": {\n    "strict": // why\n      /* so */ ${value}\n  }\n}`,
      value =>
        `{ "compilerOptions": { "target": /* a */ /* b */${value} , "lib": [ /* c */ ${value} /* d */ , // e\n ${value} ] } }`,
      value => `{\r\n  "compilerOptions": {\r\n    "strict":\r\n\t${value}\r\n  }\r\n}`,
      value => value,
    ];
    // Each takes two processes. Along the diagonals: each place and each value is in it.
    const step = 12;
    const cases = places.flatMap((place, i) => values.filter((_, j) => (i + j) % step === 0).map(place));
    // The root is a list. TypeScript 7.0.2 takes the first object in it for the configuration, and says nothing about the
    // list (TS5092) unless there is none.
    const implicit = (value: boolean) => `{ "compilerOptions": { "noImplicitAny": ${value} } }`;
    cases.push(
      `[${implicit(true)}]`,
      `[${implicit(false)}]`,
      `[${implicit(true)}, ${implicit(false)}]`,
      `[${implicit(false)}, ${implicit(true)}]`,
      `[1, ${implicit(false)}]`,
      `[[${implicit(false)}]]`,
      `[{ "compilerOptions": { "noImplicitAny": tru } }]`,
      `[{ "files": ["nowhere.ts"] }]`,
      `[{}]`,
    );
    using dir = tempDir(
      "bun-check-differential",
      Object.fromEntries(
        cases.flatMap((text, i) => [
          [`c${i}/tsconfig.json`, text + "\n"],
          // What it says about `x` shows which options are in force.
          [`c${i}/a.ts`, `export function f(x) {\n  return x;\n}\n`],
        ]),
      ),
    );
    const root = String(dir);
    const results: { text: string; bun: string[]; tsc: string[] }[] = [];
    await inTurns([...cases.entries()], async ([i, text]) => {
      // With `references`, `bun check` is `tsc -b`, which refuses `--skipLibCheck`.
      const project = text.includes(`"references"`) ? ["-b", `c${i}`] : ["-p", `c${i}`, "--skipLibCheck"];
      const [bun, typescript] = await Promise.all([
        linesOf([bunExe(), "check", "-p", `c${i}`, "--skipLibCheck"], root, root),
        linesOf([tsc!, ...project, "--noEmit", "--pretty", "false"], root, root),
      ]);
      results.push({ text, bun, tsc: typescript });
    });
    expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
  },
  timeout,
);

// What is relative is relative to the file that it is written in.
differential(
  "paths in a configuration file that is extended",
  async () => {
    const paths = [
      "*.ts",
      "./*.ts",
      "../*.ts",
      "/nowhere/*.ts",
      "C:/nowhere/*.ts",
      "c:\\nowhere\\*.ts",
      "\\\\server\\share\\*.ts",
      "C:nowhere/*.ts",
      "${configDir}/*.ts",
    ];
    // A drive or a server is the start of a path on Windows only. Elsewhere there is no such file to either, but
    // TypeScript names it as on Windows.
    const isOfWindows = (path: string) => /^([a-z]:[\\/]|\\\\)/i.test(path);
    const cases = ["include", "exclude", "files"]
      .flatMap(name => paths.map(path => [name, path]))
      .filter(([name, path]) => isWindows || name !== "files" || !isOfWindows(path))
      .map(([name, path]) => ({ [name]: [path] }));
    using dir = tempDir(
      "bun-check-differential",
      Object.fromEntries(
        cases.flatMap((base, i) => [
          [
            `c${i}/base/tsconfig.json`,
            JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true }, ...base }),
          ],
          [`c${i}/project/tsconfig.json`, JSON.stringify({ extends: "../base/tsconfig.json" })],
          [`c${i}/project/a.ts`, `export const a: number = "1";\n`],
          [`c${i}/base/b.ts`, `export const b: number = "1";\n`],
        ]),
      ),
    );
    const root = String(dir);
    const results: { base: object; bun: string[]; tsc: string[] }[] = [];
    await inTurns([...cases.entries()], async ([i, base]) => {
      const [bun, typescript] = await Promise.all([
        linesOf([bunExe(), "check", "-p", `c${i}/project`], root, root),
        linesOf([tsc!, "-p", `c${i}/project`, "--pretty", "false"], root, root),
      ]);
      results.push({ base, bun, tsc: typescript });
    });
    expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
  },
  timeout,
);

const casingOptions = { ...JSON.parse(tsconfig).compilerOptions };
const casingConfig = (more: object, top: object = {}) =>
  JSON.stringify({ compilerOptions: { ...casingOptions, ...more }, exclude: ["**/hidden"], ...top });
// The name of the configuration file, and `forceConsistentCasingInFileNames`.
const casingSettings: [string, object][] = [
  ["tsconfig.json", {}],
  ["tsconfig.off.json", { forceConsistentCasingInFileNames: false }],
  ["tsconfig.on.json", { forceConsistentCasingInFileNames: true }],
];
const isAboutCasing = (line: string) => /error TS(1149|1261):/.test(line);

const isCaseSensitive = (() => {
  using probe = tempDir("bun-check-differential", { "probe": "" });
  return !existsSync(join(String(probe), "PROBE"));
})();
// TypeScript takes every file system to be like the one that its executable is in. `bun check` looks at the project.
const aboutCase = test.concurrent.skipIf(!tsc || isCaseSensitive !== !existsSync(swapCase(tsc)));

aboutCase(
  "file names that differ only in case",
  async () => {
    const target = `export class T { private secret = 1; }\nexport const wrong: number = "1";\n`;
    // How a file refers to `S`, a specifier without an extension. `I` makes its names unique.
    const forms: Record<string, string> = {
      import: `import { T as TI } from "S"; export const vI: TI | undefined = undefined;`,
      type: `import type { T as TI } from "S"; export const vI: TI | undefined = undefined;`,
      export: `export { T as TI } from "S";`,
      star: `export * as nI from "S";`,
      call: `export const vI = import("S");`,
      typeof: `export const vI: import("S").T | undefined = undefined;`,
      side: `import "S";`,
      path: `/// <reference path="S.ts" />`,
    };
    const refer = (form: string, specifiers: string[]) =>
      specifiers.map((it, i) => forms[form].replaceAll("S", () => it).replace(/I\b/g, () => String(i))).join("\n") +
      "\n";
    const spellings = { right: "./button", wrong: "./Button", other: "./BUTTON" };
    type Spelling = keyof typeof spellings;
    const orders: Spelling[][] = [
      ["wrong"],
      ["right", "wrong"],
      ["wrong", "right"],
      ["wrong", "other"],
      ["wrong", "wrong"],
      ["right", "wrong", "other"],
    ];

    const shared: Record<string, Record<string, string>> = {};
    const alone: Record<string, { files: Record<string, string>; top?: object }> = {};
    // The file that refers to it comes before or after it among the root files.
    for (const [form, from, order] of product(Object.keys(forms), ["App", "zapp"], orders)) {
      shared[`one-${form}-${from}-${order.join("-")}`] = {
        [`${from}.ts`]:
          refer(
            form,
            order.map(it => spellings[it]),
          ) + "export {};\n",
        "button.ts": target,
      };
    }
    // It is not a root file.
    for (const [form, order] of product(["import", "path", "call"], orders.slice(0, 4))) {
      shared[`hidden-${form}-${order.join("-")}`] = {
        "App.ts":
          refer(
            form,
            order.map(it => spellings[it].replace("./", "./hidden/")),
          ) + "export {};\n",
        "hidden/button.ts": target,
      };
    }
    // Two files refer to it.
    for (const [a, b, first] of product(["right", "wrong"] as Spelling[], Object.keys(spellings) as Spelling[], [
      "App",
      "zapp",
    ])) {
      shared[`two-${a}-${b}-${first}`] = {
        [`${first}.ts`]: refer("import", [spellings[a]]),
        [`${first === "App" ? "Bpp" : "zbpp"}.ts`]: refer("import", [spellings[b]]),
        "button.ts": target,
      };
    }
    // The directory is spelled differently, and the file imports another.
    const inDirectories = [
      ["./Dir/leaf"],
      ["./dir/leaf", "./Dir/leaf"],
      ["./Dir/leaf", "./dir/leaf"],
      ["./Dir/leaf", "./DIR/Leaf"],
    ];
    for (const [specifiers, from] of product(inDirectories, ["App", "zapp"])) {
      shared[`directory-${from}-${inDirectories.indexOf(specifiers)}`] = {
        [`${from}.ts`]: refer("import", specifiers),
        "dir/leaf.ts": `export { T } from "./deeper";\n`,
        "dir/deeper.ts": target,
      };
    }
    shared["meet"] = {
      "App.ts": `import { T } from "./Button";\nimport { T as Same } from "./button";\nexport const a: Same = new T();\n`,
      "button.ts": target,
    };
    shared["itself"] = {
      "button.ts": `import { T as Me } from "./Button";\nexport class T { private secret = 1; }\nexport const me: Me = new T();\n`,
    };
    shared["itself-by-path"] = { "button.ts": `/// <reference path="./Button.ts" />\nexport const b = 1;\n` };
    shared["cycle"] = {
      "App.ts": `import "./Button";\nexport const a = 1;\n`,
      "button.ts": `import "./app";\nexport const b = 1;\n`,
    };
    // A package, of which there is a copy in each of these directories.
    const inPackages = [
      ["pkg"],
      ["Pkg"],
      ["pkg", "Pkg"],
      ["Pkg", "pkg"],
      ["pkg/sub", "pkg/Sub"],
      ["pkg/Sub", "pkg/sub"],
      ["pkg/Sub"],
      ["Pkg/Sub", "pkg/sub", "pkg"],
    ];
    for (const specifiers of inPackages) {
      shared[`package-${inPackages.indexOf(specifiers)}`] = {
        "App.ts": refer("import", specifiers),
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", types: "index.d.ts" }),
        "node_modules/pkg/index.d.ts": `export declare class T { private secret; }\n`,
        "node_modules/pkg/sub.d.ts": `export declare class T { private secret; }\n`,
      };
    }
    // `files` has a file in two spellings, in a spelling that the directory does not have, or has a file that is not there.
    const lists = [
      ["button.ts", "Button.ts"],
      ["Button.ts", "button.ts"],
      ["Button.ts"],
      ["Button.ts", "App.ts"],
      ["App.ts", "Button.ts"],
      ["App.ts", "button.ts", "BUTTON.ts"],
      ["none.ts", "None.ts"],
      ["None.ts", "none.ts", "NONE.ts", "App.ts"],
      ["App.ts", "none.ts", "none.ts"],
      ["button.js", "Button.js"],
    ];
    for (const files of lists) {
      alone[`listed-${lists.indexOf(files)}`] = {
        files: { "App.ts": refer("import", ["./button"]), "button.ts": target },
        top: { files },
      };
    }

    if (isCaseSensitive) {
      // Two files.
      const some: Spelling[][] = [["right"], ["wrong"], ["right", "wrong"], ["wrong", "right"]];
      for (const [form, from, order] of product(["import", "path"], ["App", "zapp"], some)) {
        alone[`both-${form}-${from}-${order.join("-")}`] = {
          files: {
            [`${from}.ts`]:
              refer(
                form,
                order.map(it => spellings[it]),
              ) + "export {};\n",
            "button.ts": target,
            "Button.ts": target,
          },
        };
      }
      alone["both"] = { files: { "button.ts": target, "Button.ts": target } };
    }

    const files: Record<string, string> = {};
    for (const [config, more] of casingSettings) files[`shared/${config}`] = casingConfig(more);
    for (const [name, of] of Object.entries(shared)) {
      for (const [path, text] of Object.entries(of)) files[`shared/${name}/${path}`] = text;
    }
    const projects = Object.keys(alone).filter((_, index) => index % everyProject === 0);
    for (const name of projects) {
      for (const [config, more] of casingSettings)
        files[`alone/${name}/${config}`] = casingConfig(more, alone[name].top);
      for (const [path, text] of Object.entries(alone[name].files)) files[`alone/${name}/${path}`] = text;
    }
    using dir = tempDir("bun-check-differential", files);
    const root = String(dir);

    // Which package id a path gets, and with it which copy of a package file is kept, is a race between the threads of
    // TypeScript.
    const both = async (directory: string, config: string) => {
      const [theirs, ours] = await Promise.all([
        linesOf([tsc!, "-p", config, "--pretty", "false", "--singleThreaded"], join(root, directory), root),
        linesOf([bunExe(), "check", "-p", config], join(root, directory), root),
      ]);
      return { theirs, ours };
    };
    const different: Record<string, object> = {};
    let aboutCasing = 0;
    await inTurns(
      [
        ...product(
          ["shared", ...projects.map(it => `alone/${it}`)],
          casingSettings.map(it => it[0]),
        ),
      ],
      async ([directory, config]) => {
        const { theirs, ours } = await both(directory, config);
        aboutCasing += theirs.filter(isAboutCasing).length;
        // Of a long list, what is different.
        const only = (a: string[], b: string[]) => a.filter(line => !b.includes(line));
        if (!Bun.deepEquals(theirs, ours)) {
          different[`${directory} ${config}`] = { onlyTypeScript: only(theirs, ours), onlyBun: only(ours, theirs) };
        }
        expect(theirs.length).toBeGreaterThan(0);
      },
    );
    expect(different).toEqual({});
    // The oracle has something to say.
    expect(aboutCasing).toBeGreaterThan(isCaseSensitive ? 4 : 200);
  },
  timeout,
);

// A project that is referenced in a spelling that the directory does not have, or in two, is one project, under the name
// in the last reference. `tsc -b` is the oracle.
aboutCase(
  "project references that differ only in case",
  async () => {
    const options = { ...casingOptions, noEmit: false, composite: true, outDir: "out", rootDir: "." };
    const config = (top: object = {}) => JSON.stringify({ compilerOptions: options, ...top });
    const combinations = [
      ...product(
        ["../core", "../Core", "../CORE/tsconfig.json"],
        [undefined, "../core", "../Core"],
        ["../core/x", "../Core/x", "../core/X"],
      ),
    ].filter((_, index) => index % everyProject === 0);
    const files: Record<string, string> = {};
    combinations.forEach(([first, second, imported], index) => {
      const references = [first, second].filter(it => it !== undefined).map(path => ({ path }));
      files[`${index}/core/tsconfig.json`] = config();
      files[`${index}/core/x.ts`] = `export class T { private secret = 1; }\nexport const wrong: number = "1";\n`;
      files[`${index}/app/tsconfig.json`] = config({ references });
      files[`${index}/app/a.ts`] =
        `import { T } from "${imported}";\nexport const t: T = new T();\nexport const bad: string = 1;\n`;
    });
    using dir = tempDir("bun-check-differential", files);
    const root = String(dir);
    const different: Record<string, object> = {};
    await inTurns([...combinations.keys()], async index => {
      const cwd = join(root, String(index), "app");
      // In this order: `tsc -b` writes files.
      const ours = await linesOf([bunExe(), "check"], cwd, root);
      const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], cwd, root);
      expect(theirs.length).toBeGreaterThan(0);
      if (!Bun.deepEquals(theirs, ours)) different[combinations[index].join(" ")] = { theirs, ours };
    });
    expect(different).toEqual({});
  },
  timeout,
);
