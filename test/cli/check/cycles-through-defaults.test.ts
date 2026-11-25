// A later file calls a function without an argument for a parameter that has a default. Nothing requests the default there, but it leads into a cycle of functions that
// an earlier file enters. The check of the later file has to find that cycle too, or it keeps results that a check in order doesn't have. TypeScript reports TS7022,
// TS7023 and TS7024 here. Some of them were lost, and not the same ones in every run.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const compilerOptions = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  lib: ["esnext"],
  types: [],
};
const implicit = (name?: string) =>
  `${name ? `error TS7023: '${name}'` : "error TS7024: Function"} implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.`;
const refused = (source: string, target: string) =>
  `error TS2345: Argument of type '${source}' is not assignable to parameter of type '${target}'.`;
const initializer =
  "error TS7022: 'b' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.";
const unassignable = (source: string) => `error TS2322: Type '${source}' is not assignable to type 'never'.`;

// The files, in the order of "files", and what TypeScript reports for them.
const projects: Record<string, [files: Record<string, string>, expected: string[]]> = {
  "a getter's method": [
    {
      "m1.ts": `import { f0_0 } from "./m0";
import { o2_0 } from "./m2";
export const q1_0: never = o1_0.g.m(1);
export const o1_0 = { get g() { return { m(a: boolean, b = (() => f0_0(a))()) { let t; t = null; return t; } }; } };
`,
      "m2.ts": `import { pick, cond, strs } from "./h";
import { f0_0 } from "./m0";
import { o1_0 } from "./m1";
export const o2_0 = { m(a: unknown) { if (cond) return ({ a: strs.map(f0_0) }).a; return ({ a: pick(strs, o2_0.m) }).a; } };
export const q2_1: never = o2_0.m("x");
export const q2_0: never = o1_0.g.m("x");
`,
      "m0.ts": `import { nums } from "./h";
import { o1_0 } from "./m1";
import { o2_0 } from "./m2";
export const q0_0: never = o2_0.m(1);
export const f0_0 = (a: number) => nums.map(x => o1_0.g.m(x));
`,
    },
    [
      `m0.ts(4,14): ${unassignable("any[]")}`,
      `m0.ts(5,14): ${implicit("f0_0")}`,
      `m0.ts(5,45): ${implicit()}`,
      `m1.ts(3,14): ${unassignable("any")}`,
      "m1.ts(3,28): error TS2448: Block-scoped variable 'o1_0' used before its declaration.",
      "m1.ts(3,28): error TS2454: Variable 'o1_0' is used before being assigned.",
      `m1.ts(4,27): ${implicit("g")}`,
      `m1.ts(4,61): ${implicit()}`,
      `m1.ts(4,72): ${refused("boolean", "number")}`,
      `m2.ts(4,71): ${refused("(a: number) => any", "(value: string, index: number, array: string[]) => any")}`,
      `m2.ts(5,14): ${unassignable("any[]")}`,
      `m2.ts(6,14): ${unassignable("any")}`,
    ],
  ],
  "methods of classes and objects": [
    {
      "m3.ts": `import { id, nums, strs } from "./h";
import { f1_1 } from "./m1";
import { f2_2 } from "./m2";
export const o3_0 = { m(a: number) { return strs.every(f1_1); } };
export class C3_1 { m(a: any, b = id(f2_2(a))) { return nums.map(o3_0.m); } }
export declare const c3_1: C3_1;
`,
      "m1.ts": `import { over, cond, strs } from "./h";
import { f0_0 } from "./m0";
import { o3_0 } from "./m3";
export const f1_1 = (a: number, b = strs.every(c1_2.m)) => cond;
export class C1_2 { m(a: string, b = (cond ? over(f0_0) : f1_1(a))) { return strs.map(o3_0.m); } }
export declare const c1_2: C1_2;
`,
      "m0.ts": `import { cond, nums } from "./h";
import { f2_2 } from "./m2";
export function f0_0(a: any) { if (cond) return f2_2(a); return f0_1; }
export const f0_1 = (a: unknown) => nums;
`,
      "m2.ts": `import { strs } from "./h";
import { c3_1, o3_0 } from "./m3";
export function f2_2(a: string) { const t = strs.map(o3_0.m); return c3_1.m(a); }
`,
    },
    [
      `m0.ts(3,17): ${implicit("f0_0")}`,
      `m1.ts(4,33): ${initializer}`,
      `m1.ts(5,21): ${implicit("m")}`,
      `m1.ts(5,34): ${initializer}`,
      `m1.ts(5,64): ${refused("string", "number")}`,
      `m1.ts(5,87): ${refused("(a: number) => any", "(value: string, index: number, array: string[]) => any")}`,
      `m2.ts(3,17): ${implicit("f2_2")}`,
      `m2.ts(3,54): ${refused("(a: number) => any", "(value: string, index: number, array: string[]) => any")}`,
      `m3.ts(4,23): ${implicit("m")}`,
      "m3.ts(4,56): error TS2769: No overload matches this call.",
      "m3.ts(4,56): error TS2769: No overload matches this call.",
      `m3.ts(5,21): ${implicit("m")}`,
    ],
  ],
};

const h = `export declare function id<T>(x: T): T;
export declare function over(p: (v: string) => unknown): string[];
export declare function pick<T, S extends T>(xs: T[], p: (v: T) => v is S): S[];
export declare function pick<T>(xs: T[], p: (v: T) => boolean): T[];
export declare const cond: boolean, nums: number[], strs: string[];
`;

test.concurrent.each(Object.keys(projects))("%s", async name => {
  const [files, expected] = projects[name];
  using dir = tempDir("check-cycles-through-defaults", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: Object.keys(files) }),
    "h.ts": h,
    ...files,
  });
  for (const threads of [1, 2, 2, 2, 2, 8, 8, 8, 8, 64, 64]) {
    const { stdout } = await run([bunExe(), "check", "--no-pretty", `--threads=${threads}`, "-p", "."], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
    });
    expect(
      stdout
        .split("\n")
        .filter(line => line.includes("error TS"))
        .sort(),
    ).toEqual(expected);
  }
});
