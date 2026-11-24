// A parameter with a modifier declares a property of the instance, whatever the modifiers of the constructor (which are an error of their own).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] },
});

const program = `class A { static constructor(public m = 1) { } }
class B { m = 1; }
declare const a: A; declare const b: B;
const p0: never = a.m; const p1: never = A.m;
const p2: A = b; const p3: B = a;
class D extends A { q() { const p4: never = this.m; const p5: never = super.m; } }
abstract class E { abstract constructor(public m = 1) { } }
declare const e: E; const p6: never = e.m;
class F { static async constructor(public m = 1) { } }
declare const f: F; const p7: never = f.m;
export { p0, p1, p2, p3, p6, p7 };
`;

// The errors are those of TypeScript 7.0.2.
test("properties that are declared by constructors with a modifier", async () => {
  using dir = tempDir("check-static-constructors", { "tsconfig.json": tsconfig, "main.ts": program });
  const { stdout, stderr } = await run([bunExe(), "check", "--no-pretty", "--all"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = (stdout + stderr).matchAll(/^main\.ts(\(\d+,\d+\)): error (TS\d+)(: Type '\w+')?/gm);
  expect([...told].map(([, at, code, type]) => `${at} ${code}${type ?? ""}`)).toEqual([
    "(1,11) TS1089",
    "(4,7) TS2322: Type 'number'",
    "(4,30) TS2322: Type 'any'",
    "(4,44) TS2339",
    "(6,33) TS2322: Type 'number'",
    "(6,59) TS2322: Type 'number'",
    "(7,20) TS1242",
    "(8,27) TS2322: Type 'number'",
    "(9,11) TS1089",
    "(10,27) TS2322: Type 'number'",
  ]);
});
