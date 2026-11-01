// A raw WebSocket peer for tests: a plain TCP (or TLS) socket that does the upgrade and framing by hand, so a test
// controls every byte the implementation under test receives and sees every byte it sends. Works as a server
// (`createPeer`) or a client (`RawClient`, `HttpClient`). Doesn't depend on any WebSocket implementation.
import { tls as harnessTls } from "harness";
import crypto from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";

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
export const syncPrefix = "\0sync";

export type Payload = string | Uint8Array;
export type FrameOptions = {
  fin?: boolean;
  rsv1?: boolean;
  rsv2?: boolean;
  rsv3?: boolean;
  mask?: boolean;
  /** The key of a masked frame; unused without `mask`. Without one, a payload above 64 KiB gets the all-zero key. */
  key?: readonly [number, number, number, number];
  /** Overrides the length in the frame header, to lie about the payload size. */
  declaredLength?: number;
};

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
  const length = options.declaredLength ?? body.length;
  const head = [(fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | (rsv2 ? 0x20 : 0) | (rsv3 ? 0x10 : 0) | opcode];
  const maskBit = mask ? 0x80 : 0;
  if (length < 126) {
    head.push(maskBit | length);
  } else if (length < 65536) {
    head.push(maskBit | 126, length >> 8, length & 255);
  } else {
    const extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(BigInt(length));
    head.push(maskBit | 127, ...extended);
  }
  if (!mask) return Buffer.concat([Buffer.from(head), body]);
  // An all-zero mask key leaves the payload unchanged, so large payloads skip the XOR loop.
  if (!options.key && body.length > 65536) return Buffer.concat([Buffer.from(head), Buffer.alloc(4), body]);
  const key = options.key ?? [0x11, 0x22, 0x33, 0x44];
  const masked = Buffer.allocUnsafe(body.length);
  for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ key[i & 3];
  return Buffer.concat([Buffer.from(head), Buffer.from(key), masked]);
}

export function closePayload(code: number, reason: Payload = ""): Buffer {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(code);
  return Buffer.concat([head, Buffer.from(reason as any)]);
}

export function showBytes(bytes: Buffer, limit = 48): string {
  if (bytes.length === 0) return "";
  if (bytes.length > limit) return `${bytes.length} bytes`;
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
  return formatFrame(frame, 48);
}

/** `showFrame()` without the 48-byte limit: long payloads are printed in full. */
export function showFullFrame(frame: Frame): string {
  return formatFrame(frame, Infinity);
}

function formatFrame(frame: Frame, limit: number): string {
  const parts = [opcodeNames[frame.opcode] ?? `opcode${frame.opcode}`];
  if (frame.opcode === OP.close && frame.length >= 2) {
    parts.push(String(frame.payload.readUInt16BE(0)));
    if (frame.length > 2) parts.push(showBytes(frame.payload.subarray(2), limit));
  } else if (frame.length > limit) {
    parts.push(`${frame.length} bytes`);
  } else if (frame.length) {
    parts.push(showBytes(frame.payload, limit));
  }
  if (!frame.fin) parts.push("!fin");
  if (frame.rsv & 4) parts.push("rsv1");
  if (frame.rsv & 2) parts.push("rsv2");
  if (frame.rsv & 1) parts.push("rsv3");
  if (frame.hasWrongMask) parts.push(frame.masked ? "masked" : "unmasked");
  return parts.join(" ");
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

  /** Number of trailing bytes received that don't form a complete frame yet. */
  get unparsedBytes() {
    return this.#size;
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

  /** Skips unread frames up to the first Close frame, echoes it, and sends FIN. */
  async echoClose() {
    let frame;
    do frame = await this.nextFrame();
    while (frame && frame.opcode !== OP.close);
    if (frame) this.socket.end(this.frame(OP.close, frame.payload));
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
  [Symbol.dispose]() {
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
  /** Defaults to `true`: only the test ends the connection. `false` replies to the client's FIN with a FIN. */
  allowHalfOpen?: boolean;
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

  const { allowHalfOpen = true } = options;
  const server = options.secure
    ? tls.createServer({ ...harnessTls, allowHalfOpen, ...options.tls }, onConnection)
    : net.createServer({ allowHalfOpen }, onConnection);
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
  /** Extra options for `tls.connect()`. */
  tls?: tls.ConnectionOptions;
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
        ? tls.connect({
            port,
            host: "127.0.0.1",
            rejectUnauthorized: false,
            ALPNProtocols: options.alpn,
            ...options.tls,
          })
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

  /** Connects and resolves once the 101 arrives. Rejects on any other response. */
  static async upgrade(port: number, options?: RequestOptions): Promise<RawClient> {
    const client = new RawClient(port, options);
    const { status } = await client.response;
    if (status.startsWith("HTTP/1.1 101 ")) return client;
    client.destroy();
    throw new Error(`upgrade failed: ${status}`);
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
