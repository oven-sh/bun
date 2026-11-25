// A `this` parameter without an annotation gets its type when its function expression is first checked in its context, and keeps it. There the type argument of the
// enclosing call has no candidate yet, so the function has no contextual signature, and `this` is what the object literal around it is expected to be. Later the type
// argument is the function's own type: a type computed then would be found in the function's own signature, which asks for it again.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

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

const inferredFromTheFunction = `declare function get<V>(collection: { [key: string]: V }): V;
get({ f: function (this) { return this.f; } });
declare function at<V>(collection: { [key: string]: V }, key: string): V | undefined;
at({ x: "xx", get: function (this, key: string) { return this[key]; } }, "x");
export {};
`;

// What tsc 6.0.2 says.
const types = `declare function get<V>(collection: { [key: string]: V }): V;
const a = get({ f: function (this) { return this.f; } });
const a2: number = a;
const b = get({ f: function (this) { const t: number = this; return 1; } });
const b2: number = b;
const c = get({ f: function (this) { return this.g.h; } });
const c2: number = c;
const d = get({ x: "xx", get: function (this, key: string) { return this[key]; } });
const d2: number = d;
declare function both<V>(collection: { [key: string]: V }, use: (value: V) => void): V;
const e = both({ f: function (this) { return this.f; } }, value => { const n: number = value; });
const g = get({ f: function (this) { return this; } });
const g2: number = g;
export {};
`;

const withoutContext = `declare function list<V>(items: V[]): V;
declare function wrap<V>(make: () => V): V;
declare function take(anything: any): void;
list([function (this) { return this; }]);
wrap(() => function (this) { return this; });
const alone = function (this) { return this; };
function declared(this) { return this; }
take({ f: function (this) { return this; } });
export {};
`;

async function check(source: string) {
  using dir = tempDir("check-this-parameter-without-an-annotation", { "tsconfig.json": tsconfig, "a.ts": source });
  const { stdout, stderr, exitCode } = await run([bunExe(), "check"], String(dir), bunEnv);
  const errors = (stdout + stderr).split("\n").filter(line => /error TS|^error:/.test(line));
  return { errors, exitCode };
}

test("a function that its own type argument is inferred from", async () => {
  expect(await check(inferredFromTheFunction)).toEqual({ errors: [], exitCode: 0 });
});

test("`this` is what the object literal is expected to be", async () => {
  expect(await check(types)).toEqual({
    errors: [
      "a.ts(3,7): error TS2322: Type '(this: { [key: string]: V; }) => V' is not assignable to type 'number'.",
      "a.ts(4,44): error TS2322: Type '{ [key: string]: V; }' is not assignable to type 'number'.",
      "a.ts(5,20): error TS2322: Type '(this: { [key: string]: V; }) => 1' is not assignable to type 'number'.",
      "a.ts(6,52): error TS2339: Property 'h' does not exist on type 'V'.",
      "a.ts(7,7): error TS2322: Type '(this: { [key: string]: V; }) => any' is not assignable to type 'number'.",
      "a.ts(9,7): error TS2322: Type 'string | ((this: { [key: string]: V; }, key: string) => V)' is not assignable to type 'number'.",
      "a.ts(11,76): error TS2322: Type '(this: { [key: string]: V; }) => V' is not assignable to type 'number'.",
      "a.ts(13,7): error TS2322: Type '(this: { [key: string]: V; }) => { [key: string]: V; }' is not assignable to type 'number'.",
    ],
    exitCode: 1,
  });
});

test("nothing says what `this` is", async () => {
  expect(await check(withoutContext)).toEqual({
    errors: [
      "a.ts(4,17): error TS7006: Parameter 'this' implicitly has an 'any' type.",
      "a.ts(5,22): error TS7006: Parameter 'this' implicitly has an 'any' type.",
      "a.ts(6,25): error TS7006: Parameter 'this' implicitly has an 'any' type.",
      "a.ts(7,19): error TS7006: Parameter 'this' implicitly has an 'any' type.",
    ],
    exitCode: 1,
  });
});
