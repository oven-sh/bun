// While the arguments of a generic call are checked and a loop is in progress, the type of a name that is declared outside of the arguments is stored as
// ever (links.resolvedType): the check of its declaration finds what the loop knew then.
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
