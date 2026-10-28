import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
    noEmit: true,
  },
});

const sources = {
  "shapes.ts": `
export interface Arrow { tag: "arrow"; a: number; b: number; c: number; d: number; e: number; f: number; g0: number }
export interface Func { tag: "func"; a: number; b: number; c: number; d: number; e: number; f: number; g1: number }
export interface VarDecl { tag: "vardecl"; a: number; b: number; c: number; d: number; e: number; f: number; g2: number }
export interface CallExpr { tag: "callexpr"; a: number; b: number; c: number; d: number; e: number; f: number; g3: number }
export interface SwitchData { tag: "switchdata"; a: number; b: number; c: number; d: number; e: number; f: number; g4: number }
export interface Method { tag: "method"; a: number; b: number; c: number; d: number; e: number; f: number; g5: number }
export interface Getter { tag: "getter"; a: number; b: number; c: number; d: number; e: number; f: number; g6: number }
export interface ReduceData { tag: "reducedata"; a: number; b: number; c: number; d: number; e: number; f: number; g7: number }
export type Any = Arrow | Func | VarDecl | CallExpr | SwitchData | Method | Getter | ReduceData;
`,
  "unrelated.ts": `
export const unrelated = 0;
`,
  "alone.ts": `
import type { Any } from "./shapes.ts";
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data); return data; }
function read(text: string): Any { return keep(JSON.parse(text)); }
function describe(x: Any): string { return x.tag + " " + (x.a + x.f); }
const texts = ['{"tag":"arrow","a":0,"b":2,"c":3,"d":4,"e":5,"f":6,"g0":7}', '{"tag":"func","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g1":7}', '{"tag":"vardecl","a":2,"b":2,"c":3,"d":4,"e":5,"f":6,"g2":7}', '{"tag":"callexpr","a":3,"b":2,"c":3,"d":4,"e":5,"f":6,"g3":7}', '{"tag":"switchdata","a":4,"b":2,"c":3,"d":4,"e":5,"f":6,"g4":7}', '{"tag":"method","a":5,"b":2,"c":3,"d":4,"e":5,"f":6,"g5":7}', '{"tag":"getter","a":6,"b":2,"c":3,"d":4,"e":5,"f":6,"g6":7}', '{"tag":"reducedata","a":7,"b":2,"c":3,"d":4,"e":5,"f":6,"g7":7}'];
texts.forEach((text, index) => { const value = read(text); console.log(describe(value), value === kept[index]); });
`,
  "beside-an-unrelated-file.ts": `
import { unrelated } from "./unrelated.ts";
import type { Any } from "./shapes.ts";
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data); return data; }
function read(text: string): Any { return keep(JSON.parse(text)); }
function describe(x: Any): string { return x.tag + " " + (x.a + x.f); }
const texts = ['{"tag":"arrow","a":0,"b":2,"c":3,"d":4,"e":5,"f":6,"g0":7}', '{"tag":"func","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g1":7}', '{"tag":"vardecl","a":2,"b":2,"c":3,"d":4,"e":5,"f":6,"g2":7}', '{"tag":"callexpr","a":3,"b":2,"c":3,"d":4,"e":5,"f":6,"g3":7}', '{"tag":"switchdata","a":4,"b":2,"c":3,"d":4,"e":5,"f":6,"g4":7}', '{"tag":"method","a":5,"b":2,"c":3,"d":4,"e":5,"f":6,"g5":7}', '{"tag":"getter","a":6,"b":2,"c":3,"d":4,"e":5,"f":6,"g6":7}', '{"tag":"reducedata","a":7,"b":2,"c":3,"d":4,"e":5,"f":6,"g7":7}'];
texts.forEach((text, index) => { const value = read(text); console.log(describe(value), value === kept[index], unrelated); });
`,
};

describe.skipIf(!!unsupported)("compile/aot/record-type-order", () => {
  test.each(["alone.ts", "beside-an-unrelated-file.ts"])(
    "%s prints what bun run prints",
    program =>
      slot(async () => {
        using dir = tempDir("aot-record-type-order", { ...sources, "tsconfig.json": tsconfig });
        const folder = String(dir);
        built(await spawned([bunExe(), "build", "--compile", "--aot", "--outfile", "app", program], folder, bunEnv));
        const compiled = await spawned([join(folder, "app")], folder, {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect(compiled.signal).toBeNull();
        const plain = await spawned([bunExe(), "run", program], folder, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told(compiled)).toEqual(told(plain));
      }),
    600_000,
  );

  // No report names the members of a union that parsed data flows into, so their order can't be read.
  test.todo("a file that has nothing to do with a union does not change the order of its members");
});
