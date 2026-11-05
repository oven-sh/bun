// Shared helpers for the ws-*-compat tests.
//
// The remote end of every connection is a plain TCP (or TLS) socket that does the upgrade and framing by hand, so a
// test controls every byte the `ws` socket receives and sees every byte it sends.
//
// Every describe block runs once per entry in `implementations`: Bun's built-in `ws` and the npm package from
// test/node_modules. The npm run proves each expectation matches npm ws. Expectations were recorded on Node.js 26 with
// ws 8.18.3.
import { setSocketOptions } from "bun:internal-for-testing";
import { bunEnv, bunExe, isWindows } from "harness";
import { once } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";
import builtinWs, * as Ws from "ws";
import npmWs from "../../../node_modules/ws/index.js";
import {
  createPeer,
  HttpClient,
  listen,
  type Payload,
  type PeerOptions,
  RawClient,
  type RawSocket,
  type RequestOptions,
  showBytes,
  syncPrefix,
} from "../../web/websocket/raw-peer";

export * from "../../web/websocket/raw-peer";

// The installed @types/ws predates `autoPong` and `finishRequest`.
export type ClientOptions = Ws.ClientOptions & {
  protocols?: string | readonly string[];
  path?: string;
  autoPong?: boolean;
  finishRequest?: (request: ClientRequest, websocket: Ws.WebSocket) => void;
};

type WebSocketClass = typeof Ws.WebSocket & {
  new (address: string | URL, options?: ClientOptions): Ws.WebSocket;
  new (address: string | URL, protocols?: string | readonly string[], options?: ClientOptions): Ws.WebSocket;
};

export type WsModule = WebSocketClass & {
  WebSocket: WebSocketClass;
  WebSocketServer: typeof Ws.WebSocketServer;
  createWebSocketStream: typeof Ws.createWebSocketStream;
  [key: string]: any;
};

export const implementations: { name: string; builtin: boolean; specifier: string; ws: WsModule }[] = [
  { name: "built-in", builtin: true, specifier: "ws", ws: builtinWs as WsModule },
  {
    name: "npm ws",
    builtin: false,
    specifier: path.join(import.meta.dir, "../../../node_modules/ws/index.js"),
    ws: npmWs as WsModule,
  },
];

/**
 * Formats a value as one line: `"hi"`, `string(200)`, `Buffer("hi")`, `Buffer(0x0102)`, `Buffer()`,
 * `ArrayBuffer(0x01)`, `[Buffer(0x01)]`, `Blob(2)`.
 */
export function show(value: unknown): string {
  if (typeof value === "string") return value.length > 48 ? `string(${value.length})` : JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return `${value.constructor.name}(${showBytes(Buffer.from(value))})`;
  }
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${showBytes(Buffer.from(value.buffer, value.byteOffset, value.byteLength))})`;
  }
  if (value instanceof Blob) return `Blob(${value.size})`;
  if (value instanceof Error) return showError(value);
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  if (value instanceof Set) return `Set(${[...value].map(show).join(", ")})`;
  return value.constructor?.name ?? "Object";
}

/**
 * Formats an error as `RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE`. Replaces port
 * numbers with PORT.
 */
export function showError(error: any): string {
  if (!(error instanceof Error)) return `not an Error: ${error?.constructor?.name} ${JSON.stringify(error?.message)}`;
  const message = error.message.replace(/((?:127\.0\.0\.1|localhost|\[::1\]):)\d+/g, "$1PORT");
  return (
    `${error.constructor.name} ${JSON.stringify(message)}` + ((error as any).code ? ` ${(error as any).code}` : "")
  );
}

/** Returns `show(fn())`, or `throws <error>` if `fn` throws. */
export function tryCall(fn: () => unknown): string {
  try {
    return show(fn());
  } catch (error) {
    return "throws " + showError(error);
  }
}

/**
 * Logs a `ws` socket's events as lines, each ending with the readyState seen inside the listener:
 * `upgrade 101 rs=0`, `open rs=1`, `message Buffer("hi") text rs=1`, `message Buffer(0x01) binary rs=1`,
 * `ping Buffer("x") rs=1`, `error Error "socket hang up" ECONNRESET rs=2`, `close 1006 Buffer() rs=3`.
 * 'close' lines include every argument.
 */
export function recordEvents(ws: Ws.WebSocket, events: string[] = []) {
  const line = (text: string) => events.push(`${text} rs=${ws.readyState}`);
  ws.on("upgrade", response => line(`upgrade ${response.statusCode}`));
  ws.on("open", (...args: unknown[]) => line(["open", ...args.map(show)].join(" ")));
  ws.on("message", (data, isBinary) =>
    line(`message ${show(data)} ${isBinary === true ? "binary" : isBinary === false ? "text" : show(isBinary)}`),
  );
  ws.on("ping", data => String(data).startsWith(syncPrefix) || line(`ping ${show(data)}`));
  ws.on("pong", data => line(`pong ${show(data)}`));
  ws.on("error", error => line(`error ${showError(error)}`));
  ws.on("close", (...args: unknown[]) => line(["close", ...args.map(show)].join(" ")));
  return events;
}

/** Resolves with the arguments of the next `name` event. Unlike `events.once()`, an 'error' event doesn't reject it. */
export function nextEvent(emitter: NodeJS.EventEmitter, name: string): Promise<any[]> {
  return new Promise(resolve => emitter.once(name, (...args) => resolve(args)));
}

export const MiB = 1024 * 1024;

/**
 * Caps the kernel's send buffer of `sender` and receive buffer of `receiver`, each a WebSocket or a socket that is
 * already connected. By default the kernel takes about 4 MiB from a sender whose peer isn't reading before the sender
 * sees backpressure. With both caps it takes at most 262 KB on Linux. Call it before the first send.
 */
export function shrinkBuffers({ sender, receiver }: { sender?: object; receiver?: object }) {
  if (sender) setSocketOptions(sender, 1, 64 * 1024);
  if (receiver) setSocketOptions(receiver, 2, 64 * 1024);
}

/** The size of a message that can't be written in one go after `shrinkBuffers()`. Winsock may take any write whole. */
export const overflowSize = isWindows ? 32 * MiB : MiB;
export const repeatA = (count: number) => Buffer.alloc(count, "a").toString();

// Lines logged by `recordEvents()`.
export const openEvents = ["upgrade 101 rs=0", "open rs=1"];
export const abnormalClose = "close 1006 Buffer() rs=3";
export const closedBeforeOpen = [
  'error Error "WebSocket was closed before the connection was established" rs=2',
  abnormalClose,
];

// Errors as `showError()` formats them.
export const tooBig = 'RangeError "Max payload size exceeded" WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
export const invalidFrame = (what: string, code: string) => `RangeError "Invalid WebSocket frame: ${what}" ${code}`;
export const invalidUTF8 = 'Error "Invalid WebSocket frame: invalid UTF-8 sequence" WS_ERR_INVALID_UTF8';
/** Strips the message from an error line but keeps the class and code. For messages written by OpenSSL or Node's HTTP parser. */
export const stripMessage = (line: string) => line.replace(/ ".*"/, "");

// `tryCall()` results.
export const tooLong = 'throws RangeError "The data size must not be greater than 125 bytes"';
export const invalidData = (received: string) =>
  'throws TypeError "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an ' +
  `Array-like Object. Received ${received}" ERR_INVALID_ARG_TYPE`;
const invalidCode = 'throws TypeError "First argument must be a valid error code number"';
export const reasonTooLong = 'throws RangeError "The message must not be greater than 123 bytes"';

/** npm ws masks a SharedArrayBuffer in place, so each client send() needs a fresh one. */
export function shared(...bytes: number[]) {
  const buffer = new SharedArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function resizable(...bytes: number[]) {
  const buffer = new ArrayBuffer(bytes.length, { maxByteLength: 64 });
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** A view whose ArrayBuffer is detached. */
export function detached() {
  const view = new Uint8Array(4);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
}

// Adds a `call` label such as `close(1000, "bye")` to each row, for the test name.
const withCallLabels = <Row extends { args: unknown[] }>(rows: Row[]) =>
  rows.map(row => ({ call: `close(${row.args.map(show).join(", ")})`, ...row }));

/** close() arguments that are accepted, the frame they send, and the 'close' line once the peer echoes that frame. */
export const validCloseCalls = withCallLabels([
  { args: [], frame: "close", event: "close 1005 Buffer() rs=3" },
  { args: [1000], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
  { args: [1000, "bye"], frame: 'close 1000 "bye"', event: 'close 1000 Buffer("bye") rs=3' },
  { args: [1000, ""], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
  { args: [1000, Buffer.from("buf")], frame: 'close 1000 "buf"', event: 'close 1000 Buffer("buf") rs=3' },
  { args: [1000, new Uint8Array([104, 105])], frame: 'close 1000 "hi"', event: 'close 1000 Buffer("hi") rs=3' },
  {
    args: [1000, new TextEncoder().encode("🙂")],
    frame: 'close 1000 "🙂"',
    event: 'close 1000 Buffer("🙂") rs=3',
  },
  { args: [1000, repeatA(123)], frame: "close 1000 123 bytes", event: "close 1000 Buffer(123 bytes) rs=3" },
  { args: [1000, repeatA(120) + "☃"], frame: "close 1000 123 bytes", event: "close 1000 Buffer(123 bytes) rs=3" },
  { args: [1000.5], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
  { args: [1001], frame: "close 1001", event: "close 1001 Buffer() rs=3" },
  { args: [1003, "bye"], frame: 'close 1003 "bye"', event: 'close 1003 Buffer("bye") rs=3' },
  { args: [1012], frame: "close 1012", event: "close 1012 Buffer() rs=3" },
  { args: [1013], frame: "close 1013", event: "close 1013 Buffer() rs=3" },
  { args: [1014], frame: "close 1014", event: "close 1014 Buffer() rs=3" },
  { args: [3000, "x"], frame: 'close 3000 "x"', event: 'close 3000 Buffer("x") rs=3' },
  { args: [4999], frame: "close 4999", event: "close 4999 Buffer() rs=3" },
  // Without a code the reason is dropped, no matter how long it is.
  { args: [undefined, "reason"], frame: "close", event: "close 1005 Buffer() rs=3" },
  { args: [undefined, repeatA(200)], frame: "close", event: "close 1005 Buffer() rs=3" },
  // A reason without a `length` is treated as empty.
  { args: [1000, 42], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
  { args: [1000, {}], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
]);

/** close() arguments that throw. */
export const invalidCloseCalls = withCallLabels([
  { args: [999], thrown: invalidCode },
  { args: [1004], thrown: invalidCode },
  { args: [1005], thrown: invalidCode },
  { args: [1006], thrown: invalidCode },
  { args: [1015], thrown: invalidCode },
  { args: [1016], thrown: invalidCode },
  { args: [2999], thrown: invalidCode },
  { args: [5000], thrown: invalidCode },
  { args: [65535], thrown: invalidCode },
  { args: [100000], thrown: invalidCode },
  { args: [0], thrown: invalidCode },
  { args: [-1], thrown: invalidCode },
  { args: [NaN], thrown: invalidCode },
  { args: ["1000"], thrown: invalidCode },
  { args: [null], thrown: invalidCode },
  { args: [true], thrown: invalidCode },
  { args: [1000, repeatA(124)], thrown: reasonTooLong },
  { args: [1000, Buffer.alloc(124, "é").toString()], thrown: reasonTooLong },
  { args: [1000, Buffer.alloc(124, "a")], thrown: reasonTooLong },
]);

/** Compresses one message the way permessage-deflate does: raw deflate, sync flush, trailing 00 00 ff ff removed. */
export const deflate = (data: Payload, options: zlib.ZlibOptions = {}) =>
  zlib.deflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...options }).subarray(0, -4);

/** Compresses messages with context takeover: they share one window, so later ones back-reference earlier ones. */
export async function deflateWithContext(messages: Payload[], windowBits?: number) {
  const stream = zlib.createDeflateRaw({ windowBits });
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const payloads: Buffer[] = [];
  for (const message of messages) {
    stream.write(message);
    await new Promise<void>(resolve => stream.flush(zlib.constants.Z_SYNC_FLUSH, resolve));
    payloads.push(Buffer.concat(chunks.splice(0)).subarray(0, -4));
  }
  stream.destroy();
  return payloads;
}

/**
 * Returns a function that inflates one compressed message payload. With context takeover a connection's messages form
 * one deflate stream, so call it on each payload in order.
 */
export function createInflater(options: zlib.ZlibOptions = {}) {
  let stream = Buffer.alloc(0);
  let inflatedLength = 0;
  return (payload: Buffer) => {
    stream = Buffer.concat([stream, payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
    const inflated = zlib.inflateRawSync(stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...options });
    const message = inflated.subarray(inflatedLength);
    inflatedLength = inflated.length;
    return message;
  };
}

function terminateQuietly(ws: Ws.WebSocket | undefined) {
  if (!ws) return;
  try {
    ws.on("error", () => {});
    ws.terminate();
  } catch {}
}

/**
 * Connects a `new WebSocket()` to a raw server without waiting for the handshake. `events` is `recordEvents(ws)`; `opened`
 * and `closed` resolve on 'open' and 'close'.
 */
export async function connectClient(
  { WebSocket }: WsModule,
  options: ClientOptions = {},
  peerOptions: PeerOptions = {},
) {
  const peer = await createPeer(peerOptions);
  const { protocols, path = "", ...rest } = options;
  const ws = new WebSocket(peer.url + path, protocols, rest);
  const events = recordEvents(ws);
  const opened = new Promise<void>(resolve => ws.on("open", () => resolve()));
  const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
  return {
    peer,
    ws,
    events,
    opened,
    closed,
    async [Symbol.asyncDispose]() {
      terminateQuietly(ws);
      await peer[Symbol.asyncDispose]();
    },
  };
}

/** An OPEN client socket plus `conn`, the raw server's end of the connection. */
export async function openClient(implementation: WsModule, options?: ClientOptions, peerOptions?: PeerOptions) {
  const client = await connectClient(implementation, options, peerOptions);
  try {
    const conn = await client.peer.connection();
    await client.opened;
    return { ...client, conn, [Symbol.asyncDispose]: client[Symbol.asyncDispose] };
  } catch (error) {
    await client[Symbol.asyncDispose]();
    throw error;
  }
}

/**
 * A listening `WebSocketServer({ port: 0 })`. `connect()` opens a raw client connection to it. Disposing it destroys
 * every connection.
 */
export async function createServer({ WebSocketServer }: WsModule, options: Ws.ServerOptions = {}) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", ...options });
  await once(wss, "listening");
  const { port } = wss.address() as net.AddressInfo;
  const clients: RawClient[] = [];
  const sockets: Ws.WebSocket[] = [];
  wss.on("connection", ws => sockets.push(ws));
  return {
    wss,
    port,
    connect(request?: RequestOptions) {
      const client = new RawClient(port, request);
      clients.push(client);
      return client;
    },
    async [Symbol.asyncDispose]() {
      for (const client of clients) client.destroy();
      for (const ws of sockets) terminateQuietly(ws);
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}

/**
 * Starts `server` (node:http, https, http2, net, ...) on its own port or on a unix socket, for testing a
 * WebSocketServer in `server` or `noServer` mode. `connect()` opens a raw client connection to it, over TLS if it's a
 * TLS server. `open(wss)` returns what `openServer()` returns, for a WebSocketServer that handles this server's
 * upgrades. Disposing it destroys every connection.
 */
export async function serve<Server extends net.Server>(server: Server, socketPath?: string) {
  const accepted = new Set<Duplex>();
  const clients: RawSocket[] = [];
  const sockets: Ws.WebSocket[] = [];
  const servers = new Set<Ws.WebSocketServer>();
  const secure = server instanceof tls.Server || server instanceof https.Server;
  server.on("connection", socket => accepted.add(socket));
  if (socketPath) server.listen(socketPath);
  else server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const track = <Client extends RawSocket>(client: Client) => (clients.push(client), client);
  return {
    server,
    /** A getter because a test can make the server listen again on a new port. */
    get port() {
      return socketPath ? 0 : (server.address() as net.AddressInfo).port;
    },
    connect(request?: RequestOptions) {
      return track(new RawClient(this.port, { socketPath, secure, ...request }));
    },
    connectHttp() {
      return track(new HttpClient(net.connect(this.port, "127.0.0.1")));
    },
    async open(wss: Ws.WebSocketServer, request?: RequestOptions) {
      servers.add(wss);
      const connection = once(wss, "connection");
      const client = this.connect(request);
      const [ws, req] = (await connection) as [Ws.WebSocket, IncomingMessage];
      sockets.push(ws);
      const events = recordEvents(ws);
      const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
      await client.response;
      return { wss, ws, req, client, events, closed };
    },
    async [Symbol.asyncDispose]() {
      for (const client of clients) client.destroy();
      for (const ws of sockets) terminateQuietly(ws);
      for (const wss of servers) wss.close();
      for (const socket of accepted) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

/**
 * An OPEN server socket (`ws`, with its upgrade request `req`) plus `client`, the raw client on the other end.
 * `events` is `recordEvents(ws)`; `closed` resolves on 'close'.
 */
export async function openServer(implementation: WsModule, options?: Ws.ServerOptions, request?: RequestOptions) {
  const server = await createServer(implementation, options);
  try {
    const connection = once(server.wss, "connection");
    const client = server.connect(request);
    const [ws, req] = (await connection) as [Ws.WebSocket, IncomingMessage];
    const events = recordEvents(ws);
    const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
    await client.response;
    return { ...server, ws, req, client, events, closed, [Symbol.asyncDispose]: server[Symbol.asyncDispose] };
  } catch (error) {
    await server[Symbol.asyncDispose]();
    throw error;
  }
}

/** Timeout for any test that uses `runScript()`. A debug build on a busy machine takes seconds to start. */
export const scriptTimeout = 90_000;

/**
 * Runs `script` in a child process, for things that can't be tested in-process: uncaught exceptions, the exit code,
 * whatever keeps the event loop alive. The script has `WebSocket`, `WebSocketServer`, `createWebSocketStream`, `show`,
 * `showError` and `shrinkBuffers` in scope. An uncaught exception prints `uncaught <error>` and the process keeps
 * running, as with any 'uncaughtException' listener. `env` is merged into the child's environment. Use with
 * `test.concurrent` and `scriptTimeout`.
 */
export async function runScript(
  implementation: { specifier: string },
  script: string,
  env: Record<string, string> = {},
) {
  const prelude = `
    const { WebSocket, WebSocketServer, createWebSocketStream } = require(process.env.WS_SPECIFIER);
    ${showBytes}
    ${show}
    ${showError}
    const setSocketOptions = (...args) => require("bun:internal-for-testing").setSocketOptions(...args);
    ${shrinkBuffers}
    process.on("uncaughtException", error => console.log("uncaught " + showError(error)));
  `;
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", prelude + script],
    env: { ...bunEnv, ...env, WS_SPECIFIER: implementation.specifier },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { lines: stdout.split("\n").filter(Boolean), stderr, exitCode };
}
