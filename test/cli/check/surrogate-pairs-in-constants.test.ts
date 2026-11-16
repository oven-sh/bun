import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
});

// The two halves of a surrogate pair are one character where strings meet in a program. The types of TypeScript 7 keep
// them apart where a constant is evaluated, and join them in a literal and in a template literal type. TypeScript 6
// joins them everywhere. The errors are those of TypeScript 7.0.2.
const programs: Record<string, { source: string; errors: string[] }> = {
  "argument of a template type": {
    source: String.raw`declare function f<X extends string>(x: ${"`${X}`"}): X;
export const a: 0 = f(${'`${"\\ud83d" + "\\ude00"}`'});
export const b: 0 = f("\ud83d\ude00");
`,
    errors: [
      `a.ts(2,14): error TS2322: Type '"😀"' is not assignable to type '0'.`,
      `a.ts(2,23): error TS2345: Argument of type '"\\uD83D\\uDE00"' is not assignable to parameter of type '"😀"'.`,
      `a.ts(3,14): error TS2322: Type '"😀"' is not assignable to type '0'.`,
    ],
  },
  "template": {
    source: String.raw`const h = "\ud83d", l = "\ude00";
export const a: never = ${"`${h}${l}`"};
export const b: never = ${"`\\ud83d${l}`"};
export const c: never = ${"`${h}\\ude00`"};
export const d: never = ${"`${h + l}`"};
export const e: never = ${"`${l}${h}`"};
export const f: never = ${"`\\ud83d\\ude00`"};
export const g: never = ${"`${h}${l}`"} as const;
export const i: "\u{1F600}" = ${"`${h}${l}`"};
`,
    errors: [
      `a.ts(2,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(3,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(4,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(5,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(6,14): error TS2322: Type '"\\uDE00\\uD83D"' is not assignable to type 'never'.`,
      `a.ts(7,14): error TS2322: Type '"😀"' is not assignable to type 'never'.`,
      `a.ts(8,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(9,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type '"😀"'.`,
    ],
  },
  "enum member": {
    source: String.raw`const h = "\ud83d", l = "\ude00";
enum E { A = "\ud83d" + "\ude00", B = ${"`${h}\\ude00`"}, C = "\u{1F600}" }
export const a: never = ${"`${E.A}`"};
export const b: E.C = E.A;
export const c: boolean = E.A === (null! as E.C);
`,
    errors: [
      `a.ts(3,14): error TS2322: Type '"\\uD83D\\uDE00"' is not assignable to type 'never'.`,
      `a.ts(4,14): error TS2322: Type 'E.A' is not assignable to type 'E.C'.`,
      `a.ts(5,27): error TS2367: This comparison appears to be unintentional because the types 'E.A' and 'E.C' have no overlap.`,
    ],
  },
  "property name": {
    source: String.raw`const h = "\ud83d", l = "\ude00", j = ${"`${h}${l}`"};
const o = { [j]: 1, "\u{1F600}": "two" };
export const a: never = o["\u{1F600}"];
export const b: never = o[j];
export const c: Record<"\u{1F600}", number> = { [j]: 1 };
`,
    errors: [
      `a.ts(3,14): error TS2322: Type 'string' is not assignable to type 'never'.`,
      `a.ts(4,14): error TS2322: Type 'number' is not assignable to type 'never'.`,
      `a.ts(5,49): error TS2353: Object literal may only specify known properties, and '[j]' does not exist in type 'Record<"😀", number>'.`,
    ],
  },
  "comparison": {
    source: String.raw`const h = "\ud83d", l = "\ude00", whole = "\u{1F600}", joined = ${"`${h}${l}`"};
export const a = joined === whole, b = h + l === whole;
switch (joined) { case whole: break; }
`,
    errors: [
      `a.ts(2,18): error TS2367: This comparison appears to be unintentional because the types '"\\uD83D\\uDE00"' and '"😀"' have no overlap.`,
      `a.ts(3,24): error TS2678: Type '"😀"' is not comparable to type '"\\uD83D\\uDE00"'.`,
    ],
  },
  "template literal type": {
    source: String.raw`const j = ${'`${"\\ud83d"}${"\\ude00"}`'};
type A = ${'`${"\\ud83d"}${"\\ude00"}`'};
export const a: never = null! as A;
export const b: A = "\u{1F600}";
export const c: never = null! as ${"`${typeof j}`"};
`,
    errors: [
      `a.ts(3,14): error TS2322: Type '"😀"' is not assignable to type 'never'.`,
      `a.ts(5,14): error TS2322: Type '"😀"' is not assignable to type 'never'.`,
    ],
  },
};

describe.concurrent("halves of a surrogate pair that meet", () => {
  for (const [name, { source, errors }] of Object.entries(programs)) {
    test(name, async () => {
      using dir = tempDir("check-surrogate-pairs", { "tsconfig.json": tsconfig, "a.ts": source });
      await using proc = spawn({
        cmd: [bunExe(), "check"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        timeout: longLimit,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout.split("\n").filter(line => line.includes("error TS"))).toEqual(errors);
      expect(exitCode).toBe(1);
    });
  }
});
