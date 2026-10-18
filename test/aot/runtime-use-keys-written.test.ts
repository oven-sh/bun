// `program-key <name>`: every way in which a file of the program can put a property of that name on an object. `program-key *`: it
// puts one there under a name that the compiler does not see. The built-in modules whose tables hang on a field with a public name
// (an emitter's `_events`) are vouched for only where the program writes no such key.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

async function keysOf(text: string, files: Record<string, string> = {}) {
  using dir = tempDir("aot-runtime-use-keys-written", { "tsconfig.json": tsconfig, "main.ts": `declare const console: any, given: any, Proxy: any, WebAssembly: any;\n${text}`, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: program-key ";
  expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  return new Set(stderr.split("\n").filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length)));
}

const named: Record<string, string> = {
  "the key of an object literal": `console.log({ wanted: 1 });`,
  "a shorthand": `const wanted = 1; console.log({ wanted });`,
  "a method of an object literal": `console.log({ wanted() {} });`,
  "a getter of an object literal": `console.log({ get wanted() { return 1; } });`,
  "a string as the key": `console.log({ "wanted": 1 });`,
  "a computed key that folds": `const key = "wanted"; console.log({ [key]: 1 });`,
  "a class field": `class Holder { wanted = 1; } console.log(new Holder());`,
  "a parameter that is a property": `class Holder { constructor(public wanted: number) {} } console.log(new Holder(1));`,
  "a static method": `class Holder { static wanted() {} } console.log(Holder);`,
  "an accessor of a class": `class Holder { set wanted(value: number) {} } console.log(new Holder());`,
  "Object.defineProperty": `console.log(Object.defineProperty({}, "wanted", { value: 1 }));`,
  "Reflect.set": `console.log(Reflect.set({}, "wanted", 1));`,
  "__defineGetter__": `({} as any).__defineGetter__("wanted", () => 1);`,
  "the descriptors of Object.defineProperties": `console.log(Object.defineProperties({}, { wanted: { value: 1 } }));`,
  "an export, which is a key of the namespace object": `export function wanted() {}`,
  "an export under another name": `function local() {} export { local as wanted };`,
  "a member of an enum": `enum Kind { wanted } console.log(Kind);`,
};
const unseen: Record<string, string> = {
  "a computed key in an object literal": `console.log({ [given]: 1 });`,
  "a computed member of a class": `class Holder { [given]() {} } console.log(Holder);`,
  "a store under a key that may be a string": `const holder: any = {}; holder[given] = 1; console.log(holder);`,
  "Object.defineProperty with such a key": `console.log(Object.defineProperty({}, given, { value: 1 }));`,
  "Object.defineProperty handed on": `console.log(Object.defineProperty);`,
  "Object.defineProperty with spread arguments": `console.log((Object.defineProperty as any)(...given));`,
  "Reflect.set with such a key": `console.log(Reflect.set({}, given, 1));`,
  "Reflect.set taken apart": `const { set } = Reflect; console.log(set({}, given, 1));`,
  "Reflect.set called through call": `console.log(Reflect.set.call(undefined, {}, given, 1));`,
  "Object.fromEntries": `console.log(Object.fromEntries(given));`,
  "JSON.parse with a reviver": `console.log(JSON.parse(given, (key, value) => value));`,
  "JSON.parse handed on": `console.log(given.map(JSON.parse));`,
  "a Proxy": `console.log(new Proxy({}, {}));`,
  "WebAssembly": `console.log(WebAssembly.instantiate(given));`,
  "a namespace of TypeScript": `namespace Space { export function inner() {} } console.log(Space);`,
  "a read under a key that is not seen": `console.log(given[given]);`,
  "Reflect.get under a key that is not seen": `console.log(Reflect.get(given, given));`,
  "Object.getOwnPropertyDescriptor under a key that is not seen": `console.log(Object.getOwnPropertyDescriptor(given, given));`,
};
const seen: Record<string, string> = {
  "nothing": `console.log("hello");`,
  "a store under a number": `const list: number[] = []; for (let i = 0; i < 3; i++) list[i] = i; console.log(list);`,
  "JSON.parse of one argument": `console.log(JSON.parse(given));`,
  "Map.prototype.set": `console.log(new Map().set(given, 1));`,
  "a spread, which copies what somebody else put": `console.log({ ...given });`,
  "Object.assign, the same": `console.log(Object.assign({}, given));`,
  "Object.setPrototypeOf: what is inherited was put on the ancestor": `console.log(Object.setPrototypeOf({}, given));`,
};

describe.concurrent("the keys a program writes", () => {
  for (const [how, text] of Object.entries(named)) {
    test(`named by ${how}`, async () => {
      const keys = await keysOf(text);
      expect({ wanted: keys.has("wanted"), any: keys.has("*") }).toEqual({ wanted: true, any: false });
    });
  }
  for (const [how, text] of Object.entries(unseen)) {
    test(`not seen: ${how}`, async () => {
      expect((await keysOf(text)).has("*")).toBe(true);
    });
  }
  for (const [how, text] of Object.entries(seen)) {
    test(`no key that is not seen: ${how}`, async () => {
      expect((await keysOf(text)).has("*")).toBe(false);
    });
  }
  test("JSX attributes become keys", async () => {
    expect((await keysOf(`import "./page.tsx";`, { "page.tsx": `declare const console: any; declare namespace JSX { interface IntrinsicElements { [name: string]: any } }\nconst React = { createElement() {} }; console.log(<a wanted="1" />);` })).has("*")).toBe(true);
  });
});
