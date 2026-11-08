// One line that prints something in a tick of process.nextTick(), and nothing else. The queue of ticks is Bun's own JavaScript, and so is much of the printer: a small program holds neither unless the build
// sees that the one calls what needs the other.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const lines: Record<string, string> = {
  nothing: `process.nextTick(() => {})`,
  "a-url": `process.nextTick(() => console.log(new URL("http://made.up/x")))`,
  "the-message-of-a-cause": `process.nextTick(() => console.log(new Error("x", { cause: new Error("y") }).cause.message))`,
  "an-error-with-a-cause": `process.nextTick(() => console.log(new Error("x", { cause: new Error("y") })))`,
  "a-function-of-process": `process.nextTick(() => console.log(typeof process.hrtime, process.nextTick))`,
  "a-buffer": `process.nextTick(() => console.log(Buffer.from("a")))`,
  "a-map-and-a-set": `process.nextTick(() => console.log(new Map([[1, { a: 1 }]]), new Set([1])))`,
  "a-proxy": `process.nextTick(() => console.log(new Proxy({ a: 1 }, {})))`,
  "deep-objects": `process.nextTick(() => console.log({ a: { b: { c: { d: 1 } } } }, [1, [2, [3, [4]]]]))`,
  "an-instance-with-a-getter": `process.nextTick(() => console.log(new (class Point { x = 1; get y() { return 2; } })()))`,
  "its-own-method": `process.nextTick(() => console.log({ [Symbol.for("nodejs.util.inspect.custom")]() { return "mine"; } }))`,
  "its-own-method-under-a-made-name": `process.nextTick(() => console.log({ [Symbol.for(JSON.parse('"nodejs.util.inspect.custom"'))]() { return "mine"; } }))`,
  "a-throw": `process.nextTick(() => { throw new TypeError("made up"); })`,
  "a-throw-that-a-listener-catches": `process.on("uncaughtException", e => console.log("caught", e.message)); process.nextTick(() => { throw new TypeError("made up"); })`,
  "a-throw-with-a-url-on-it": `process.nextTick(() => { throw Object.assign(new Error("x"), { extra: new URL("http://made.up/") }); })`,
  views: `process.nextTick(() => console.log(new Uint8Array(3), new ArrayBuffer(2), new DataView(new ArrayBuffer(1))))`,
  "primitives-and-functions": `process.nextTick(() => console.log(new Date(0), /a+/g, Symbol("s"), 1n, () => {}, class A {}))`,
  headers: `process.nextTick(() => console.log(new Headers({ a: "b" })))`,
  parameters: `process.nextTick(() => console.log(new URLSearchParams("a=b")))`,
  "status-and-method": `process.nextTick(() => console.log(new Response("x").status, new Request("http://made.up/").method))`,
  "a-blob": `process.nextTick(() => console.log(new Blob(["a"])))`,
  "a-signal": `process.nextTick(() => console.log(new AbortController().signal))`,
  "a-target": `process.nextTick(() => console.log(new EventTarget()))`,
  "a-decoder": `process.nextTick(() => console.log(new TextDecoder()))`,
  "a-native-function": `process.nextTick(() => console.log(process.memoryUsage))`,
  "a-format": `process.nextTick(() => console.log("%o", { a: 1 }))`,
  "a-table": `process.nextTick(() => console.table([{ a: 1 }]))`,
  "dir-with-a-depth": `process.nextTick(() => console.dir({ a: { b: { c: {} } } }, { depth: 0 }))`,
  "bun-inspect": `process.nextTick(() => console.log(Bun.inspect({ a: new URL("http://made.up/") })))`,
  parsed: `process.nextTick(() => console.log(JSON.parse(process.argv[2] ?? '{"a":[1,{"b":2}]}')))`,
  versions: `process.nextTick(() => console.log(process.versions))`,
  navigator: `process.nextTick(() => console.log(globalThis.navigator))`,
  "weak-collections": `process.nextTick(() => console.log(new WeakMap(), new WeakSet(), new WeakRef({})))`,
  "a-promise": `process.nextTick(() => console.log(Promise.resolve(1)))`,
  iterators: `process.nextTick(() => console.log((function* () {})(), [][Symbol.iterator]()))`,
  "console-log-itself-is-the-tick": `process.nextTick(console.log, { a: 1 }, new URL("http://made.up/"))`,
};
const endsByTheThrow = ["a-throw", "a-throw-with-a-url-on-it"];

export default function write(folder: string) {
  // Below an error plain Bun prints the lines of the file around the place, and frames with other paths.
  for (const [name, line] of Object.entries(lines))
    writeFileSync(
      join(folder, `${name}.mjs`),
      `// Mask: ^ *(?:at |[0-9]+ \\||\\^).*\\n\n${endsByTheThrow.includes(name) ? "// Exit code: 1\n" : ""}${line}\n`,
    );
}
