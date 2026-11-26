// The object literals of a list get each other's properties, as optional ones of type `undefined`. Such a property is an accessor if it's one in the literal that has it,
// and then the setter's parameter says what can be assigned. The checker made it a property that `undefined` can be assigned to, and TS2322 was lost. TS9009 was lost as well:
// with `exactOptionalPropertyTypes` the accessor has no type that can be read, so a declaration file has the getter and the setter.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const unassignable = (source: string, target: string) =>
  `error TS2322: Type '${source}' is not assignable to type '${target}'.`;
const isolated = { declaration: true, isolatedDeclarations: true, exactOptionalPropertyTypes: true };

// Each program, its options, and the errors that TypeScript reports.
const programs: Record<string, [source: string, options: object, errors: string[]]> = {
  "a getter and a setter": [
    `let v = [{ get g(): number { return 1; }, set g(x: number) { } }, { a: 1 }];
v[0].g = undefined;
v[0].g = 1;
export {};
`,
    {},
    [`(2,1): ${unassignable("undefined", "number")}`],
  ],
  "a setter that takes more": [
    `let v = [{ get g(): number { return 1; }, set g(x: number | string) { } }, { a: 1 }];
v[0].g = undefined;
v[0].g = "s";
v[0].g = true;
export {};
`,
    {},
    [`(2,1): ${unassignable("undefined", "string | number")}`, `(4,1): ${unassignable("boolean", "string | number")}`],
  ],
  "a setter": [
    `let v = [{ set g(x: number) { } }, { a: 1 }];
v[0].g = undefined;
export {};
`,
    {},
    [`(2,1): ${unassignable("undefined", "number")}`],
  ],
  "a conditional expression": [
    `declare const c: boolean;
let v = c ? { get g(): number { return 1; }, set g(x: number | string) { } } : { a: 1 };
v.g = undefined;
export const q: never = v;
`,
    {},
    [
      `(3,1): ${unassignable("undefined", "string | number")}`,
      `(4,14): ${unassignable("{ get g(): number; set g(x: string | number); a?: undefined; } | { get g(): number; set g(x: string | number); a: number; }", "never")}`,
    ],
  ],
  "a method": [
    `let v = [{ m() { return 1; } }, { a: 1 }];
v[0].m = undefined;
export {};
`,
    {},
    [],
  ],
  "a declaration file": [
    `let v = [{ get g() { return 1; }, set g(v) { } }, { a: 1 }];
export const w = v[0];
`,
    isolated,
    [
      "(1,41): error TS9009: At least one accessor must have an explicit type annotation with --isolatedDeclarations.",
      "(2,14): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.",
    ],
  ],
};

test.concurrent.each(Object.keys(programs))("%s", async name => {
  const [source, options, errors] = programs[name];
  const compilerOptions = {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    lib: ["esnext"],
    types: [],
    ...options,
  };
  using dir = tempDir("check-accessors-of-siblings", {
    "tsconfig.json": JSON.stringify({ compilerOptions, files: ["a.ts"] }),
    "a.ts": source,
  });
  const { stdout, exitCode } = await run([bunExe(), "check", "--no-pretty", "-p", "."], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  expect(stdout.split("\n").filter(line => line.includes("error TS"))).toEqual(errors.map(it => `a.ts${it}`));
  expect(exitCode).toBe(errors.length ? 1 : 0);
});
