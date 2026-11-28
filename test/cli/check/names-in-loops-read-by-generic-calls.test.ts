// While the arguments of a generic call are checked and a loop is in progress, the type of a name that is declared outside of the arguments is stored as
// ever (links.resolvedType), if the loop is in the same function: the check of its declaration finds what the loop knew then.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface A { k: 1; next(): B } interface B { k: 2; next(): C } interface C { k: 3; next(): A } type U = A | B | C;
declare const n: number; declare const c: boolean; declare const first: A; declare const second: B; declare const third: C; declare const over: any; declare function both<T, V>(a: T, b: V): T | V; declare function id<T>(v: T): T;
export function two() { let a: U = second; let b: U = second; while (c) { var t = both(b, a); b = over(t); var u = a.next(); a = over(u); } return [a, b]; }
export function states() { let a: U = third; let b: U = third; for (let i = 0; i < n; i++) { switch (b.k) { case 1: { const t = a.next(); b = over(t); switch (b.k) { case 1: { const u = both(a, a); a = over(u); break; } default: { const v = b?.next(); a = over(v); } } } } } return [a, b]; }
export function one() { let a: U = second; while (c) { var t = id(a); a = over(t); var u = a.next(); a = over(u); } return a; }
export function inside() { let a: U = second; let b: U = second; while (c) { var t = both(b, [a].map(x => { const y = x.next(); return y; })); b = over(t); var u = a.next(); a = over(u); } return [a, b]; }
export function plain() { let a: U = second; let b: U = second; while (c) { var t = b.next(); b = over(t); var u = a.next(); a = over(u); } return [a, b]; }
`;

// The errors are those of TypeScript 7.0.2.
test("names in loops whose types generic calls ask for", async () => {
  using dir = tempDir("check-names-in-loops-read-by-generic-calls", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(3,79) TS7022",
    "(3,112) TS2322",
    "(4,125) TS2322",
    "(4,183) TS7022",
    "(5,60) TS7022",
    "(5,88) TS7022",
    "(6,82) TS7022",
    "(6,161) TS2322",
  ]);
});

const ringTsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
  files: ["first.ts", "second.ts"],
});

const first = `import { A2, f2 } from "./second";
export const v = o.m();
export const A0 = (a?: any) => f0();
export const o = { m() { return [(x.p ?? (x.m() ?? 2n)), 1]; }, get g() { return [1].any1; }, p: [((({ ...null as any, q: "a" })) ? y : f1(1))].map(A2)[0] };
export function f0(a = ((1) ? any.any : D)) { if (a) return (() => ((R.a) ? 1 : 1))(); return Promise.resolve(f1([1].filter(x => ((1) ? true : true)))).then(y => (1)); }
export const { a: R = ((1) ? 1 : f2(true)) } = { a: 2n };
`;

const second = `import { A0, v } from "./first";
export function f3(a) { let l = []; for (const z of 1) { l = l.concat(v); } return "a"; }
export function f2(a = A0((() => ({}))())) { if (a) return 1; return 1; }
export const A2 = (a: G) => (() => [any.any, ((({ ..."a" as any, q: 1 })) ? [1, true] : f2(nowhere))])();
`;

// The errors are those of TypeScript 7.0.2.
test("names that are declared outside of the function that has the loop", async () => {
  using dir = tempDir("check-names-in-loops-of-other-functions", {
    "tsconfig.json": ringTsconfig,
    "first.ts": first,
    "second.ts": second,
  });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^(first|second)\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, file, at, code]) => `${file} ${at} ${code}`)).toEqual([
    "first (2,18) TS2448",
    "first (2,18) TS2454",
    "first (3,14) TS7023",
    "first (4,35) TS2304",
    "first (4,43) TS2304",
    "first (4,86) TS2339",
    "first (4,100) TS2872",
    "first (4,133) TS2304",
    "first (4,137) TS2304",
    "first (5,17) TS7023",
    "first (5,31) TS2693",
    "first (5,41) TS2304",
    "first (5,62) TS7024",
    "first (5,72) TS2339",
    "first (5,111) TS2304",
    "first (6,19) TS7022",
    "second (2,20) TS7006",
    "second (2,29) TS7034",
    "second (2,53) TS2488",
    "second (2,62) TS7005",
    "second (3,20) TS7022",
    "second (4,23) TS2304",
    "second (4,37) TS2693",
    "second (4,47) TS2872",
    "second (4,92) TS2304",
  ]);
});
