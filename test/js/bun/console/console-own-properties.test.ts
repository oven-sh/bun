import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("console.write, console[Symbol.asyncIterator] and Module.prototype.require are plain data properties", async () => {
  using dir = tempDir("console-own-properties", {
    "main.js": `
const show = d => d && JSON.stringify({ ...d, value: typeof d.value, name: d.value?.name, length: d.value?.length });
console.log(Reflect.ownKeys(console).map(String).join(" "));
console.log(show(Object.getOwnPropertyDescriptor(console, "write")));
console.log(show(Object.getOwnPropertyDescriptor(console, Symbol.asyncIterator)));
console.log(console.write === console.write, Object.create(console).write === console.write, console[Symbol.asyncIterator] === console[Symbol.asyncIterator]);
const original = console.write;
console.write = 1;
console.log(console.write, show(Object.getOwnPropertyDescriptor(console, "write")));
console.write = original;
console.log(delete console.write, "write" in console, Reflect.ownKeys(console).includes("write"));
console.write = original;
console.write("written\\n");
const Module = require("node:module");
const first = Module.prototype.require;
console.log(typeof first, first.name, first.length, first === Module.prototype.require);
Module.prototype.require = function (id) { console.log("asked for", id); return first.call(this, id); };
console.log(require("node:path").sep === require("path").sep);
Module.prototype.require = first;
console.log(typeof require("node:os").EOL);
`,
    "untouched.js": `
console.write = text => console.log("replaced before the first read:", text);
console.write("x");
console.log(delete console[Symbol.asyncIterator], Symbol.asyncIterator in console);
`,
  });
  async function run(file: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), file], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.split("\n"), stderr, exitCode };
  }
  expect(await run("main.js")).toEqual({
    stdout: [
      "debug error log info warn clear dir dirxml table trace assert count countReset profile profileEnd time timeLog timeEnd timeStamp takeHeapSnapshot group groupCollapsed groupEnd record recordEnd screenshot write Console _stdout _stderr Symbol(Symbol.toStringTag) Symbol(Symbol.asyncIterator)",
      `{"value":"function","writable":true,"enumerable":true,"configurable":true,"name":"","length":1}`,
      `{"value":"function","writable":true,"enumerable":true,"configurable":true,"name":"[Symbol.asyncIterator]","length":0}`,
      "true true true",
      `1 {"value":"number","writable":true,"enumerable":true,"configurable":true}`,
      "true false false",
      "written",
      "function require 2 true",
      "asked for node:path",
      "asked for path",
      "true",
      "string",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
  expect(await run("untouched.js")).toEqual({ stdout: ["replaced before the first read: x", "true false", ""], stderr: "", exitCode: 0 });
});
