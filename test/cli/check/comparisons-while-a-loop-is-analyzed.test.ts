// While a loop is analyzed, a value's type is found without what `checkExpression` says about comparisons (`CheckModeTypeOnly`): a name still has the
// types that the loop has had until then.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface A { k: 1; next(): B } interface B { k: 2; next(): C } interface C { k: 3; next(): A }
declare const n: number; declare const first: A; declare const third: C; declare const over: any;
export function passed() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (a.k) { case 1: { b = over(1); } } let t; t = a.k === 1 ? a.next() : a; a = over(t); b = over(b); } return [a, b]; }
export function nested() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (b.k) { case 1: break; default: { switch (a.k) { case 1: { b = over(1); } } } } let t; t = a.k === 1 ? a.next() : a; a = over(t); } return [a, b]; }
export function listed() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (a.k) { case 1: { b = over(1); } } let t; t = [a.k === 1, a.k !== 1]; a = over(t); b = over(b); } return [a, b]; }
export function held() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (a.k) { case 1: { b = over(1); } } let t; t = { m: a.k === 1 }; a = over(t); b = over(b); } return [a, b]; }
export function told() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (a.k) { case 1: { b = over(1); } } let t; t = a.k === 4 ? a.next() : a; a = over(t); b = over(b); } return [a, b]; }
export function given() { let a: A | B | C = third; let b: A | B | C = first; for (let i = 0; i < n; i++) { switch (a.k) { case 1: { b = over(1); } } let t; t = over(a.k === 1) ? a.next() : a; a = over(t); b = over(b); } return [a, b]; }
`;

// The errors are those of TypeScript 7.0.2.
test("a comparison in a loop is told by the final types, as an argument by those of the moment", async () => {
  using dir = tempDir("check-comparisons-while-a-loop-is-analyzed", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(7,161) TS2367",
    "(7,175) TS2339",
    "(8,167) TS2367",
  ]);
});
