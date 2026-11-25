// While it's being found what a function returns, a comparison of the function takes `any` for it. TypeScript keeps what came of that: where the function is
// handed to overloads in what it returns, the overload that was chosen then stays applicable. That comparison was thrown away here, the call was resolved
// with the type that had been found meanwhile, and a program without errors was told TS2769.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = { strict: true, noEmit: true, target: "esnext", module: "esnext", lib: ["esnext"], types: [] };
const pick = "declare const cond: boolean;\ndeclare function pick(p: (v: number) => string): 1;\ndeclare function pick(p: (v: number) => boolean): 2;\n";
const filtered =
  "declare const cond: boolean; declare const mixed: (number | string)[];\ndeclare function pick<T, S extends T>(xs: T[], p: (v: T) => v is S): S[];\ndeclare function pick<T>(xs: T[], p: (v: T) => boolean): T[];\n";

test.concurrent.each([
  [`${pick}export function f(a: number) { if (cond) return pick(f); return null; }\nexport const q: never = f(1);\n`, "1 | null"],
  [`${pick}export function f(a: number) { return pick(f); }\nexport const q: never = f(1);\n`, "1"],
  [`${pick}export const q: never = f(1);\nexport function f(a: number) { const x = pick(f); return x; }\n`, "1"],
  [`${pick}export const f = (a: number) => pick(f);\nexport const q: never = f(1);\n`, "1"],
  [`${pick}export class K { m(a: number) { return pick(this.m); } }\nexport const q: never = new K().m(1);\n`, "1"],
  [`${filtered}export function f(a: number | string) { if (cond) return pick(mixed, f); return null; }\nexport const q: never = f(1);\n`, "(string | number)[] | null"],
  [`${filtered}export const q: never = o.m(1);\nexport const o = { m(a: number | string) { for (const x of mixed) if (cond) return pick(mixed, o.m); return null; } };\n`, null],
])("%s", async (program, type) => {
  using dir = tempDir("check-functions-handed-to-overloads", { "tsconfig.json": JSON.stringify({ compilerOptions }), "a.ts": program });
  const { stdout } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), { ...bunEnv, NO_COLOR: "1" });
  const told = [...stdout.matchAll(/error (TS\d+): (.*)/g)].map(it => `${it[1]}: ${it[2]}`);
  expect(told.filter(it => it.startsWith("TS2769"))).toEqual([]);
  if (type !== null) expect(told).toEqual([`TS2322: Type '${type}' is not assignable to type 'never'.`]);
});
