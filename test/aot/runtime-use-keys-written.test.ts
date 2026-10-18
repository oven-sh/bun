// What the files of a program say about keys, for the voucher of util.inspect: `program-defined-key`: a property defined on an object
// that exists; `program-symbol`: a symbol the program can hold; `program-module`: a built-in module that the program itself loads.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

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

describe.concurrent("what else the files of a program say about keys", () => {
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
    ["Object.fromEntries and JSON.parse taken apart", `const { fromEntries } = Object; const { parse } = JSON; console.log(fromEntries(given), parse(given, (key, value) => value));`],
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
    ["the constructor of a well-known symbol taken apart", `const { for: make } = Symbol.iterator.constructor as any; console.log(make);`, "program-symbol *"],
    ["the registry asked of what is not named Symbol", `console.log(given.for("wanted"));`, "program-symbol *"],
    ["the registry's function taken out of what is not named Symbol", `const { for: make } = given; console.log(make);`, "program-symbol *"],
    ["the registry's function under a written key", `console.log(given["for"]);`, "program-symbol *"],
    ["the registry's function by Reflect.get", `console.log(Reflect.get(given, "for"));`, "program-symbol *"],
  ])("the symbols a program can hold: %s", async (_, text, fact) => {
    expect((await factsOf(text)).has(fact)).toBe(true);
  });

  test("a property that is named * is one name, not every name", async () => {
    const facts = await factsOf(`const table: any = { "*": 1 }; table["*"] = 2; console.log("" + table["*"] + Symbol.for("*").description);`);
    expect(["property *", "program-symbol *"].filter(fact => facts.has(fact))).toEqual([]);
    expect([`property "*"`, `program-property "*"`, `program-symbol "*"`].filter(fact => !facts.has(fact))).toEqual([]);
  });

  test.each([
    ["a key that is not seen, read from a value of any type", `console.log(given[given]);`],
    ["the constructor of a value of any type", `console.log(given.constructor);`],
    ["the constructor of a string", `console.log("a".constructor);`],
    ["the constructor of a symbol, of which nothing is asked", `console.log(Symbol("a").constructor);`],
    ["the constructor of a symbol under a written key", `const held: symbol = Symbol("a"); console.log((held as any)["constructor"]);`],
  ])("to hold a constructor is not to hold a symbol: %s", async (_, text) => {
    expect((await factsOf(text)).has("program-symbol *")).toBe(false);
  });

  test("a program that names no symbol holds none, whatever the built-in modules name", async () => {
    expect([...(await factsOf(`console.log({ a: 1 });`))].filter(fact => fact.startsWith("program-symbol"))).toEqual([]);
  });
});
