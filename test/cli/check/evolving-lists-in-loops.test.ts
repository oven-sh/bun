// While a loop is analyzed, getQuickTypeOfExpression checks the callee of an assigned call and TypeScript keeps what that reports: here that the lists have
// no type yet. The walk with the final types reports none of it.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `declare function pick(x: string): number; declare function pick(x: number): string; declare function pick(x: unknown): boolean; declare const n: number;
export function f() {
  let a = [];
  let b = [];
  let d: { v: number } | string | null = null;
  for (let i = 0; i < n; i++) {
    d = (b as any[]).concat(a).slice(0, 3);
    if (Array.isArray(d)) { a = typeof d === "string" ? d : n; }
    b = pick(a as never);
  }
}
`;

// The errors are those of TypeScript 7.0.2.
test("lists without a type that calls in a loop are made from", async () => {
  using dir = tempDir("check-evolving-lists-in-loops", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)/gm);
  expect([...told].map(([, at, code]) => `${at} ${code}`).sort()).toEqual([
    "(3,7) TS7034",
    "(4,7) TS7034",
    "(7,10) TS7005",
    "(7,29) TS7005",
    "(7,5) TS2322",
    "(8,29) TS2322",
    "(9,5) TS2322",
  ]);
});
