// What is reported while a loop is analyzed stays reported, also under a name that turns out to be made from itself: nothing is checked again with the same types.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `interface L { v: number; go(): L; pick(x: string): number; pick(x: number): string; pick(x: unknown): L }
declare const n: number; declare const c: boolean; declare const l: L; declare function over(x: string): number; declare function over(x: number): string; declare function over(x: unknown): boolean;
export function spread(b: any) { let a = []; let d = []; for (let i = 0; i < n; i++) { a = [...a, d]; d = d.slice(1); var t = [...a, b]; a = over(t as any); } }
export function tested() { let a; let b: L | undefined = l; let d = []; for (let i = 0; i < n; i++) { if (d) { b = b!.pick(d as never as unknown); } let t = d.concat(1 as any); d = over(t as any); a = b.toString(); d = [...d, a]; } }
export function copied() { let a = []; let b; for (let i = 0; i < n; i++) { b = b; a = a.filter(Boolean); let t = b; if (c) b = t; b = l.pick(b); if (a === null) continue; const u = a.toString(); b = u; } }
`;

// The errors are those of TypeScript 7.0.2.
test("what a loop reports around names that are made from themselves", async () => {
  using dir = tempDir("check-reports-of-loops-around-cycles", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`)).toEqual([
    "(3,50) TS7034",
    "(3,107) TS7005",
    "(3,123) TS7022",
    "(3,138) TS2322",
    "(4,65) TS7034",
    "(4,124) TS7005",
    "(4,154) TS7022",
    "(4,158) TS7005",
    "(4,178) TS2322",
    "(5,32) TS7034",
    "(5,88) TS7005",
    "(5,111) TS7022",
  ]);
});
