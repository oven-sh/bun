import { expect, test } from "bun:test";

// What a program can see of the modules of Node.js that are written in JavaScript: own names, attributes, kinds of
// function, lengths, what lies above each object, the own keys of a few instances, and which constructors can be
// applied without `new`. No getter is run. A change here is a change of behavior: compare it with Node.js before
// updating the snapshot.
const modules = [
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "_stream_duplex",
  "_stream_passthrough",
  "_stream_readable",
  "_stream_transform",
  "_stream_writable",
  "async_hooks",
  "child_process",
  "dgram",
  "diagnostics_channel",
  "events",
  "http",
  "https",
  "net",
  "path",
  "querystring",
  "readline",
  "stream",
  "stream/promises",
  "string_decoder",
  "timers",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
];

function kindOf(fn: Function) {
  const text = Function.prototype.toString.call(fn);
  if (text.startsWith("class")) return "class";
  if (text.includes("[native code]")) return "native";
  return text.startsWith("async") ? "async" : "function";
}

function attributesOf(descriptor: PropertyDescriptor) {
  const last = "writable" in descriptor ? (descriptor.writable ? "w" : "-") : "a";
  return (descriptor.configurable ? "c" : "-") + (descriptor.enumerable ? "e" : "-") + last;
}

test("the visible surface of the modules of Node.js", () => {
  const lines: string[] = [];
  const seen = new Map<object, string>();
  const describe = (value: unknown, path: string, depth: number) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
    const known = seen.get(value);
    if (known !== undefined) return void lines.push(`${path} = ${known}`);
    seen.set(value, path);
    const above = Object.getPrototypeOf(value);
    const shape =
      typeof value === "function" ? ` ${kindOf(value)} name=${JSON.stringify(value.name)} length=${value.length}` : "";
    const aboveName = above === null ? "null" : (seen.get(above) ?? above.constructor?.name ?? "?");
    lines.push(`${path}: ${typeof value}${shape} above=${aboveName} extensible=${Object.isExtensible(value)}`);
    if (depth === 0) return;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      const name = `${path}[${String(key)}]`;
      if (!("value" in descriptor)) {
        lines.push(
          `${name} ${attributesOf(descriptor)} accessor get=${typeof descriptor.get} set=${typeof descriptor.set}`,
        );
        continue;
      }
      const held = descriptor.value;
      lines.push(`${name} ${attributesOf(descriptor)} ${typeof held}`);
      const isPlain = typeof held === "object" && held !== null && !ArrayBuffer.isView(held) && !Array.isArray(held);
      if (typeof held === "function" || isPlain) describe(held, name, depth - 1);
    }
  };
  // node:path is path.win32 on Windows and path.posix elsewhere, and each holds the other: the walk starts at the same one everywhere.
  const path = require("node:path");
  expect(path).toBe(process.platform === "win32" ? path.win32 : path.posix);
  for (const id of modules) describe(id === "path" ? path.posix : require(`node:${id}`), id, 4);
  expect(lines.join("\n")).toMatchSnapshot();
});

test("the own keys of instances and of what lies above them", () => {
  const { Readable, Writable, Duplex, Transform, PassThrough } = require("node:stream");
  const http = require("node:http");
  const net = require("node:net");
  const asyncHooks = require("node:async_hooks");
  const make: Record<string, () => object> = {
    EventEmitter: () => new (require("node:events"))(),
    Readable: () => new Readable({ read() {} }),
    Writable: () => new Writable({ write() {} }),
    Duplex: () => new Duplex({ read() {}, write() {} }),
    Transform: () => new Transform({ transform() {} }),
    PassThrough: () => new PassThrough(),
    ReadableState: () => new Readable({ read() {} })._readableState,
    WritableState: () => new Writable({ write() {} })._writableState,
    "net.Socket": () => new net.Socket(),
    "net.Server": () => new net.Server(),
    "http.Agent": () => new http.Agent(),
    "https.Agent": () => new (require("node:https").Agent)(),
    "http.Server": () => new http.Server(),
    "http.IncomingMessage": () => new http.IncomingMessage(new net.Socket()),
    "http.OutgoingMessage": () => new http.OutgoingMessage(),
    "http.ServerResponse": () => new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 }),
    AsyncLocalStorage: () => new asyncHooks.AsyncLocalStorage(),
    AsyncResource: () => new asyncHooks.AsyncResource("x"),
    "url.parse": () => require("node:url").parse("http://a/b?c#d"),
  };
  const lines: string[] = [];
  for (const [name, create] of Object.entries(make)) {
    let level = 0;
    for (let object: object | null = create(); object !== null && object !== Object.prototype && level < 7; level++) {
      const keys = Reflect.ownKeys(object).map(
        key => `${String(key)}:${attributesOf(Object.getOwnPropertyDescriptor(object!, key)!)}`,
      );
      lines.push(`${name} level ${level}: ${keys.join(" ")}`);
      object = Object.getPrototypeOf(object);
    }
  }
  expect(lines.join("\n")).toMatchSnapshot();
});

test("constructors that old code applies to an object of its own", () => {
  const stream = require("node:stream");
  const http = require("node:http");
  const net = require("node:net");
  const constructors: Record<string, [Function, unknown[]]> = {
    EventEmitter: [require("node:events"), []],
    Stream: [stream, []],
    Readable: [stream.Readable, [{}]],
    Writable: [stream.Writable, [{}]],
    Duplex: [stream.Duplex, [{}]],
    Transform: [stream.Transform, [{}]],
    PassThrough: [stream.PassThrough, [{}]],
    ReadableState: [stream.Readable.ReadableState, [{}]],
    WritableState: [stream.Writable.WritableState, [{}]],
    "net.Socket": [net.Socket, [{}]],
    "net.Server": [net.Server, []],
    "http.Agent": [http.Agent, [{}]],
    "http.Server": [http.Server, []],
    "http.OutgoingMessage": [http.OutgoingMessage, []],
    "http.IncomingMessage": [http.IncomingMessage, [undefined]],
  };
  const lines: string[] = [];
  for (const [name, [constructor, args]] of Object.entries(constructors)) {
    const self = Object.create(constructor.prototype);
    let outcome: string;
    try {
      const answer = constructor.apply(self, args);
      outcome =
        answer === undefined ? "answers undefined" : answer === self ? "answers this" : `answers ${typeof answer}`;
    } catch (error) {
      outcome = `throws ${(error as Error).constructor.name}`;
    }
    lines.push(`${name}: ${outcome}`);
  }
  expect(lines.join("\n")).toMatchSnapshot();
});
