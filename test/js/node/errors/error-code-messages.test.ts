import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls as tlsCert } from "harness";
import child_process from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import tls from "node:tls";
import url from "node:url";
import zlib from "node:zlib";

// Codes whose messages come from the fixed-template table behind $ERR_*.
function capture(fn: () => unknown): string {
  try {
    fn();
  } catch (e: any) {
    return describeError(e);
  }
  return "no throw";
}

function describeError(e: any): string {
  return `${e.code} | ${e.name} | ${e.message}`;
}

test("table-driven ERR_* codes keep their exact messages", () => {
  expect(capture(() => zlib.createBrotliCompress({ params: { 99999: 1 } }))).toBe(
    "ERR_BROTLI_INVALID_PARAM | RangeError | 99999 is not a valid Brotli parameter",
  );
  expect(capture(() => zlib.zstdCompressSync("x", { params: { 99999: 1 } }))).toBe(
    "ERR_ZSTD_INVALID_PARAM | RangeError | 99999 is not a valid zstd parameter",
  );
  expect(capture(() => http.validateHeaderName("bad header"))).toBe(
    'ERR_INVALID_HTTP_TOKEN | TypeError | Header name must be a valid HTTP token ["bad header"]',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: "TLSv9" as any }))).toBe(
    'ERR_TLS_INVALID_PROTOCOL_VERSION | TypeError | "TLSv9" is not a valid minimum TLS protocol version',
  );
  // Node formats the value with %j: strings are quoted and escaped, numbers are bare.
  expect(capture(() => tls.createSecureContext({ minVersion: 'a"b' as any }))).toBe(
    'ERR_TLS_INVALID_PROTOCOL_VERSION | TypeError | "a\\"b" is not a valid minimum TLS protocol version',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: 0 as any }))).toBe(
    "ERR_TLS_INVALID_PROTOCOL_VERSION | TypeError | 0 is not a valid minimum TLS protocol version",
  );
  expect(capture(() => child_process.fork("x", { stdio: ["pipe", "pipe", "pipe"] }))).toBe(
    "ERR_CHILD_PROCESS_IPC_REQUIRED | Error | Forked processes must have an IPC channel, missing value 'ipc' in options.stdio",
  );
  expect(capture(() => (Readable.prototype._read as Function).call(new Readable()))).toBe(
    "ERR_METHOD_NOT_IMPLEMENTED | Error | The _read() method is not implemented",
  );
});

// Every expected message below is the text node v26.3.0 gives that error.

// Runs `handler` in a node:http request listener on 127.0.0.1 and resolves to what it returns.
async function inRequestListener<T>(handler: (res: http.ServerResponse) => T | Promise<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const server = http.createServer((req, res) => {
    new Promise<T>(done => done(handler(res))).then(resolve, reject).finally(() => res.destroy());
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
  socket.on("error", reject);
  socket.on("close", () => reject(new Error("the connection closed before the request listener finished")));
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  try {
    return await promise;
  } finally {
    socket.destroy();
    server.closeAllConnections();
    server.close();
  }
}

// `strictContentLength` is a field of OutgoingMessage. @types/node declares it on ServerResponse only.
type ClientRequest = http.ClientRequest & { strictContentLength: boolean };

// Runs `fn` on a request to a node:http server on 127.0.0.1. Every `fn` here throws before the request is complete.
async function withClientRequest<T>(options: http.RequestOptions, fn: (req: ClientRequest) => T): Promise<T> {
  const server = http.createServer((req, res) => res.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const req = http.request({ host: "127.0.0.1", port, agent: false, ...options }) as ClientRequest;
  // destroy() below aborts the request. The abort arrives as an "error" event.
  req.on("error", () => {});
  try {
    return fn(req);
  } finally {
    req.destroy();
    server.closeAllConnections();
    server.close();
  }
}

test("ERR_HTTP_CONTENT_LENGTH_MISMATCH names the written and the declared byte counts", async () => {
  const mismatch = (actual: number) =>
    `ERR_HTTP_CONTENT_LENGTH_MISMATCH | Error | Response body's content-length of ${actual} byte(s) does not match the content-length of 5 byte(s) set in header`;
  const post = { method: "POST", headers: { "Content-Length": 5 } };

  expect(
    await withClientRequest(post, req => {
      req.strictContentLength = true;
      return capture(() => req.end("abc"));
    }),
  ).toBe(mismatch(3));
  expect(
    await withClientRequest(post, req => {
      req.strictContentLength = true;
      req.write("hello");
      return capture(() => req.write("a"));
    }),
  ).toBe(mismatch(6));
  expect(
    await inRequestListener(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 5);
      return capture(() => res.end("abc"));
    }),
  ).toBe(mismatch(3));
  expect(
    await inRequestListener(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 5);
      res.write("hello");
      return capture(() => res.write("a"));
    }),
  ).toBe(mismatch(6));
});

test("ERR_HTTP_TRAILER_INVALID has node's message on a request and on a response", async () => {
  const invalid = "ERR_HTTP_TRAILER_INVALID | Error | Trailers are invalid with this transfer encoding";

  expect(await withClientRequest({ method: "GET", headers: { Trailer: "X-T" } }, req => capture(() => req.end()))).toBe(
    invalid,
  );
  // writeHead() checks the trailer in two places: with a raw header array, and with no headers or an object.
  for (const headers of [undefined, ["X-A", "1"]]) {
    expect(
      await inRequestListener(res => {
        res.setHeader("Trailer", "X-T");
        res.setHeader("Content-Length", 3);
        return capture(() => res.writeHead(200, headers));
      }),
    ).toBe(invalid);
  }
});

test("ERR_STREAM_DESTROYED from a destroyed ServerResponse names write()", async () => {
  const err = await inRequestListener(res => {
    const { promise, resolve } = Promise.withResolvers<Error | null | undefined>();
    res.destroy();
    res.write("x", resolve);
    return promise;
  });
  expect(describeError(err)).toBe("ERR_STREAM_DESTROYED | Error | Cannot call write after a stream was destroyed");
});

test("ERR_INVALID_URL_SCHEME names the file scheme for every fileURLToPath variant", () => {
  const scheme = "ERR_INVALID_URL_SCHEME | TypeError | The URL must be of scheme file";
  for (const options of [undefined, { windows: true }, { windows: false }]) {
    expect(capture(() => url.fileURLToPath("http://example.com/x", options))).toBe(scheme);
    expect(capture(() => url.fileURLToPath(new URL("http://example.com/x"), options))).toBe(scheme);
    expect(capture(() => url.fileURLToPathBuffer("http://example.com/x", options))).toBe(scheme);
  }
});

test("ERR_METHOD_NOT_IMPLEMENTED for a FileHandle stream with a custom fs", async () => {
  const handle = await fs.promises.open(import.meta.path);
  try {
    const notImplemented = "ERR_METHOD_NOT_IMPLEMENTED | Error | The FileHandle with fs method is not implemented";
    expect(capture(() => fs.createReadStream(null as any, { fd: handle, fs }))).toBe(notImplemented);
    expect(capture(() => fs.createWriteStream(null as any, { fd: handle, fs }))).toBe(notImplemented);
  } finally {
    await handle.close();
  }
});

test("ERR_OPERATION_FAILED from a FileHandle writer has one prefix", async () => {
  using dir = tempDir("error-code-messages", {});
  const handle = await fs.promises.open(path.join(String(dir), "out.txt"), "w");
  const writer = (handle as any).writer({ autoClose: true });
  const { writeSync } = fs;
  try {
    // The writer retries a write that makes no progress, then gives up.
    fs.writeSync = () => 0;
    expect(capture(() => writer.writeSync(Buffer.from("abc")))).toBe(
      "ERR_OPERATION_FAILED | Error | Operation failed: write failed after retries",
    );
  } finally {
    fs.writeSync = writeSync;
    writer.fail();
  }
});

// node:repl takes about 5 s to load on a debug build with ASAN (see test/js/bun/repl/repl.test.ts).
const replTimeout = 20_000;

test(
  "the REPL reports ERR_SCRIPT_EXECUTION_INTERRUPTED with node's message",
  async () => {
    // Ctrl+C while the REPL awaits a promise that never settles. The terminal delivers its input
    // synchronously, like test/common/arraystream.js in node, so the keypress cannot arrive early.
    const fixture = `
      const repl = require("node:repl");
      const { Stream } = require("node:stream");
      class Terminal extends Stream {
        readable = true;
        writable = true;
        output = "";
        pause() {}
        resume() {}
        write(chunk) {
          this.output += chunk;
        }
      }
      const terminal = new Terminal();
      const server = repl.start({ prompt: "> ", stream: terminal, terminal: true, useColors: false, breakEvalOnSigint: true });
      terminal.emit("data", "await new Promise(() => {})\\n");
      server.write("", { ctrl: true, name: "c" });
      process.on("exit", () => process.stdout.write(terminal.output));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("Script execution was interrupted by `SIGINT`");
    expect(exitCode).toBe(0);
  },
  replTimeout,
);

test("secureProtocol conflicts with minVersion and maxVersion", () => {
  expect(capture(() => tls.createSecureContext({ minVersion: "TLSv1.2", secureProtocol: "TLSv1_2_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version "TLSv1.2" conflicts with secureProtocol "TLSv1_2_method"',
  );
  expect(capture(() => tls.createSecureContext({ maxVersion: "TLSv1.3", secureProtocol: "TLS_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version "TLSv1.3" conflicts with secureProtocol "TLS_method"',
  );
  expect(capture(() => new tls.Server({ minVersion: "TLSv1.2", secureProtocol: "TLS_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version "TLSv1.2" conflicts with secureProtocol "TLS_method"',
  );
  expect(capture(() => https.createServer({ ...tlsCert, maxVersion: "TLSv1.2", secureProtocol: "TLS_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version "TLSv1.2" conflicts with secureProtocol "TLS_method"',
  );
  expect(capture(() => tls.connect({ port: 1, minVersion: "TLSv1.2", secureProtocol: "TLS_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version "TLSv1.2" conflicts with secureProtocol "TLS_method"',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: 5 as any, secureProtocol: "TLS_method" }))).toBe(
    'ERR_TLS_PROTOCOL_VERSION_CONFLICT | TypeError | TLS protocol version 5 conflicts with secureProtocol "TLS_method"',
  );
  expect(capture(() => tls.createSecureContext({ minVersion: null as any, secureProtocol: "TLS_method" }))).toBe(
    "no throw",
  );
  // tls.Server drops a falsy minVersion/maxVersion before it builds the context.
  expect(capture(() => new tls.Server({ minVersion: "" as any, secureProtocol: "TLS_method" }))).toBe("no throw");
  expect(capture(() => new tls.Server({ maxVersion: "" as any, secureProtocol: "TLS_method" }))).toBe("no throw");
  expect(capture(() => https.createServer({ ...tlsCert, minVersion: "" as any, secureProtocol: "TLS_method" }))).toBe(
    "no throw",
  );
});

test("ERR_HTTP_SOCKET_ASSIGNED message", () => {
  const socket = new EventEmitter();
  new http.ServerResponse({} as any).assignSocket(socket as any);
  expect(capture(() => new http.ServerResponse({} as any).assignSocket(socket as any))).toBe(
    "ERR_HTTP_SOCKET_ASSIGNED | Error | ServerResponse has an already assigned socket",
  );
});

test("ERR_IPC_CHANNEL_CLOSED message", async () => {
  using dir = tempDir("ipc-channel-closed", { "child.js": "// exits at once\n" });
  const child = child_process.fork(`${dir}/child.js`);
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.disconnect();
  const { promise, resolve } = Promise.withResolvers<(Error & { code?: string }) | null>();
  expect(child.send("x", resolve)).toBe(false);
  const err = await promise;
  expect(`${err?.code} | ${err?.name} | ${err?.message}`).toBe("ERR_IPC_CHANNEL_CLOSED | Error | Channel closed");
  await exited;
});

test("ERR_IPC_CHANNEL_CLOSED message from process.send() in the child", async () => {
  using dir = tempDir("ipc-channel-closed-child", {
    "child.js": `
      process.disconnect();
      process.send("x", e => console.log(e.code + " | " + e.name + " | " + e.message));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "child.js"],
    env: bunEnv,
    cwd: String(dir),
    stdio: ["ignore", "pipe", "pipe", "ipc" as any],
    ipc() {},
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ERR_IPC_CHANNEL_CLOSED | Error | Channel closed\n");
  expect(exitCode).toBe(0);
});

// ERR_SOCKET_BAD_PORT. Node builds its message in one place, from the name, the bound and the rejected value:
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/errors.js#L1807-L1812
// Every expected message below is the text node v26.12.1 gives for the same call.

function withUdpSocket<T>(fn: (socket: dgram.Socket) => T): T {
  const socket = dgram.createSocket("udp4");
  try {
    return fn(socket);
  } finally {
    socket.close();
  }
}

test("ERR_SOCKET_BAD_PORT has node's message at every call that rejects a port", () => {
  const badPort = (name: string, bound: string, received: string) =>
    `ERR_SOCKET_BAD_PORT | RangeError | ${name} should be ${bound} 0 and < 65536. Received ${received}.`;

  expect({
    "dns.lookupService": capture(() => dns.lookupService("127.0.0.1", 99999, () => {})),
    "dns.lookupService, string": capture(() => dns.lookupService("127.0.0.1", "99999" as any, () => {})),
    "dns.promises.lookupService": capture(() => dns.promises.lookupService("127.0.0.1", 99999)),
    "net.connect": capture(() => net.connect({ host: "127.0.0.1", port: 99999 })),
    "net.connect, string": capture(() => net.connect({ host: "127.0.0.1", port: "99999" as any })),
    "Socket#connect": capture(() => new net.Socket().connect(99999, "127.0.0.1")),
    "tls.connect": capture(() => tls.connect({ host: "127.0.0.1", port: 99999 })),
    "http.request": capture(() => http.request({ host: "127.0.0.1", port: 99999 })),
    "net.Server#listen": capture(() => net.createServer().listen(99999)),
    "net.Server#listen, options": capture(() => net.createServer().listen({ port: 99999 })),
    "net.Server#listen, options, string": capture(() => net.createServer().listen({ port: "99999" as any })),
    "tls.Server#listen": capture(() => tls.createServer().listen(99999)),
    "tls.Server#listen, options": capture(() => tls.createServer().listen({ port: 99999 })),
    "dgram connect": capture(() => withUdpSocket(socket => socket.connect(99999))),
    "dgram connect, zero": capture(() => withUdpSocket(socket => socket.connect(0))),
    "dgram send": capture(() => withUdpSocket(socket => socket.send("x", 99999, "127.0.0.1"))),
    "dgram send, string": capture(() => withUdpSocket(socket => socket.send("x", "0" as any, "127.0.0.1"))),
  }).toEqual({
    "dns.lookupService": badPort("Port", ">=", "type number (99999)"),
    "dns.lookupService, string": badPort("Port", ">=", "type string ('99999')"),
    "dns.promises.lookupService": badPort("Port", ">=", "type number (99999)"),
    "net.connect": badPort("Port", ">=", "type number (99999)"),
    "net.connect, string": badPort("Port", ">=", "type string ('99999')"),
    "Socket#connect": badPort("Port", ">=", "type number (99999)"),
    "tls.connect": badPort("Port", ">=", "type number (99999)"),
    "http.request": badPort("Port", ">=", "type number (99999)"),
    "net.Server#listen": badPort("options.port", ">=", "type number (99999)"),
    "net.Server#listen, options": badPort("options.port", ">=", "type number (99999)"),
    "net.Server#listen, options, string": badPort("options.port", ">=", "type string ('99999')"),
    "tls.Server#listen": badPort("options.port", ">=", "type number (99999)"),
    "tls.Server#listen, options": badPort("options.port", ">=", "type number (99999)"),
    "dgram connect": badPort("Port", ">", "type number (99999)"),
    "dgram connect, zero": badPort("Port", ">", "type number (0)"),
    "dgram send": badPort("Port", ">", "type number (99999)"),
    "dgram send, string": badPort("Port", ">", "type string ('0')"),
  });
});

test("ERR_SOCKET_BAD_PORT describes the rejected port by its type", () => {
  class Foo {}
  const received = (port: unknown) =>
    capture(() => dns.lookupService("127.0.0.1", port as any, () => {})).replace(
      "ERR_SOCKET_BAD_PORT | RangeError | Port should be >= 0 and < 65536. Received ",
      "",
    );
  expect(
    [
      NaN,
      Infinity,
      1.5,
      "",
      "it's",
      "longer than twenty-eight characters",
      undefined,
      null,
      true,
      10n,
      Symbol("sym"),
      [],
      new Foo(),
      function named() {},
    ].map(received),
  ).toEqual([
    "type number (NaN).",
    "type number (Infinity).",
    "type number (1.5).",
    "type string ('').",
    `type string ("it's").`,
    "type string ('longer than twenty-eight ...').",
    "undefined.",
    "null.",
    "type boolean (true).",
    "type bigint (10n).",
    "type symbol (Symbol(sym)).",
    "an instance of Array.",
    "an instance of Foo.",
    "function named.",
  ]);
});

test("an error thrown while ERR_SOCKET_BAD_PORT describes the port is the error of the call", () => {
  // The message names the constructor of an object. Node reads `port.constructor.name` for it.
  const port: any = {
    get constructor() {
      throw new Error("from the getter");
    },
  };
  expect({
    "dns.lookupService": capture(() => dns.lookupService("127.0.0.1", port, () => {})),
    "dgram connect": capture(() => withUdpSocket(socket => socket.connect(port))),
  }).toEqual({
    "dns.lookupService": "undefined | Error | from the getter",
    "dgram connect": "undefined | Error | from the getter",
  });
});

test("a port whose constructor name is not a string keeps ERR_SOCKET_BAD_PORT", () => {
  // Node does not convert such a name to a string: https://github.com/nodejs/node/blob/v26.12.1/lib/internal/errors.js#L1042-L1045
  const ports: any[] = [
    JSON.parse('{"constructor":{"name":{"toString":null}}}'),
    { constructor: { name: Symbol("name") } },
    { constructor: { name: 5 } },
    { constructor: {} },
  ];
  const codeAndClass = (fn: () => unknown) => capture(fn).split(" | ").slice(0, 2).join(" | ");
  const kept = "ERR_SOCKET_BAD_PORT | RangeError";
  expect(
    ports.map(port => ({
      "dns.lookupService": codeAndClass(() => dns.lookupService("127.0.0.1", port, () => {})),
      "dns.promises.lookupService": codeAndClass(() => dns.promises.lookupService("127.0.0.1", port)),
      "dgram connect": codeAndClass(() => withUdpSocket(socket => socket.connect(port))),
      "dgram send": codeAndClass(() => withUdpSocket(socket => socket.send("x", port, "127.0.0.1"))),
    })),
  ).toEqual(
    ports.map(() => ({
      "dns.lookupService": kept,
      "dns.promises.lookupService": kept,
      "dgram connect": kept,
      "dgram send": kept,
    })),
  );
});
