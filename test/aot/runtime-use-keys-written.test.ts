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
  return new Set([...(await factsOf(text, files))].filter(fact => fact.startsWith("program-key ")).map(fact => fact.slice("program-key ".length)));
}

async function factsOf(text: string, files: Record<string, string> = {}) {
  using dir = tempDir("aot-runtime-use-keys-written", { "tsconfig.json": tsconfig, "main.ts": `declare const console: any, given: any, Proxy: any, WebAssembly: any;\n${text}`, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
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
  "Object.defineProperties with descriptors that are not seen": `console.log(Object.defineProperties({}, given));`,
  "Object.defineProperties with descriptors that are spread": `console.log(Object.defineProperties({}, { ...given }));`,
  "Object.defineProperties handed on": `console.log(Object.defineProperties);`,
  "the text of a registered symbol as the key": `console.log({ [Symbol.keyFor(given)!]: 1 });`,
  "a member that the program put on Symbol as the key": `(Symbol as any).mine = given; console.log({ [(Symbol as any).mine]: 1 });`,
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
  "a well-known symbol as the key of a method": `console.log({ [Symbol.iterator]() {} });`,
  "a constant made by Symbol.for as the key": `const custom = Symbol.for("nodejs.util.inspect.custom"); console.log({ [custom]() { return "a"; } });`,
  "Symbol.for as the key itself": `console.log({ [Symbol.for("nodejs.util.inspect.custom")]() { return "a"; } });`,
  "Symbol.for of a text that is not seen as the key of a class member": `class Holder { [Symbol.for(given)]() {} } console.log(new Holder());`,
  "Symbol as the key itself": `console.log({ [Symbol("hidden")]: 1 });`,
  "a constant made by Symbol as the key of a class member": `const hidden = Symbol("hidden"); class Holder { [hidden] = 1; } console.log(new Holder());`,
  "Object.defineProperty under a symbol": `console.log(Object.defineProperty({}, Symbol.toStringTag, { value: "a" }));`,
  "a store under a constant made by Symbol": `const hidden = Symbol("hidden"); const holder: any = {}; holder[hidden] = 1; console.log(holder);`,
  "a spread, which copies what somebody else put": `console.log({ ...given });`,
  "Object.assign, the same": `console.log(Object.assign({}, given));`,
  "Object.setPrototypeOf: what is inherited was put on the ancestor": `console.log(Object.setPrototypeOf({}, given));`,
};

describe.concurrent("what else the files of a program say about keys", () => {
  test.each([
    ["a store under a key of any type", `const holder: any = {}; holder[given] = 1; console.log(holder);`],
    ["a computed key of any type in an object literal", `console.log({ [given]: 1 });`],
    ["a computed method of a class", `class Holder { [given]() {} } console.log(Holder);`],
    ["a store under a variable that holds a symbol", `const key: symbol = given; const holder: any = {}; holder[key] = 1; console.log(holder);`],
    ["Object.defineProperty with such a key", `console.log(Object.defineProperty({}, given, { value: 1 }));`],
    ["Reflect.set with such a key", `console.log(Reflect.set({}, given, 1));`],
    ["Object.fromEntries", `console.log(Object.fromEntries(given));`],
  ])("a key that is written may be a symbol that was handed over: %s", async (_, text) => {
    expect((await factsOf(text)).has("program-symbol-key *")).toBe(true);
  });

  test.each([
    ["keys that are strings", `function fill(holder: Record<string, number>, key: string) { holder[key] = 1; return { [key]: 2, ["x" + key]: 3, [\`y\${key}\`]: 4 }; } console.log(fill({}, given));`],
    ["keys that are numbers", `const list: number[] = []; for (let i = 0; i < 3; i++) list[i] = i; console.log(list);`],
    ["a well-known symbol", `console.log({ [Symbol.iterator]() {} });`],
    ["a constant made by Symbol.for", `const custom = Symbol.for("mine"); const holder: any = {}; holder[custom] = 1; console.log(holder, { [custom]: 1 });`],
    ["JSON.parse with a reviver, whose keys are texts", `console.log(JSON.parse(given, (key, value) => value));`],
  ])("no key that is written can be such a symbol: %s", async (_, text) => {
    expect((await factsOf(text)).has("program-symbol-key *")).toBe(false);
  });

  test.each([
    ["Object.defineProperty", `console.log(Object.defineProperty({}, "wanted", { value: 1 }));`],
    ["Reflect.defineProperty", `console.log(Reflect.defineProperty({}, "wanted", { value: 1 }));`],
    ["the descriptors of Object.defineProperties", `console.log(Object.defineProperties({}, { wanted: { value: 1 } }));`],
    ["__defineGetter__", `({} as any).__defineGetter__("wanted", () => 1);`],
    ["a field of a class", `class Holder { wanted = 1; } console.log(new Holder());`],
  ])("a name that is defined on an object that exists is a property that is named: %s", async (_, text) => {
    const facts = await factsOf(text);
    expect(["program-defined-key wanted", "property wanted"].filter(fact => !facts.has(fact))).toEqual([]);
    expect(facts.has("program-defined-key *")).toBe(false);
  });

  test.each([
    ["Object.defineProperty", `console.log(Object.defineProperty({}, given, { value: 1 }));`],
    ["Object.defineProperties", `console.log(Object.defineProperties({}, given));`],
    ["Object.defineProperty taken apart", `const { defineProperty } = Object; console.log(defineProperty({}, given, { value: 1 }));`],
  ])("defined under a key that is not seen: %s", async (_, text) => {
    expect((await factsOf(text)).has("program-defined-key *")).toBe(true);
  });

  test.each([
    ["a store", `const holder: any = {}; holder[given] = 1; console.log(holder);`],
    ["a computed key of a new object", `console.log({ [given]: 1 });`],
    ["Object.fromEntries, which makes a new object", `console.log(Object.fromEntries(given));`],
    ["Object.assign, which stores", `console.log(Object.assign({}, given));`],
  ])("nothing is defined on an object that exists by %s", async (_, text) => {
    expect((await factsOf(text)).has("program-defined-key *")).toBe(false);
  });

  test("a built-in module that the program loads is told from one that only other built-in modules load", async () => {
    const facts = await factsOf(`declare const require: any; console.log(require("node:http").STATUS_CODES);`);
    expect(["module node:http", "program-module node:http", "module node:events"].filter(fact => !facts.has(fact))).toEqual([]);
    expect(facts.has("program-module node:events")).toBe(false);
  });

  test.each([
    ["Symbol.for of a text", `console.log(Symbol.for("wanted"));`, "program-symbol wanted"],
    ["Symbol.for of a text that is not seen", `console.log(Symbol.for(given));`, "program-symbol *"],
    ["Object.getOwnPropertySymbols", `console.log(Object.getOwnPropertySymbols(given));`, "program-symbol *"],
    ["a Proxy, whose traps are handed every key", `console.log(new Proxy({}, {}));`, "program-symbol *"],
  ])("the symbols a program can hold: %s", async (_, text, fact) => {
    expect((await factsOf(text)).has(fact)).toBe(true);
  });

  test("a property that is named * is one name, not every name", async () => {
    const facts = await factsOf(`const table: any = { "*": 1 }; table["*"] = 2; console.log("" + table["*"] + Symbol.for("*").description);`);
    expect(["property *", "program-key *", "program-symbol *"].filter(fact => facts.has(fact))).toEqual([]);
    expect([`property "*"`, `program-property "*"`, `program-key "*"`, `program-symbol "*"`].filter(fact => !facts.has(fact))).toEqual([]);
  });

  test("a program that names no symbol holds none, whatever the built-in modules name", async () => {
    expect([...(await factsOf(`console.log({ a: 1 });`))].filter(fact => fact.startsWith("program-symbol"))).toEqual([]);
  });
});

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
  test("the constructor of a class is no key", async () => {
    expect((await keysOf(`class Holder { constructor() {} } console.log(new Holder());`)).has("constructor")).toBe(false);
  });
  test("JSX attributes become keys", async () => {
    expect((await keysOf(`import "./page.tsx";`, { "tsconfig.json": tsconfig.replace(`"strict"`, `"jsx":"react","noImplicitAny":false,"strict"`), "page.tsx": `declare const console: any; declare namespace JSX { interface IntrinsicElements { [name: string]: any } }\nconst React = { createElement() {} }; console.log(<a wanted="1" />);` })).has("*")).toBe(true);
  });
});
