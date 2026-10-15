// Shared helpers for the ws-*-compat tests.
//
// The remote end of every connection is a plain TCP (or TLS) socket that does the upgrade and framing by hand, so a
// test controls every byte the `ws` socket receives and sees every byte it sends.
//
// Every describe block runs once per entry in `implementations`: Bun's built-in `ws` and the npm package from
// test/node_modules. The npm run proves each expectation matches npm ws. Expectations were recorded on Node.js 26 with
// ws 8.18.3.
import { bunEnv, bunExe, tls as harnessTls } from "harness";
import crypto from "node:crypto";
import { once } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import builtinWs, * as Ws from "ws";
import npmWs from "../../../node_modules/ws/index.js";

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

export const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const KEY = "dGhlIHNhbXBsZSBub25jZQ==";
export const OP = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

const opcodeNames: Record<number, string> = {
  0: "continuation",
  1: "text",
  2: "binary",
  8: "close",
  9: "ping",
  10: "pong",
};
const syncPrefix = "\0sync";

export type Payload = string | Uint8Array;
export type FrameOptions = { fin?: boolean; rsv1?: boolean; rsv2?: boolean; rsv3?: boolean; mask?: boolean };

export class Frame {
  #payload: Buffer;
  #key: Buffer | undefined;

  constructor(
    public fin: boolean,
    public rsv: number,
    public opcode: number,
    /** True for an unmasked client frame or a masked server frame. */
    public hasWrongMask: boolean,
    payload: Buffer,
    key: Buffer | undefined,
  ) {
    this.#payload = payload;
    this.#key = key;
  }

  get masked() {
    return this.#key !== undefined;
  }

  get length() {
    return this.#payload.length;
  }

  /** Unmasks lazily, so tests that only count 1 MiB frames skip the cost. */
  get payload(): Buffer {
    const key = this.#key;
    if (key) {
      const payload = this.#payload;
      for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      this.#key = Buffer.alloc(4);
    }
    return this.#payload;
  }
}

export function encodeFrame(opcode: number, payload: Payload = "", options: FrameOptions = {}): Buffer {
  const { fin = true, rsv1 = false, rsv2 = false, rsv3 = false, mask = false } = options;
  const body = Buffer.from(payload as any);
  const head = [(fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | (rsv2 ? 0x20 : 0) | (rsv3 ? 0x10 : 0) | opcode];
  const maskBit = mask ? 0x80 : 0;
  if (body.length < 126) {
    head.push(maskBit | body.length);
  } else if (body.length < 65536) {
    head.push(maskBit | 126, body.length >> 8, body.length & 255);
  } else {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(body.length));
    head.push(maskBit | 127, ...length);
  }
  if (!mask) return Buffer.concat([Buffer.from(head), body]);
  // An all-zero mask key leaves the payload unchanged, so large payloads skip the XOR loop.
  if (body.length > 65536) return Buffer.concat([Buffer.from(head), Buffer.alloc(4), body]);
  const key = [0x11, 0x22, 0x33, 0x44];
  const masked = Buffer.allocUnsafe(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ key[i & 3];
  return Buffer.concat([Buffer.from(head), Buffer.from(key), masked]);
}

export function closePayload(code: number, reason: Payload = ""): Buffer {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(code);
  return Buffer.concat([head, Buffer.from(reason as any)]);
}

function showBytes(bytes: Buffer): string {
  if (bytes.length === 0) return "";
  if (bytes.length > 48) return `${bytes.length} bytes`;
  const text = bytes.toString();
  // Print as text only if it round-trips through UTF-8 and has no control characters.
  if (Buffer.from(text).equals(bytes) && !/[\0-\x1f\x7f�]/.test(text)) return JSON.stringify(text);
  return "0x" + bytes.toString("hex");
}

/**
 * Formats a frame as one line: `text "hi"`, `binary 0x0102`, `binary 200 bytes`, `ping`, `close`, `close 1000`,
 * `close 4000 "bye"`. Appends `!fin` and `rsv1` / `rsv2` / `rsv3` when they apply, `unmasked` for an unmasked client
 * frame, and `masked` for a masked server frame.
 */
export function showFrame(frame: Frame): string {
  const parts = [opcodeNames[frame.opcode] ?? `opcode${frame.opcode}`];
  if (frame.opcode === OP.close && frame.length >= 2) {
    parts.push(String(frame.payload.readUInt16BE(0)));
    if (frame.length > 2) parts.push(showBytes(frame.payload.subarray(2)));
  } else if (frame.length > 48) {
    parts.push(`${frame.length} bytes`);
  } else if (frame.length) {
    parts.push(showBytes(frame.payload));
  }
  if (!frame.fin) parts.push("!fin");
  if (frame.rsv & 4) parts.push("rsv1");
  if (frame.rsv & 2) parts.push("rsv2");
  if (frame.rsv & 1) parts.push("rsv3");
  if (frame.hasWrongMask) parts.push(frame.masked ? "masked" : "unmasked");
  return parts.join(" ");
}

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
 * One end of a TCP connection that speaks WebSocket by hand. `frames` and `socketEvents` grow as data arrives; `next()` reads
 * frames in order.
 */
export class RawSocket {
  /** The HTTP head received: the request on a raw server, the response on a raw client. */
  head = "";
  /** Every frame received so far. */
  frames: Frame[] = [];
  /** Socket events in order: `"end"`, `"error ECONNRESET"`, `"close"`. */
  socketEvents: string[] = [];
  /** Resolves when the other side sends FIN or the connection closes. */
  ended: Promise<void>;
  /** Resolves when the connection closes. */
  closed: Promise<void>;

  #chunks: Buffer[] = [];
  #size = 0;
  #bytesNeeded = 2;
  #nextFrameIndex = 0;
  #done = false;
  #waiters: (() => void)[] = [];
  #syncCount = 0;

  constructor(
    public socket: net.Socket,
    private mask: boolean,
  ) {
    const ended = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    this.ended = ended.promise;
    this.closed = closed.promise;
    socket.on("error", (error: NodeJS.ErrnoException) => this.socketEvents.push("error " + error.code));
    socket.on("end", () => {
      this.socketEvents.push("end");
      this.#done = true;
      ended.resolve();
      this.#wake();
    });
    socket.on("close", () => {
      this.socketEvents.push("close");
      this.#done = true;
      ended.resolve();
      closed.resolve();
      this.#wake();
    });
  }

  #wake() {
    for (const resolve of this.#waiters.splice(0)) resolve();
  }

  /** Parses bytes received after the HTTP head into frames. */
  push(chunk: Buffer) {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    if (this.#size < this.#bytesNeeded) return;
    let buffer = this.#chunks.length === 1 ? chunk : Buffer.concat(this.#chunks);
    for (;;) {
      this.#bytesNeeded = 2;
      if (buffer.length < 2) break;
      let length = buffer[1] & 127;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) break;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) break;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const masked = (buffer[1] & 0x80) !== 0;
      if (masked) offset += 4;
      this.#bytesNeeded = offset + length;
      if (buffer.length < this.#bytesNeeded) break;
      this.frames.push(
        new Frame(
          (buffer[0] & 0x80) !== 0,
          (buffer[0] >> 4) & 7,
          buffer[0] & 15,
          masked === this.mask,
          Buffer.from(buffer.subarray(offset, offset + length)),
          masked ? Buffer.from(buffer.subarray(offset - 4, offset)) : undefined,
        ),
      );
      buffer = buffer.subarray(offset + length);
    }
    this.#chunks = buffer.length ? [buffer] : [];
    this.#size = buffer.length;
    this.#wake();
  }

  /** The next unread frame, or `undefined` once the other side has closed the connection. */
  async nextFrame(): Promise<Frame | undefined> {
    for (;;) {
      if (this.#nextFrameIndex < this.frames.length) return this.frames[this.#nextFrameIndex++];
      if (this.#done) return undefined;
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }

  /** `showFrame(await nextFrame())`, or `"EOF"`. */
  async next(): Promise<string> {
    const frame = await this.nextFrame();
    return frame ? showFrame(frame) : "EOF";
  }

  /** The next `count` frames. */
  async nextFrames(count: number): Promise<string[]> {
    const lines: string[] = [];
    while (lines.length < count) lines.push(await this.next());
    return lines;
  }

  /** Every unread frame until the connection ends. */
  async remainingFrames(): Promise<string[]> {
    const lines: string[] = [];
    for (let frame; (frame = await this.nextFrame());) lines.push(showFrame(frame));
    return lines;
  }

  /**
   * Sends a Ping and waits for its Pong. Needs an OPEN `ws` socket with auto-pong on. Once it resolves, the socket has
   * processed everything this side sent earlier, and everything it sent in response has arrived. Returns the frames
   * received before the Pong, so `[]` means "it sent nothing". `recordEvents()` hides this Ping.
   */
  async roundTrip(): Promise<string[]> {
    const payload = syncPrefix + ++this.#syncCount;
    this.ping(payload);
    const lines: string[] = [];
    for (;;) {
      const frame = await this.nextFrame();
      if (!frame) return [...lines, "EOF"];
      if (frame.opcode === OP.pong && frame.payload.toString() === payload) return lines;
      lines.push(showFrame(frame));
    }
  }

  send(opcode: number, payload?: Payload, options?: FrameOptions) {
    this.socket.write(encodeFrame(opcode, payload, { mask: this.mask, ...options }));
  }
  text(payload: Payload, options?: FrameOptions) {
    this.send(OP.text, payload, options);
  }
  binary(payload: Payload, options?: FrameOptions) {
    this.send(OP.binary, payload, options);
  }
  ping(payload?: Payload) {
    this.send(OP.ping, payload);
  }
  pong(payload?: Payload) {
    this.send(OP.pong, payload);
  }
  /** Sends a Close frame. The payload is empty if no code is given. */
  close(code?: number, reason?: Payload) {
    this.send(OP.close, code === undefined ? "" : closePayload(code, reason));
  }
  /** Encodes a frame for `write()`, masked the way this side masks. */
  frame(opcode: number, payload?: Payload, options?: FrameOptions) {
    return encodeFrame(opcode, payload, { mask: this.mask, ...options });
  }
  write(bytes: Payload) {
    this.socket.write(bytes);
  }
  /** Sends FIN. */
  end() {
    this.socket.end();
  }
  /** Sends RST. */
  reset() {
    this.socket.resetAndDestroy();
  }
  destroy() {
    this.socket.destroy();
  }

  /** The value of header `name` in `head`, or `undefined`. */
  header(name: string): string | undefined {
    return new RegExp(`^${name}: *(.*)$`, "im").exec(this.head)?.[1];
  }
  /** `head` split into lines. */
  get headLines(): string[] {
    return this.head.split("\r\n");
  }
}

export function acceptKey(key: string | undefined) {
  return crypto
    .createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/** The 101 a correct server sends for `connection.head`. `replace` overrides headers, and `null` drops one. */
export function response101(
  connection: RawSocket,
  extraHeaders: string[] = [],
  replace: Record<string, string | null> = {},
): string {
  const headers: Record<string, string | null> = {
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Accept": acceptKey(connection.header("sec-websocket-key")),
    ...replace,
  };
  const lines = Object.entries(headers).flatMap(([name, value]) => (value === null ? [] : [`${name}: ${value}`]));
  return ["HTTP/1.1 101 Switching Protocols", ...lines, ...extraHeaders, "", ""].join("\r\n");
}

export type PeerOptions = {
  /** Extra header lines for the 101. */
  headers?: string[];
  /** Bytes sent in the same write as the 101. */
  afterUpgrade?: Buffer;
  /** Replaces the 101. Returns the bytes to send, or `null` to send nothing (it can still write to the socket). */
  respond?: (connection: RawSocket) => string | Buffer | null;
  /** Use a TLS server with the `harness` certificate. */
  secure?: boolean;
  /** Extra options for that TLS server. */
  tls?: tls.TlsOptions;
  /** Listen on this unix socket path. */
  path?: string;
};

/** A raw server for `new WebSocket(peer.url)`. */
export async function createPeer(options: PeerOptions = {}) {
  const connections: RawSocket[] = [];
  const sockets = new Set<net.Socket>();
  const waiters: (() => void)[] = [];
  let nextConnectionIndex = 0;

  const onConnection = (socket: net.Socket) => {
    sockets.add(socket);
    const connection = new RawSocket(socket, false);
    let head: Buffer | null = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      if (head === null) return connection.push(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      const rest = head.subarray(end + 4);
      connection.head = head.subarray(0, end).toString("latin1");
      head = null;
      connections.push(connection);
      const response = options.respond ? options.respond(connection) : response101(connection, options.headers);
      if (response !== null) {
        socket.write(options.afterUpgrade ? Buffer.concat([Buffer.from(response), options.afterUpgrade]) : response);
      }
      for (const resolve of waiters.splice(0)) resolve();
      if (rest.length) connection.push(rest);
    });
  };

  const server = options.secure
    ? tls.createServer({ ...harnessTls, allowHalfOpen: true, ...options.tls }, onConnection)
    : net.createServer({ allowHalfOpen: true }, onConnection);
  // Also track raw TCP sockets, so a client that aborts during the TLS handshake still gets destroyed.
  server.on("connection", socket => sockets.add(socket));
  if (options.path) server.listen(options.path);
  else server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = options.path ? 0 : (server.address() as net.AddressInfo).port;

  return {
    server,
    port,
    url: options.path ? `ws+unix:${options.path}` : `${options.secure ? "wss" : "ws"}://127.0.0.1:${port}`,
    /** Every connection whose request head has arrived. */
    connections,
    /** The next connection this method has not returned yet. Waits for its request head. */
    async connection(): Promise<RawSocket> {
      while (nextConnectionIndex >= connections.length) await new Promise<void>(resolve => waiters.push(resolve));
      return connections[nextConnectionIndex++];
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

/** A port with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
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

export type RequestOptions = {
  path?: string;
  method?: string;
  /** Merged over the headers of a valid upgrade request. A `null` value drops the header. */
  headers?: Record<string, string | null>;
  /** Sent instead of the upgrade request. */
  raw?: string | Buffer;
  /** Bytes sent in the same write as the request. */
  trailingBytes?: Buffer;
  secure?: boolean;
  alpn?: string[];
  /** Connect to this unix socket path. */
  socketPath?: string;
  /** Keep this side open after the server sends FIN. By default a FIN is answered with a FIN. */
  allowHalfOpen?: boolean;
};

export function upgradeRequest({ path = "/", method = "GET", headers = {} }: RequestOptions = {}): string {
  const merged: Record<string, string | null> = {
    Host: "localhost",
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": KEY,
    "Sec-WebSocket-Version": "13",
    ...headers,
  };
  const lines = Object.entries(merged).flatMap(([name, value]) => (value === null ? [] : [`${name}: ${value}`]));
  return [`${method} ${path} HTTP/1.1`, ...lines, "", ""].join("\r\n");
}

export type RawResponse = { status: string; headers: string[]; body: string };

/**
 * A raw client for a `WebSocketServer`. `response` resolves with the HTTP response: after the head for a 101,
 * otherwise once the body is complete. `headers` omits `Date`.
 */
export class RawClient extends RawSocket {
  response: Promise<RawResponse>;

  constructor(port: number, options: RequestOptions = {}) {
    super(
      options.secure
        ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: options.alpn })
        : options.socketPath
          ? net.connect(options.socketPath)
          : net.connect({ port, host: "127.0.0.1", allowHalfOpen: options.allowHalfOpen }),
      true,
    );
    const { socket } = this;
    const response = Promise.withResolvers<RawResponse>();
    this.response = response.promise;
    let pending: Buffer = Buffer.alloc(0);
    let parsed: (RawResponse & { length: number }) | undefined;
    let upgraded = false;

    const finish = () => {
      if (upgraded) return;
      if (parsed)
        response.resolve({ status: parsed.status, headers: parsed.headers, body: pending.toString("latin1") });
      else response.resolve({ status: "no response", headers: [], body: pending.toString("latin1") });
    };
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("data", (chunk: Buffer) => {
      if (upgraded) return this.push(chunk);
      pending = Buffer.concat([pending, chunk]);
      if (!parsed) {
        const end = pending.indexOf("\r\n\r\n");
        if (end === -1) return;
        this.head = pending.subarray(0, end).toString("latin1");
        pending = pending.subarray(end + 4);
        const [status, ...headers] = this.head.split("\r\n");
        const length = this.header("content-length");
        parsed = { status, headers: headers.filter(h => !/^date:/i.test(h)), body: "", length: length ? +length : -1 };
        if (status.startsWith("HTTP/1.1 101 ")) {
          upgraded = true;
          response.resolve({ status, headers: parsed.headers, body: "" });
          if (pending.length) this.push(pending);
          return;
        }
      }
      if (parsed.length >= 0 && pending.length >= parsed.length) finish();
    });
    socket.once(options.secure ? "secureConnect" : "connect", () => {
      const request = Buffer.from(options.raw ?? upgradeRequest(options));
      socket.write(options.trailingBytes ? Buffer.concat([request, options.trailingBytes]) : request);
    });
  }

  /** `[status line, ...header lines]`, followed by `""` and the body when the response is not a 101. */
  async responseLines(): Promise<string[]> {
    const { status, headers, body } = await this.response;
    return status.startsWith("HTTP/1.1 101 ") ? [status, ...headers] : [status, ...headers, "", body];
  }
}

/**
 * A raw client that reads consecutive HTTP responses from its connection, which can be any Duplex. It never sends
 * anything on its own. Bytes after a 101 are parsed as frames.
 */
export class HttpClient extends RawSocket {
  #responses: [status: string, body: string][] = [];
  #nextResponseIndex = 0;
  #done = false;
  #wake = () => {};

  constructor(socket: Duplex) {
    super(socket as net.Socket, true);
    let pending = Buffer.alloc(0);
    let upgraded = false;
    socket.on("data", (chunk: Buffer) => {
      if (upgraded) return this.push(chunk);
      pending = Buffer.concat([pending, chunk]);
      for (let end; !upgraded && (end = pending.indexOf("\r\n\r\n")) !== -1;) {
        this.head = pending.subarray(0, end).toString("latin1");
        const bodyEnd = end + 4 + Number(this.header("content-length") ?? 0);
        if (pending.length < bodyEnd) break;
        this.#responses.push([this.headLines[0], pending.subarray(end + 4, bodyEnd).toString("latin1")]);
        pending = pending.subarray(bodyEnd);
        upgraded = this.head.startsWith("HTTP/1.1 101 ");
      }
      if (upgraded && pending.length) this.push(pending);
      this.#wake();
    });
    this.ended.then(() => {
      this.#done = true;
      this.#wake();
    });
  }

  /** The next response's status line and body, or `"EOF"`. */
  async nextResponse() {
    while (this.#nextResponseIndex >= this.#responses.length) {
      if (this.#done) return "EOF";
      await new Promise<void>(resolve => (this.#wake = resolve));
    }
    return this.#responses[this.#nextResponseIndex++];
  }
}

/** Calls `server.listen(0, "127.0.0.1")` and resolves with the port. */
export async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
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
 * whatever keeps the event loop alive. The script has `WebSocket`, `WebSocketServer`, `createWebSocketStream`, `show`
 * and `showError` in scope. An uncaught exception prints `uncaught <error>` and the process keeps running, as with any
 * 'uncaughtException' listener. `env` is merged into the child's environment. Use with `test.concurrent` and
 * `scriptTimeout`.
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
