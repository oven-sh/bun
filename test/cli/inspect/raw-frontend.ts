import crypto from "node:crypto";
import net from "node:net";

/**
 * An inspector frontend on a raw TCP socket.
 *
 * A `WebSocket` always reads. This one can stop (`pause()`), so the inspected
 * process cannot write to it, and it shows how the connection ended: with the
 * server's close frame or without one.
 */
export class RawFrontend {
  /** The `<n>` of each `console.log("#<n> ...")` line that arrived. */
  readonly lines = new Set<number>();
  /** The close frame of the server, if it sent one. */
  closeFrame: { code: number; reason: string } | undefined;
  ended = false;

  #socket: net.Socket;
  // WebSocket frames, or the 4-byte length prefix of the socket transport.
  #webSocket: boolean;
  #nextId = 1;
  #responses = new Map<number, (message: any) => void>();
  #waiters: (() => void)[] = [];
  // The frame that is arriving: its header bytes, then its payload. Console lines are large
  // and only their start matters, so an event keeps its first bytes and drops the rest.
  #header: number[] = [];
  #opcode = 0;
  #payloadLeft = -1;
  #start = Buffer.alloc(512);
  #startLength = 0;
  #rest: Buffer[] = [];

  private constructor(socket: net.Socket, webSocket: boolean) {
    this.#socket = socket;
    this.#webSocket = webSocket;
    socket.on("error", () => {});
    socket.on("close", () => {
      this.ended = true;
      this.#wake();
    });
  }

  /** Connects to the WebSocket server of `bun --inspect` or `inspector.open()`. */
  static async connect(url: string | URL): Promise<RawFrontend> {
    const { hostname, port, pathname, host } = new URL(url);
    const socket = net.connect(Number(port), hostname);
    await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
    const frontend = new RawFrontend(socket, true);
    socket.write(
      `GET ${pathname} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
    let head: Buffer | undefined = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      if (head) {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        chunk = head.subarray(end + 4);
        head = undefined;
      }
      frontend.#read(chunk);
      frontend.#wake();
    });
    await frontend.until(() => !head, "the handshake response");
    return frontend;
  }

  /** Takes a connection that `bun --inspect=tcp://` or `--inspect=unix:` dialed. */
  static accept(socket: net.Socket): RawFrontend {
    const frontend = new RawFrontend(socket, false);
    socket.on("data", (chunk: Buffer) => {
      frontend.#read(chunk);
      frontend.#wake();
    });
    return frontend;
  }

  /** Resolves when `condition()` holds. Rejects if the connection ends first. */
  async until(condition: () => boolean, what: string): Promise<void> {
    while (!condition()) {
      if (this.ended) throw new Error(`the connection ended before ${what}`);
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }

  /** Sends a command and resolves with the response. The response only arrives while reading. */
  send(method: string, params: object = {}): Promise<any> {
    const id = this.#nextId++;
    const payload = Buffer.from(JSON.stringify({ id, method, params }));
    if (this.#webSocket) {
      const mask = crypto.randomBytes(4);
      const header =
        payload.length < 126 ? [0x81, 0x80 | payload.length] : [0x81, 0xfe, payload.length >> 8, payload.length & 255];
      this.#socket.write(Buffer.concat([Buffer.from(header), mask, payload.map((byte, i) => byte ^ mask[i & 3])]));
    } else {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(payload.length);
      this.#socket.write(Buffer.concat([header, payload]));
    }
    return new Promise(resolve => this.#responses.set(id, resolve));
  }

  pause(): void {
    this.#socket.pause();
  }

  resume(): void {
    this.#socket.resume();
  }

  /** Reads one chunk, at most 512 KB, and stops again. */
  readChunk(): Promise<void> {
    return new Promise(resolve => {
      this.#socket.once("data", () => {
        this.#socket.pause();
        resolve();
      });
      this.#socket.resume();
    });
  }

  close(): void {
    this.#socket.destroy();
  }

  #wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  #read(chunk: Buffer): void {
    let offset = 0;
    // `#payloadLeft === 0`: a frame with no payload whose header ended the chunk.
    while (offset < chunk.length || this.#payloadLeft === 0) {
      if (this.#payloadLeft === -1) {
        const header = this.#header;
        header.push(chunk[offset++]);
        if (this.#webSocket) {
          // 2 bytes, then a 16-bit or 64-bit length if the 7-bit one says so. The server does not mask.
          const extended = header.length < 2 ? -1 : (header[1] & 127) === 126 ? 2 : (header[1] & 127) === 127 ? 8 : 0;
          if (extended === -1 || header.length < 2 + extended) continue;
          this.#opcode = header[0] & 15;
          this.#payloadLeft = extended ? header.slice(2).reduce((sum, byte) => sum * 256 + byte, 0) : header[1] & 127;
        } else {
          if (header.length < 4) continue;
          this.#opcode = 1;
          this.#payloadLeft = header.reduce((sum, byte) => sum * 256 + byte, 0);
        }
        this.#startLength = 0;
        this.#rest = [];
        this.#header = [];
      }
      const piece = chunk.subarray(offset, offset + Math.min(this.#payloadLeft, chunk.length - offset));
      const toStart = Math.min(this.#start.length - this.#startLength, piece.length);
      piece.copy(this.#start, this.#startLength, 0, toStart);
      this.#startLength += toStart;
      if (toStart < piece.length && !this.#isEvent()) this.#rest.push(piece.subarray(toStart));
      offset += piece.length;
      this.#payloadLeft -= piece.length;
      if (this.#payloadLeft === 0) {
        this.#payloadLeft = -1;
        this.#frame(this.#opcode, Buffer.concat([this.#start.subarray(0, this.#startLength), ...this.#rest]));
      }
    }
  }

  #isEvent(): boolean {
    return this.#start.toString("latin1", 0, 10) === '{"method":';
  }

  #frame(opcode: number, payload: Buffer): void {
    if (opcode === 8) {
      this.closeFrame = { code: payload.readUInt16BE(0), reason: payload.toString("utf8", 2) };
      return;
    }
    if (opcode !== 1) return;
    if (this.#isEvent()) {
      // Console.messageAdded has the line in "text", Runtime.consoleAPICalled in the first "value".
      const line = payload.toString("latin1").match(/"(?:text|value)":"#(\d+) /);
      if (line) this.lines.add(Number(line[1]));
      return;
    }
    const message = JSON.parse(payload.toString("utf8"));
    this.#responses.get(message.id)?.(message);
    this.#responses.delete(message.id);
  }
}
