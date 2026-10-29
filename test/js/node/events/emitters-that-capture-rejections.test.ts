import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { EventEmitter } from "node:events";
import { join } from "node:path";

const turnOfTheEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));
const kCapture = Object.getOwnPropertySymbols(new EventEmitter()).find(symbol => symbol.description === "kCapture")!;
const rejecting = () => Promise.reject(new Error("boom"));

// https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L456: node has one emit(), on the prototype.
test("an emitter with captureRejections has no `emit` of its own, and `emitter.emit()` calls the `emit` of its class", () => {
  const emitted: string[] = [];
  class Logged extends EventEmitter {
    emit(name: string | symbol, ...args: unknown[]) {
      emitted.push(String(name));
      return super.emit(name, ...args);
    }
  }

  for (const options of [{ captureRejections: true }, undefined, { captureRejections: false }]) {
    emitted.length = 0;
    const emitter = new Logged(options);
    expect(Object.hasOwn(emitter, "emit")).toBe(false);
    expect(Object.keys(emitter)).toEqual(["_events", "_eventsCount", "_maxListeners"]);
    expect(emitter.emit).toBe(Logged.prototype.emit);
    const heard: unknown[] = [];
    emitter.on("x", value => heard.push(value));
    expect(emitter.emit("x", 1)).toBe(true);
    expect(heard).toEqual([1]);
    expect(emitted).toEqual(["x"]);
  }
  expect(new EventEmitter({ captureRejections: true }).emit).toBe(EventEmitter.prototype.emit);
});

test("with captureRejections, every road to the prototype's emit() captures", async () => {
  const errors: string[] = [];
  class Sub extends EventEmitter {
    emit(name: string | symbol, ...args: unknown[]) {
      return super.emit(name, ...args);
    }
  }
  const throughSuper = new Sub({ captureRejections: true });
  throughSuper.on("error", error => errors.push("super: " + error.message));
  throughSuper.on("x", rejecting);
  expect(throughSuper.emit("x")).toBe(true);

  const called = new EventEmitter({ captureRejections: true });
  called.on("error", error => errors.push("call: " + error.message));
  called.on("x", rejecting);
  expect(EventEmitter.prototype.emit.call(called, "x")).toBe(true);

  const deleted = new EventEmitter({ captureRejections: true });
  deleted.on("error", error => errors.push("delete: " + error.message));
  deleted.on("x", rejecting);
  expect(delete (deleted as any).emit).toBe(true);
  expect(deleted.emit("x")).toBe(true);

  const saved = EventEmitter.prototype.emit;
  const wrapped = new EventEmitter({ captureRejections: true });
  wrapped.on("error", error => errors.push("wrapper: " + error.message));
  wrapped.on("x", rejecting);
  wrapped.emit = function (this: EventEmitter, ...args: [string | symbol, ...unknown[]]) {
    return saved.apply(this, args);
  };
  expect(wrapped.emit("x")).toBe(true);

  const byHand: any = new EventEmitter();
  byHand[kCapture] = true;
  byHand.on("error", (error: Error) => errors.push("flag set by hand: " + error.message));
  byHand.on("x", rejecting);
  expect(byHand.emit("x")).toBe(true);

  await turnOfTheEventLoop();
  expect(errors).toEqual(["super: boom", "call: boom", "delete: boom", "wrapper: boom", "flag set by hand: boom"]);
});

test("an emitter that captures is constructed below an `emit` that cannot be stored to", () => {
  let setterCalls = 0;
  class WithAccessor extends EventEmitter {
    get emit() {
      return super.emit;
    }
    set emit(_value) {
      setterCalls++;
    }
  }
  expect(Object.hasOwn(new WithAccessor({ captureRejections: true }), "emit")).toBe(false);
  expect(setterCalls).toBe(0);

  class ReadOnly extends EventEmitter {}
  Object.defineProperty(ReadOnly.prototype, "emit", { value: EventEmitter.prototype.emit, writable: false });
  expect(Object.keys(new ReadOnly({ captureRejections: true }))).toEqual(["_events", "_eventsCount", "_maxListeners"]);

  class Frozen extends EventEmitter {
    emit(name: string | symbol, ...args: unknown[]) {
      return super.emit(name, ...args);
    }
  }
  Object.freeze(Frozen.prototype);
  expect(Object.keys(new Frozen({ captureRejections: true }))).toEqual(["_events", "_eventsCount", "_maxListeners"]);

  const sets: string[] = [];
  const proxy = new Proxy(Object.create(EventEmitter.prototype), {
    set(target, key, value, receiver) {
      sets.push(String(key));
      return Reflect.set(target, key, value, receiver);
    },
  });
  EventEmitter.call(proxy, { captureRejections: true });
  expect(sets).toEqual(["_events", "_eventsCount", "Symbol(shapeMode)", "_maxListeners", "Symbol(kCapture)"]);
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L352: the constructor that ran last decides.
test("the constructor run twice leaves the flag of the second run", async () => {
  const errors: string[] = [];
  const onThenOff: any = new EventEmitter({ captureRejections: true });
  EventEmitter.call(onThenOff);
  expect(onThenOff[kCapture]).toBe(false);
  expect(Object.keys(onThenOff)).toEqual(["_events", "_eventsCount", "_maxListeners"]);

  const offThenOn: any = new EventEmitter();
  EventEmitter.call(offThenOn, { captureRejections: true });
  expect(offThenOn[kCapture]).toBe(true);
  offThenOn.on("error", (error: Error) => errors.push(error.message));
  offThenOn.on("x", rejecting);
  expect(offThenOn.emit("x")).toBe(true);
  await turnOfTheEventLoop();
  expect(errors).toEqual(["boom"]);
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L384-L395
test("after a captured rejection went to 'error', the flag is what it was before", async () => {
  const seen: string[] = [];
  const emitter: any = new EventEmitter({ captureRejections: true });
  emitter.on("error", (error: Error) => seen.push(`${error.message}, flag ${emitter[kCapture]}`));
  emitter.on("x", rejecting);
  expect(emitter.emit("x")).toBe(true);
  emitter[kCapture] = false;
  await turnOfTheEventLoop();
  expect(seen).toEqual(["boom, flag false"]);
  expect(emitter[kCapture]).toBe(false);

  emitter[kCapture] = true;
  expect(emitter.emit("x")).toBe(true);
  await turnOfTheEventLoop();
  expect(seen).toEqual(["boom, flag false", "boom, flag false"]);
  expect(emitter[kCapture]).toBe(true);
});

test("with captureRejections, a promise that a listener returns is listened to, and no other object with a `then`", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const errors: string[] = [];
  emitter.on("error", error => errors.push(error.message));

  let reads = 0;
  emitter.on("thenable", () => ({
    get then() {
      reads++;
      return (_onFulfilled: unknown, onRejected: (reason: Error) => void) => onRejected(new Error("out of a thenable"));
    },
  }));
  expect(emitter.emit("thenable")).toBe(true);
  await turnOfTheEventLoop();
  expect(reads).toBe(0);
  expect(errors).toEqual([]);

  emitter.on("promise", () => Promise.reject(new Error("out of a promise")));
  expect(emitter.emit("promise")).toBe(true);
  expect(errors).toEqual([]);
  await turnOfTheEventLoop();
  expect(errors).toEqual(["out of a promise"]);
});

test("with captureRejections, a promise that an 'error' listener returns is not listened to", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const seen: string[] = [];
  const returned: Promise<never>[] = [];
  emitter.on("error", error => {
    seen.push(error.message);
    const promise = Promise.reject(new Error("second"));
    returned.push(promise);
    return promise;
  });
  expect(emitter.emit("error", new Error("first"))).toBe(true);
  expect(returned).toHaveLength(1);
  await expect(returned[0]).rejects.toThrow("second");
  await turnOfTheEventLoop();
  expect(seen).toEqual(["first"]);
  expect(returned).toHaveLength(1);
});

const underTheDefault = String.raw`const unhandled = [];
process.on("unhandledRejection", reason => unhandled.push(reason.message));
const turnOfTheEventLoop = () => new Promise(resolve => setImmediate(resolve));

class Sub extends EventEmitter {
  emit(type, ...args) {
    console.log("override called: " + String(type));
    return super.emit(type, ...args);
  }
}

(async () => {
  const a = new Sub();
  a.on("x", () => {});
  a.emit("x");
  console.log("--- captureRejections: true");
  const b = new Sub({ captureRejections: true });
  b.on("x", () => {});
  b.emit("x");

  const constructedByNobody = Object.create(EventEmitter.prototype);
  constructedByNobody.on("error", error => console.log("captured " + error.message));
  constructedByNobody.on("x", () => Promise.reject(new Error("while the default is off")));
  constructedByNobody.emit("x");
  await turnOfTheEventLoop();

  console.log("--- EventEmitter.captureRejections = true");
  EventEmitter.captureRejections = true;
  const c = new Sub();
  c.on("x", () => {});
  c.emit("x");
  console.log("own emit:", Object.hasOwn(b, "emit"), Object.hasOwn(c, "emit"));
  console.log(JSON.stringify(Object.keys(b)));

  constructedByNobody.on("y", () => Promise.reject(new Error("while the default is on")));
  constructedByNobody.emit("y");
  await turnOfTheEventLoop();

  console.log("--- EventEmitter.prototype.emit replaced");
  const original = EventEmitter.prototype.emit;
  const before = new EventEmitter();
  EventEmitter.prototype.emit = function emit(type, ...args) {
    console.log("replacement called: " + String(type));
    return original.call(this, type, ...args);
  };
  const after = new EventEmitter();
  before.on("before", () => {});
  after.on("after", () => {});
  before.emit("before");
  after.emit("after");
  EventEmitter.prototype.emit = original;
  console.log("unhandled:", JSON.stringify(unhandled));
})();
`;

// The expected text is what node v26.3.0 prints for the same file.
test.concurrent.each([
  ["a CommonJS module", "default.cjs", `const { EventEmitter } = require("node:events");`],
  ["an ES module", "default.mjs", `import { EventEmitter } from "node:events";`],
])("EventEmitter.captureRejections and a replaced EventEmitter.prototype.emit, in %s", async (_, file, firstLine) => {
  using dir = tempDir("events-capture-rejections-default", { [file]: firstLine + "\n" + underTheDefault });
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), file)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "override called: x",
      "--- captureRejections: true",
      "override called: x",
      "--- EventEmitter.captureRejections = true",
      "override called: x",
      "own emit: false false",
      '["_events","_eventsCount","_maxListeners"]',
      "captured while the default is on",
      "--- EventEmitter.prototype.emit replaced",
      "replacement called: before",
      "replacement called: after",
      'unhandled: ["while the default is off"]',
    ],
    stderr: "",
    exitCode: 0,
  });
});

const kindsOfEmitter = String.raw`const { EventEmitter, EventEmitterAsyncResource } = require("node:events");
EventEmitter.captureRejections = true;
const closing = [];
const kinds = {
  streams: {
    "EventEmitter": () => new EventEmitter(),
    "EventEmitterAsyncResource": () => new EventEmitterAsyncResource({ name: "kind" }),
    "stream.Stream": () => new (require("node:stream").Stream)(),
    "stream.Readable": () => new (require("node:stream").Readable)({ read() {} }),
    "stream.Writable": () => new (require("node:stream").Writable)({ write() {} }),
    "stream.Duplex": () => new (require("node:stream").Duplex)({ read() {}, write() {} }),
    "stream.Transform": () => new (require("node:stream").Transform)({ transform() {} }),
    "stream.PassThrough": () => new (require("node:stream").PassThrough)(),
    "net.Socket": () => new (require("node:net").Socket)(),
    "net.Server": () => require("node:net").createServer(),
    "dgram.Socket": () => {
      const socket = require("node:dgram").createSocket("udp4");
      closing.push(() => socket.close());
      return socket;
    },
    "fs.ReadStream": () => {
      const file = require("node:fs").createReadStream(__filename);
      closing.push(() => file.destroy());
      return file;
    },
    "zlib.Gzip": () => require("node:zlib").createGzip(),
    "zlib.Gunzip": () => require("node:zlib").createGunzip(),
    "zlib.BrotliCompress": () => require("node:zlib").createBrotliCompress(),
    "readline.Interface": () => {
      const lines = require("node:readline").createInterface({ input: new (require("node:stream").PassThrough)() });
      closing.push(() => lines.close());
      return lines;
    },
    "child_process.ChildProcess": () => new (require("node:child_process").ChildProcess)(),
    "cluster.Worker": () => new (require("node:cluster").Worker)(),
  },
  servers: {
    "http.Server": () => require("node:http").createServer(),
    "http.Agent": () => new (require("node:http").Agent)(),
    "http.IncomingMessage": () => new (require("node:http").IncomingMessage)(new (require("node:net").Socket)()),
    "http.OutgoingMessage": () => new (require("node:http").OutgoingMessage)(),
    "http.ServerResponse": () => {
      const http = require("node:http");
      return new http.ServerResponse(new http.IncomingMessage(new (require("node:net").Socket)()));
    },
    "https.Server": () => require("node:https").createServer(),
    "https.Agent": () => new (require("node:https").Agent)(),
    "http2.Http2Server": () => require("node:http2").createServer(),
    "tls.Server": () => require("node:tls").createServer(),
    "tls.TLSSocket": () => new (require("node:tls").TLSSocket)(new (require("node:net").Socket)()),
  },
}[process.argv[2]];
const withOwnEmit = [];
let emitters = 0;
for (const name in kinds) {
  const made = kinds[name]();
  if (made instanceof EventEmitter) emitters++;
  if (Object.hasOwn(made, "emit")) withOwnEmit.push(name);
}
for (const close of closing) close();
console.log(emitters + " kinds of emitter, an own emit on: " + JSON.stringify(withOwnEmit));
`;

// The expected text is what node v26.3.0 prints for the same file. One at a time: each loads much of the library.
test.each([
  ["streams", "18 kinds of emitter, an own emit on: []\n"],
  ["servers", "10 kinds of emitter, an own emit on: []\n"],
])(
  "under EventEmitter.captureRejections, no emitter that a built-in module makes has an `emit` of its own: %s",
  async (group, expected) => {
    using dir = tempDir("events-capture-rejections-kinds", { "kinds.cjs": kindsOfEmitter });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "kinds.cjs"), group],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  },
);

const streamAndServer = String.raw`const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const http = require("node:http");

const turn = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  // A read in paused mode finds nobody at 'data'. Then a listener's rejection destroys the stream.
  const readable = new Readable({ captureRejections: true, read() {} });
  readable.push("a");
  readable.push("b");
  console.log("paused read:", String(readable.read()), Object.hasOwn(readable, "emit"));
  readable.on("error", error => console.log("readable error:", error.message, readable.destroyed));
  readable.on("data", async chunk => {
    throw new Error("data " + chunk);
  });
  readable.push("c");
  await turn();
  await turn();

  EventEmitter.captureRejections = true;
  const events = [];
  const server = http.createServer((request, response) => {
    events.push(
      "own emit: " + [server, request, response, request.socket].map(emitter => Object.hasOwn(emitter, "emit")).join(" "),
    );
    response.on("finish", () => events.push(request.url + " finish"));
    response.on("close", () => {
      events.push(request.url + " close");
      if (request.url === "/rejects") closed();
    });
    if (request.url === "/rejects") return Promise.reject(new Error("out of the listener"));
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => (body += chunk));
    request.on("end", () => response.end("got " + body, () => events.push(request.url + " end callback")));
  });
  const { promise: responseClosed, resolve: closed } = Promise.withResolvers();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const answered = await fetch(origin + "/answers", { method: "POST", body: "ping" });
  console.log(answered.status, await answered.text());
  const rejected = await fetch(origin + "/rejects");
  console.log(rejected.status, await rejected.text());
  await responseClosed;
  console.log(events.join("\n"));
  server.close();
  server.closeAllConnections();
})();
`;

// The expected text is what node v26.3.0 prints for the same file.
test("a paused read and a node:http exchange on emitters that capture rejections", async () => {
  using dir = tempDir("events-capture-rejections-http", { "exchange.cjs": streamAndServer });
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "exchange.cjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      "paused read: a false",
      "readable error: data b true",
      "200 got ping",
      "500 Internal Server Error",
      "own emit: false false false false",
      "/answers finish",
      "/answers end callback",
      "/answers close",
      "own emit: false false false false",
      "/rejects finish",
      "/rejects close",
    ],
    stderr: "",
    exitCode: 0,
  });
});
