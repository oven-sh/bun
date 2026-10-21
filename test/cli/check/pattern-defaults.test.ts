// A default in a binding pattern can read another variable of the pattern: `const { width, height = width } = size`.
// While TypeScript computes the type that the pattern implies for its initializer, such a read has the type `any` that
// takes part in no inference, and it is no cycle. The variable can share its name with a type.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren } from "../children";
import { inBatches, linesOf, tsc } from "./differential";

afterAll(endChildren);

// `lib: ["es5"]`: three library files in place of eighty, which a debug build takes long to read.
const options = { strict: true, noEmit: true, lib: ["es5"], types: [], skipLibCheck: true };
const tsconfig = JSON.stringify({ compilerOptions: options });

const notAssignable = (from: string, to: string) => `error TS2322: Type '${from}' is not assignable to type '${to}'.`;

// `errors`: what TypeScript 7.0.2 prints for the files. The last lines of each program assign the variables to a type
// that they do not have, so a variable that became `any` shows.
const programs: Record<string, { files: Record<string, string>; errors: string[] }> = {
  "an interface, a type alias and a generic call, in a module": {
    files: {
      "m.ts": `declare function useState<S>(initial: S): [S, S?];
interface width { px: number }
type Theme = "light" | "dark";
interface first { x: number }
const { width, height = width } = { width: 2 };
const [Theme, other = Theme] = ["light"];
const [first, second = first] = useState(0);
const a: string = height;
const b: number = other;
const c: string = second;
export {};
`,
    },
    errors: [
      `m.ts(8,7): ${notAssignable("number", "string")}`,
      `m.ts(9,7): ${notAssignable("string", "number")}`,
      `m.ts(10,7): ${notAssignable("number", "string")}`,
    ],
  },
  "a nested pattern, a function and a namespace": {
    files: {
      "m.ts": `interface a { x: number }
const { p: [a, b = a] } = { p: [1] };
const s: string = b;
function f() {
  interface c { x: number }
  var [c, d = c] = [1];
  let [e, g = e] = [c];
  const t: string = d;
  const u: string = g;
}
namespace N {
  export interface h { x: number }
  export const [h, i = h] = [2];
  const v: string = i;
}
export {};
`,
    },
    errors: [
      `m.ts(3,7): ${notAssignable("number", "string")}`,
      `m.ts(8,9): ${notAssignable("number", "string")}`,
      `m.ts(9,9): ${notAssignable("number", "string")}`,
      `m.ts(14,9): ${notAssignable("number", "string")}`,
    ],
  },
  "an exported interface, and an interface beside a class": {
    files: {
      "m.ts": `export interface a { x: number }
export const [a, b = a] = [2];
const s: string = b;
interface C { x: number }
const { C, D = C } = { C: class { y = 1 } };
const t: string = D;
`,
    },
    errors: [`m.ts(3,7): ${notAssignable("number", "string")}`, `m.ts(6,7): ${notAssignable("typeof C", "string")}`],
  },
  // The symbol of the variable is the one of the interface, in the earlier file.
  "an interface of an earlier script": {
    files: {
      "a0.d.ts": `interface a { x: number }\n`,
      "b.ts": `interface a { y: number }\nconst [a, b = a + 1] = [2];\nconst wrong: string = b;\n`,
    },
    errors: [`b.ts(3,7): ${notAssignable("number", "string")}`],
  },
  "no type of that name": {
    files: {
      "m.ts": `const { width, height = width } = { width: 2 };
const [first, second = first + 1] = [1];
const a: string = height;
const b: string = second;
export {};
`,
    },
    errors: [`m.ts(3,7): ${notAssignable("number", "string")}`, `m.ts(4,7): ${notAssignable("number", "string")}`],
  },
  // The read is in another file, so it is not inside the pattern: this one is a cycle.
  "a default that calls a function of another script, which reads the variable": {
    files: {
      "a.ts": `const { kind, payload = helper() } = { kind: 1 };\nconst n: string = payload;\n`,
      "b.ts": `function helper() { return kind; }\n`,
    },
    errors: [
      "a.ts(1,9): error TS7022: 'kind' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.",
      "b.ts(1,10): error TS7023: 'helper' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.",
    ],
  },
};

describe("a default in a binding pattern that reads another variable of the pattern", () => {
  // One program at a time: a debug build is slow to start, and slower beside others.
  test.each(Object.keys(programs))("%s", async name => {
    const { files, errors } = programs[name];
    using dir = tempDir("bun-check-pattern-defaults", { "tsconfig.json": tsconfig, ...files });
    const root = String(dir);
    // One thread checks the files in the order of the program.
    const [ours, onOneThread] = await Promise.all([
      linesOf([bunExe(), "check"], root, root),
      linesOf([bunExe(), "check", "--threads", "1"], root, root),
    ]);
    expect({ ours, onOneThread }).toEqual({ ours: errors, onOneThread: errors });
  });

  test.skipIf(!tsc)("TypeScript prints what is expected here", async () => {
    const different: Record<string, string[]> = {};
    await inBatches(Object.entries(programs), async ([name, { files, errors }]) => {
      using dir = tempDir("bun-check-pattern-defaults", { "tsconfig.json": tsconfig, ...files });
      const theirs = await linesOf([tsc!, "--pretty", "false", "--singleThreaded"], String(dir), String(dir));
      if (!Bun.deepEquals(theirs, errors)) different[name] = theirs;
    });
    expect(different).toEqual({});
  });
});
