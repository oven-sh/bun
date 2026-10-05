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
