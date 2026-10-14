// Shared by the ws-*-compat tests.
//
// The other end of every connection is a plain TCP (or TLS) socket that does the upgrade and the framing by hand, so
// a test chooses each byte the `ws` socket receives and reads each byte it sends.
//
// Every block runs on `implementations`: Bun's built-in `ws` and the npm package from test/node_modules. The npm rows
// prove that an expectation is what npm ws does. The expectations were recorded on Node.js 26 with ws 8.18.3.
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

// `autoPong` and `finishRequest` are newer than the installed @types/ws.
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
    /** A client frame without a mask, or a server frame with one. */
    public wrongMask: boolean,
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

  /** Unmasked on first use: a test that counts 1 MiB frames does not pay for it. */
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
  // A key of zeros leaves a large payload as it is, which saves the loop.
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
  // Text only when that loses nothing and shows no control character.
  if (Buffer.from(text).equals(bytes) && !/[\0-\x1f\x7f�]/.test(text)) return JSON.stringify(text);
  return "0x" + bytes.toString("hex");
}

/**
 * A frame as one line: `text "hi"`, `binary 0x0102`, `binary 200 bytes`, `ping`, `close`, `close 1000`,
 * `close 4000 "bye"`. Then `!fin`, `rsv1` (`rsv2`, `rsv3`) where they apply, and `unmasked` for a client frame without
 * a mask, `masked` for a server frame with one.
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
  if (frame.wrongMask) parts.push(frame.masked ? "masked" : "unmasked");
  return parts.join(" ");
}

/** A value as one line: `"hi"`, `string(200)`, `Buffer("hi")`, `Buffer(0x0102)`, `Buffer()`, `ArrayBuffer(0x01)`, `[Buffer(0x01)]`, `Blob(2)`. */
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

/** `RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE`. Port numbers become PORT. */
export function showError(error: any): string {
  if (!(error instanceof Error)) return `not an Error: ${error?.constructor?.name} ${JSON.stringify(error?.message)}`;
  const message = error.message.replace(/((?:127\.0\.0\.1|localhost|\[::1\]):)\d+/g, "$1PORT");
  return (
    `${error.constructor.name} ${JSON.stringify(message)}` + ((error as any).code ? ` ${(error as any).code}` : "")
  );
}

/** What `fn` returns, through `show`, or `throws <error>`. */
export function attempt(fn: () => unknown): string {
  try {
    return show(fn());
  } catch (error) {
    return "throws " + showError(error);
  }
}

/**
 * One end of a TCP connection that speaks WebSocket by hand. `frames` and `tcp` grow as things arrive; `next()` reads
 * them in order.
 */
export class RawSocket {
  /** The HTTP head the other side sent: the request for a raw server, the response for a raw client. */
  head = "";
  /** Every frame received so far. */
  frames: Frame[] = [];
  /** `"end"`, `"error ECONNRESET"`, `"close"`, in order. */
  tcp: string[] = [];
  /** The other side sent FIN (or the connection is gone). */
  ended: Promise<void>;
  /** The connection is gone. */
  closed: Promise<void>;

  #chunks: Buffer[] = [];
  #size = 0;
  #needed = 2;
  #read = 0;
  #done = false;
  #waiting: (() => void)[] = [];
  #syncs = 0;

  constructor(
    public socket: net.Socket,
    private mask: boolean,
  ) {
    const ended = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    this.ended = ended.promise;
    this.closed = closed.promise;
    socket.on("error", (error: NodeJS.ErrnoException) => this.tcp.push("error " + error.code));
    socket.on("end", () => {
      this.tcp.push("end");
      this.#done = true;
      ended.resolve();
      this.#wake();
    });
    socket.on("close", () => {
      this.tcp.push("close");
      this.#done = true;
      ended.resolve();
      closed.resolve();
      this.#wake();
    });
  }

  #wake() {
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  /** Feeds bytes that follow the HTTP head. */
  push(chunk: Buffer) {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    if (this.#size < this.#needed) return;
    let buffer = this.#chunks.length === 1 ? chunk : Buffer.concat(this.#chunks);
    for (;;) {
      this.#needed = 2;
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
      this.#needed = offset + length;
      if (buffer.length < this.#needed) break;
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

  /** The next frame nobody has read yet, or `undefined` once the other side has ended the connection. */
  async nextFrame(): Promise<Frame | undefined> {
    for (;;) {
      if (this.#read < this.frames.length) return this.frames[this.#read++];
      if (this.#done) return undefined;
      await new Promise<void>(resolve => this.#waiting.push(resolve));
    }
  }

  /** `nextFrame()` through `showFrame`, or `"EOF"`. */
  async next(): Promise<string> {
    const frame = await this.nextFrame();
    return frame ? showFrame(frame) : "EOF";
  }

  /** The next `count` frames. */
  async take(count: number): Promise<string[]> {
    const lines: string[] = [];
    while (lines.length < count) lines.push(await this.next());
    return lines;
  }

  /** Every frame nobody has read yet, up to the end of the connection. */
  async rest(): Promise<string[]> {
    const lines: string[] = [];
    for (let frame; (frame = await this.nextFrame());) lines.push(showFrame(frame));
    return lines;
  }

  /**
   * A round trip through an OPEN `ws` socket that answers pings: sends a Ping and waits for its Pong. When it
   * resolves, the socket has handled everything this side sent before, and everything it sent in response has
   * arrived. Returns the frames that came before the Pong, so `[]` means "it sent nothing". `watch()` hides this Ping.
   */
  async roundTrip(): Promise<string[]> {
    const payload = syncPrefix + ++this.#syncs;
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
  /** A Close frame. Without a code its payload is empty. */
  close(code?: number, reason?: Payload) {
    this.send(OP.close, code === undefined ? "" : closePayload(code, reason));
  }
  /** Frames for `write()`, masked as this side masks. */
  frame(opcode: number, payload?: Payload, options?: FrameOptions) {
    return encodeFrame(opcode, payload, { mask: this.mask, ...options });
  }
  write(bytes: Payload) {
    this.socket.write(bytes);
  }
  /** FIN. */
  end() {
    this.socket.end();
  }
  /** RST. */
  reset() {
    this.socket.resetAndDestroy();
  }
  destroy() {
    this.socket.destroy();
  }

  /** The value of a header of `head`, or `undefined`. */
  header(name: string): string | undefined {
    return new RegExp(`^${name}: *(.*)$`, "im").exec(this.head)?.[1];
  }
  /** The lines of `head`. */
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

/** The 101 a correct server sends for `connection.head`. `replace` changes or (with `null`) drops one of its headers. */
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
  /** Extra header lines of the 101. */
  headers?: string[];
  /** Bytes that go out in the same write as the 101. */
  afterUpgrade?: Buffer;
  /** Replaces the 101: the bytes to answer with, or `null` to answer nothing (the callback may use the socket). */
  respond?: (connection: RawSocket) => string | Buffer | null;
  /** A TLS server with the certificate of `harness`. */
  secure?: boolean;
  /** Listen on this unix socket path. */
  path?: string;
};

/** A raw server for `new WebSocket(peer.url)`. */
export async function createPeer(options: PeerOptions = {}) {
  const connections: RawSocket[] = [];
  const sockets = new Set<net.Socket>();
  const waiting: (() => void)[] = [];
  let taken = 0;

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
      for (const resolve of waiting.splice(0)) resolve();
      if (rest.length) connection.push(rest);
    });
  };

  const server = options.secure
    ? tls.createServer({ ...harnessTls, allowHalfOpen: true }, onConnection)
    : net.createServer({ allowHalfOpen: true }, onConnection);
  // Also the TCP socket of a client that gives up during the TLS handshake.
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
    /** The next connection nobody has taken yet, once its request head has arrived. */
    async connection(): Promise<RawSocket> {
      while (taken >= connections.length) await new Promise<void>(resolve => waiting.push(resolve));
      return connections[taken++];
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

/** A port on which nothing listens. */
export async function closedPort(): Promise<number> {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
}

/**
 * Records the events of a `ws` socket as lines, each with the readyState inside the listener:
 * `upgrade 101 rs=0`, `open rs=1`, `message Buffer("hi") text rs=1`, `message Buffer(0x01) binary rs=1`,
 * `ping Buffer("x") rs=1`, `error Error "socket hang up" ECONNRESET rs=2`, `close 1006 Buffer() rs=3`.
 * Every argument of 'close' is shown.
 */
export function watch(ws: Ws.WebSocket, events: string[] = []) {
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

/** The arguments of the next `name` event. Unlike `events.once()` an 'error' event does not reject it. */
export function event(emitter: NodeJS.EventEmitter, name: string): Promise<any[]> {
  return new Promise(resolve => emitter.once(name, (...args) => resolve(args)));
}

function silence(ws: Ws.WebSocket | undefined) {
  if (!ws) return;
  try {
    ws.on("error", () => {});
    ws.terminate();
  } catch {}
}

/**
 * `new WebSocket()` to a raw server. `events` is `watch(ws)`. Does not wait for anything but the request: `opened`
 * and `closed` are the 'open' and 'close' events.
 */
export async function dial({ WebSocket }: WsModule, options: ClientOptions = {}, peerOptions: PeerOptions = {}) {
  const peer = await createPeer(peerOptions);
  const { protocols, path = "", ...rest } = options;
  const ws = new WebSocket(peer.url + path, protocols, rest);
  const events = watch(ws);
  const opened = new Promise<void>(resolve => ws.on("open", () => resolve()));
  const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
  return {
    peer,
    ws,
    events,
    opened,
    closed,
    async [Symbol.asyncDispose]() {
      silence(ws);
      await peer[Symbol.asyncDispose]();
    },
  };
}

/** An OPEN client socket and `conn`, the raw server's end of its connection. */
export async function openClient(implementation: WsModule, options?: ClientOptions, peerOptions?: PeerOptions) {
  const client = await dial(implementation, options, peerOptions);
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
  /** Added to, or replacing, the headers of a correct upgrade request. `null` drops one. */
  headers?: Record<string, string | null>;
  /** Sent in place of the upgrade request. */
  raw?: string | Buffer;
  /** Bytes that go out in the same write as the request. */
  afterRequest?: Buffer;
  secure?: boolean;
  alpn?: string[];
  /** Connect to this unix socket path. */
  socketPath?: string;
  /** Keep this side open when the server ends its own. By default a FIN is answered with a FIN. */
  allowHalfOpen?: boolean;
};

export function upgradeRequest({ path = "/", method = "GET", headers = {} }: RequestOptions = {}): string {
  const all: Record<string, string | null> = {
    Host: "localhost",
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Key": KEY,
    "Sec-WebSocket-Version": "13",
    ...headers,
  };
  const lines = Object.entries(all).flatMap(([name, value]) => (value === null ? [] : [`${name}: ${value}`]));
  return [`${method} ${path} HTTP/1.1`, ...lines, "", ""].join("\r\n");
}

export type RawResponse = { status: string; headers: string[]; body: string };

/**
 * A raw client for a `WebSocketServer`. `response` resolves with the HTTP response: at the end of the head for a 101,
 * else when the body is complete. `Date` is left out of `headers`.
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
      socket.write(options.afterRequest ? Buffer.concat([request, options.afterRequest]) : request);
    });
  }

  /** `[status line, ...header lines]`, and the body as a last element when the response is not a 101. */
  async responseLines(): Promise<string[]> {
    const { status, headers, body } = await this.response;
    return status.startsWith("HTTP/1.1 101 ") ? [status, ...headers] : [status, ...headers, "", body];
  }
}

/**
 * A raw client that reads one HTTP response after the other from its connection, which may be any Duplex. It sends
 * nothing by itself. What follows a 101 is frames.
 */
export class HttpClient extends RawSocket {
  #answers: [status: string, body: string][] = [];
  #taken = 0;
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
        this.#answers.push([this.headLines[0], pending.subarray(end + 4, bodyEnd).toString("latin1")]);
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

  /** The status line and the body of the next response, or `"EOF"`. */
  async answer() {
    while (this.#taken >= this.#answers.length) {
      if (this.#done) return "EOF";
      await new Promise<void>(resolve => (this.#wake = resolve));
    }
    return this.#answers[this.#taken++];
  }
}

/** `server.listen(0, "127.0.0.1")`, resolved with the port. */
export async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as net.AddressInfo).port;
}

/** A listening `WebSocketServer({ port: 0 })`. `connect()` dials it with a raw client. Disposal drops every connection. */
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
      for (const ws of sockets) silence(ws);
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}

/**
 * `server` (of node:http, https, http2, net ...) listening on a port of its own, or on a unix socket: for the `server`
 * and `noServer` modes of a WebSocketServer. `connect()` dials it with a raw client, over TLS if the server wants
 * that. `open(wss)` is what `openServer()` gives, for a WebSocketServer that gets this server's upgrades. Disposal
 * drops every connection.
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
  const keep = <Client extends RawSocket>(client: Client) => (clients.push(client), client);
  return {
    server,
    /** Read for each use: a test may make the server listen again. */
    get port() {
      return socketPath ? 0 : (server.address() as net.AddressInfo).port;
    },
    connect(request?: RequestOptions) {
      return keep(new RawClient(this.port, { socketPath, secure, ...request }));
    },
    connectHttp() {
      return keep(new HttpClient(net.connect(this.port, "127.0.0.1")));
    },
    async open(wss: Ws.WebSocketServer, request?: RequestOptions) {
      servers.add(wss);
      const connection = once(wss, "connection");
      const client = this.connect(request);
      const [ws, req] = (await connection) as [Ws.WebSocket, IncomingMessage];
      sockets.push(ws);
      const events = watch(ws);
      const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
      await client.response;
      return { wss, ws, req, client, events, closed };
    },
    async [Symbol.asyncDispose]() {
      for (const client of clients) client.destroy();
      for (const ws of sockets) silence(ws);
      for (const wss of servers) wss.close();
      for (const socket of accepted) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

/**
 * An OPEN server socket (`ws`, with its upgrade request `req`) and `client`, the raw client at the other end.
 * `events` is `watch(ws)`, `closed` its 'close' event.
 */
export async function openServer(implementation: WsModule, options?: Ws.ServerOptions, request?: RequestOptions) {
  const server = await createServer(implementation, options);
  try {
    const connection = once(server.wss, "connection");
    const client = server.connect(request);
    const [ws, req] = (await connection) as [Ws.WebSocket, IncomingMessage];
    const events = watch(ws);
    const closed = new Promise<void>(resolve => ws.on("close", () => resolve()));
    await client.response;
    return { ...server, ws, req, client, events, closed, [Symbol.asyncDispose]: server[Symbol.asyncDispose] };
  } catch (error) {
    await server[Symbol.asyncDispose]();
    throw error;
  }
}

/** The third argument of a test that uses `runScript()`: a debug build on a busy machine takes seconds to start. */
export const scriptTimeout = 90_000;

/**
 * Runs `script` in its own process, for what one process cannot test twice: an uncaught exception, the exit code,
 * what keeps the event loop alive. The script sees `WebSocket`, `WebSocketServer`, `createWebSocketStream`, `show`
 * and `showError`; an uncaught exception prints `uncaught <error>` and the process goes on, as with any
 * 'uncaughtException' listener. `env` reaches it as `process.env`. Use with `test.concurrent` and `scriptTimeout`.
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
