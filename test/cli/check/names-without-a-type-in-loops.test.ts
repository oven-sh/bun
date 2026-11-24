// A loop's back edge may lead to a name whose type is being found. The name gets its type then (`any`, TS7022), and what the search in progress returns
// to the expression that asked first isn't what the next check of that expression gets.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface L { v: number; go(): L; pick(x: string): number; pick(x: number): string; pick(x: unknown): L }
declare function over(x: string): number; declare function over(x: number): string; declare function over(x: unknown): boolean;
declare const n: number; declare const l: L;
export function assigned() { let b: string | number = "s"; for (let i = 0; i < n; i++) { b = b.valueOf(); let t = over(b as any); b = t; } }
export function sometimes() { let b: string | number = "s"; for (let i = 0; i < n; i++) { b = b.valueOf(); let t = over(b as any); if (i) b = t; } }
export function measured() { let b: string | number = "s"; for (let i = 0; i < n; i++) { b = b.toString().length; var t = over(b as any); b = t; } }
export function picked() { let a: L | string | number | L[] = l; for (let i = 0; i < n; i++) { a = a.toString(); const t = l.pick(a); if (i) a = t; const p: never = a; } }
export function listed() { let a = []; let d: L | string | number | L[] = l; for (let i = 0; i < n; i++) { let t = a.filter(Boolean); d = t; let u = l.pick(d); a = u; } }
export function given() { let b: string | number = "s"; for (let i = 0; i < n; i++) { b = b.valueOf(); let t = over(b as any); b = over(t); } }
export function shared() { let b: string | number = "s"; for (let i = 0; i < n; i++) { b = b.valueOf(); let t = over(b as any); b = t; const u: never = t; } }
`;

// The errors are those of TypeScript 7.0.2.
test("names in loops that are any because they are made from themselves", async () => {
  using dir = tempDir("check-names-without-a-type-in-loops", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(4,111) TS7022",
    "(5,112) TS7022",
    "(6,119) TS7022",
    "(7,120) TS7022",
    "(7,155) TS2322",
    "(8,112) TS7022",
    "(8,146) TS7022",
    "(9,108) TS7022",
    "(9,128) TS2322",
    "(10,109) TS7022",
    "(10,142) TS2322",
  ]);
});
