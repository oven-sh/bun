// What narrows a name of a pattern is found by `getFlowTypeOfDestructuring` with the loops in progress and with what they have found until then
// (`flowTypeCache`), although the name's type is being resolved: `checkExpressionCached` alone hides them.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface A { k: 1; next(): B } interface B { k: 2; next(): C } interface C { k: 3; next(): A } type U = A | B | C;
declare const n: number; declare const first: A; declare const second: B; declare const third: C; declare const c: boolean; declare const over: any;
export function rest() { let a: U = third; let b: U = second; let d: U = second; for (let i = 9; i--; ) { b = over(a); d = over(1); if (d.k === b.k) n; for (;;) { const { k: t, ...r } = d; d = over(r, t); if (c) continue; break; } a = over(d); } return [a, b, d]; }
export function broken() { let a: U = third; let b: U = second; let d: U = second; for (let i = 9; i--; ) { b = over(a); d = over(1); if (d.k === b.k) n; for (;;) { const { k: t, ...r } = d; d = over(r, t); if (c) break; } a = over(d); } return [a, b, d]; }
export function ended() { let a: U = third; let b: U = second; let d: U = second; for (let i = 9; i--; ) { b = over(a); d = over(1); try { if (d.k === b.k) throw 1; } finally { for (;;) { const { k: t, ...r } = d; d = over(r, t); if (c) continue; break; } } a = over(d); } return [a, b, d]; }
export function told() { let a: U = third; let b: U = second; let d: U = second; for (let i = 9; i--; ) { b = over(a); d = over(1); if (d.k === b.k) n; const { k: t, ...r } = d; d = over(r, t); a = over(d); } return [a, b, d]; }
`;

// The errors are those of TypeScript 7.0.2.
test("names of patterns in loops", async () => {
  using dir = tempDir("check-patterns-in-loops", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual(["(6,164) TS7022"]);
});
