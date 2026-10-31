import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(300_000);

// A value of each class, as the test files spell it. Iterator is left out: `Iterator.prototype.constructor`, an accessor by the specification, stays
// locked in a compiled test run, and a write on it throws the TypeError that says so.
const instances: Record<string, string> = {
  URL: `new URL("http://u:p@a.example:81/p?q=1#h")`,
  URLSearchParams: `new URLSearchParams("a=1&b=2")`,
  Request: `new Request("http://a.example/r", { method: "POST", body: "x" })`,
  Response: `new Response("x", { status: 201, statusText: "made" })`,
  Headers: `new Headers({ a: "1" })`,
  Blob: `new Blob(["ab"], { type: "t/x" })`,
  File: `new File(["ab"], "f.txt", { lastModified: 5 })`,
  FormData: `new FormData()`,
  AbortController: `new AbortController()`,
  AbortSignal: `new AbortController().signal`,
  Event: `new Event("e", { cancelable: true })`,
  CustomEvent: `new CustomEvent("c", { detail: 4 })`,
  MessageEvent: `new MessageEvent("m", { data: 5, origin: "o" })`,
  ErrorEvent: `new ErrorEvent("e", { message: "m", lineno: 3 })`,
  CloseEvent: `new CloseEvent("c", { code: 7, reason: "r" })`,
  TextDecoder: `new TextDecoder("utf-8", { fatal: true })`,
  TextEncoder: `new TextEncoder()`,
  ReadableStream: `new ReadableStream()`,
  WritableStream: `new WritableStream()`,
  TransformStream: `new TransformStream()`,
  ByteLengthQueuingStrategy: `new ByteLengthQueuingStrategy({ highWaterMark: 3 })`,
  CountQueuingStrategy: `new CountQueuingStrategy({ highWaterMark: 3 })`,
  TextDecoderStream: `new TextDecoderStream()`,
  TextEncoderStream: `new TextEncoderStream()`,
  CompressionStream: `new CompressionStream("gzip")`,
  DOMException: `new DOMException("m", "AbortError")`,
  BroadcastChannel: `closed(new BroadcastChannel("n"))`,
  MessageChannel: `new MessageChannel()`,
  Map: `new Map([[1, 2]])`,
  Set: `new Set([1])`,
  RegExp: `/a/gi`,
  ArrayBuffer: `new ArrayBuffer(8)`,
  SharedArrayBuffer: `new SharedArrayBuffer(8)`,
  Uint8Array: `new Uint8Array(4)`,
  Float64Array: `new Float64Array(2)`,
  DataView: `new DataView(new ArrayBuffer(8), 2)`,
  Symbol: `Symbol("d")`,
  Error: `new Error("m")`,
  Buffer: `Buffer.from("ab")`,
  "Intl.Locale": `new Intl.Locale("en-US")`,
  "Intl.NumberFormat": `new Intl.NumberFormat("en")`,
  "Intl.DateTimeFormat": `new Intl.DateTimeFormat("en")`,
  "Intl.Collator": `new Intl.Collator("en")`,
  Performance: `performance`,
  // The first read of `crypto` puts `subtle` on Crypto.prototype and takes the name for new. Where a test has defined it
  // before, plain Bun with assertions aborts (JSObject::putDirectCustomAccessor); without them it overwrites the definition.
  ...(isASAN || isDebug ? {} : { Crypto: `crypto` }),
  Function: `function named() {}`,
};

function nameOf(prototype: object): string | undefined {
  for (const [path, holder] of [
    ["", globalThis],
    ["Intl.", Intl],
  ] as const)
    for (const name of Object.getOwnPropertyNames(holder)) {
      const value = Object.getOwnPropertyDescriptor(holder, name)?.value;
      if (typeof value === "function" && Object.getOwnPropertyDescriptor(value, "prototype")?.value === prototype)
        return path + name + ".prototype";
    }
  if (prototype === Object.getPrototypeOf(Uint8Array.prototype)) return "Object.getPrototypeOf(Uint8Array.prototype)";
}

const head = `import { test } from "bun:test";
const closed = value => { value.close(); return value; };
const show = value => (typeof value === "object" && value !== null) || typeof value === "function" ? typeof value : String(value);
const asked = ask => { try { return show(ask()); } catch (error) { return "threw " + error.name; } };
const tried = (label, write, ask, undo) => test(label, () => {
  let said = "written"; try { write(); } catch (error) { said = error.name; }
  const during = asked(ask);
  try { undo(); } catch (error) { said += " undo " + error.name; }
  console.log("SEEN " + label + " | " + [said, during, asked(ask)].join(" | ").replace(/\\d{13}\\.\\d+/g, "<time>"));
});
`;

// One test file for a class and a way to write. Under --isolate each has a realm of its own, in which NOTHING READS THE MEMBER BEFORE THE WRITE:
// what a write leaves behind showed only there.
function writeTestFiles(): Record<string, string> {
  const files: Record<string, string> = { "tsconfig.json": "{}" };
  const closed = (value: { close(): void }) => (value.close(), value);
  for (const [name, text] of Object.entries(instances)) {
    const lines: Record<string, string[]> = { store: [], define: [], delete: [] };
    const instance = new Function("closed", "return " + text)(closed);
    for (let at = Object.getPrototypeOf(instance); at && at !== Object.prototype; at = Object.getPrototypeOf(at)) {
      const holder = nameOf(at);
      if (!holder) continue;
      for (const key of Object.getOwnPropertyNames(at)) {
        if (!Object.getOwnPropertyDescriptor(at, key)!.get || !/^[A-Za-z_$][\w$]*$/.test(key) || key === "__proto__")
          continue;
        const [label, quoted] = [`${name} ${holder}.${key}`, JSON.stringify(key)];
        const [ask, real] = [`() => (${text}).${key}`, `Object.getOwnPropertyDescriptor(${holder}, ${quoted})`];
        const back = `() => { Object.defineProperty(${holder}, ${quoted}, real); }`;
        lines.store.push(
          `tried(${JSON.stringify(label + " store")}, () => { ${holder}.${key} = 1; }, ${ask}, () => {});`,
        );
        lines.define.push(
          `{ const real = ${real}; tried(${JSON.stringify(label + " define")}, () => { Object.defineProperty(${holder}, ${quoted}, { get() { return "replaced"; }, configurable: true }); }, ${ask}, ${back}); }`,
        );
        lines.delete.push(
          `{ const real = ${real}; tried(${JSON.stringify(label + " delete")}, () => { delete ${holder}.${key}; }, ${ask}, ${back}); }`,
        );
      }
    }
    for (const [way, written] of Object.entries(lines))
      if (written.length) files[`${name.replace(".", "-")}-${way}.test.js`] = head + written.join("\n") + "\n";
  }
  return files;
}

test("a store, a definition and a deletion on every accessor of the built-in classes, then a read on an instance", async () => {
  using dir = tempDir("tests-write-on-accessors", writeTestFiles());
  const seen = (text: string) =>
    text
      .split("\n")
      .filter(line => line.startsWith("SEEN "))
      .sort();
  const plain = await run([bunExe(), "test", "--isolate"], String(dir), bunEnv);
  expect(seen(plain.stdout).length).toBeGreaterThan(500);
  const compiled = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), bunEnv);
  expect({ lines: seen(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
    lines: seen(plain.stdout),
    exitCode: 0,
  });
});
