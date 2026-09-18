import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

// A peer that raises SETTINGS_INITIAL_WINDOW_SIZE keeps enforcing its old receive
// window until it has processed our SETTINGS ACK (RFC 9113 §6.5.3). Any DATA the
// enlarged window unblocks must therefore be written after the ACK, or nghttp2 and
// grpc-go count it against the old window and reset the stream with
// FLOW_CONTROL_ERROR. This test stalls a client on a 65535-byte stream window,
// raises the window via SETTINGS, and asserts no DATA arrives between that
// SETTINGS frame and the client's ACK.

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const INITIAL_WINDOW = 65535;
const RAISED_WINDOW = 1024 * 1024;
const BODY = 256 * 1024;

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId & 0x7fffffff, 5);
  return Buffer.concat([header, payload]);
}

function settingsFrame(entries: Array<[number, number]>): Buffer {
  const payload = Buffer.alloc(entries.length * 6);
  entries.forEach(([id, value], i) => {
    payload.writeUInt16BE(id, i * 6);
    payload.writeUInt32BE(value, i * 6 + 2);
  });
  return frame(0x4, 0, 0, payload);
}

test("client sends the SETTINGS ACK before DATA unblocked by a larger INITIAL_WINDOW_SIZE", async () => {
  const { promise: done, resolve: bodyReceived, reject: failed } = Promise.withResolvers<void>();
  let raised = false;
  // The server sends two SETTINGS frames (the initial one and the raise), so the
  // raise is acknowledged by the second ACK. Matching ACKs by count matters: the
  // client may ACK the initial SETTINGS late, after DATA already flowed.
  let acksReceived = 0;
  let dataBeforeAck = 0;
  let framesBeforeAck = 0;
  let dataTotal = 0;

  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    let prefaceStripped = false;
    socket.on("error", () => {});

    // A default 65535 stream window but a huge connection window, so the
    // per-stream window is the only thing that can block the client.
    socket.write(
      settingsFrame([
        [0x4, INITIAL_WINDOW],
        [0x5, 16384],
      ]),
    );
    const windowUpdate = Buffer.alloc(4);
    windowUpdate.writeUInt32BE(64 * 1024 * 1024);
    socket.write(frame(0x8, 0, 0, windowUpdate));

    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceStripped) {
        if (buf.length < PREFACE.length) return;
        buf = buf.subarray(PREFACE.length);
        prefaceStripped = true;
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        const type = buf.readUInt8(3);
        const flags = buf.readUInt8(4);
        if (buf.length < 9 + len) break;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);

        if (type === 0x0) {
          // DATA. The body is never read and no stream WINDOW_UPDATE is ever
          // sent, so the client stalls once it exhausts the 65535-byte window.
          // At that point raise the window via SETTINGS: every DATA frame that
          // arrives after this SETTINGS and before the client's ACK was sent
          // against a window the server has not applied yet.
          dataTotal += len;
          // At raise time the 65535-byte window is fully exhausted, so any DATA
          // that arrives between the raise and its ACK uses the unacknowledged
          // enlarged window.
          if (raised && acksReceived < 2) {
            dataBeforeAck += len;
            framesBeforeAck++;
          }
          if (!raised && dataTotal >= INITIAL_WINDOW) {
            raised = true;
            socket.write(settingsFrame([[0x4, RAISED_WINDOW]]));
          }
          if (dataTotal >= BODY) bodyReceived();
        } else if (type === 0x4) {
          // SETTINGS
          if (flags & 0x1) {
            acksReceived++;
          } else {
            socket.write(frame(0x4, 0x1, 0));
          }
        } else if (type === 0x6 && !(flags & 0x1)) {
          socket.write(frame(0x6, 0x1, 0, payload));
        }
      }
    });
  });

  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => onListening());
  await listening;
  const { port } = server.address() as net.AddressInfo;

  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", failed);
  try {
    const req = client.request({ ":method": "POST", ":path": "/" });
    req.on("error", failed);
    req.write(Buffer.alloc(BODY, 0x61));

    await done;

    expect({ dataBeforeAck, framesBeforeAck }).toEqual({ dataBeforeAck: 0, framesBeforeAck: 0 });
    expect(dataTotal).toBe(BODY);
  } finally {
    client.destroy();
    server.close();
  }
});

// RFC 7541 §6.3: the limit on the peer's Dynamic Table Size Updates is the last
// SETTINGS_HEADER_TABLE_SIZE the peer ACKed. Until that ACK the peer still encodes
// against the previous value (4096 at the start of a connection), so the HPACK
// decoder's table follows the ACK, never the submission. These tests drive a raw
// h2c client against a `node:http2` server.
describe.concurrent("HPACK decoder table size follows the SETTINGS ACK", () => {
  const HEADERS = 0x1;
  const SETTINGS = 0x4;
  const GOAWAY = 0x7;
  const ACK = 0x1;
  const END_STREAM_END_HEADERS = 0x5;
  const SETTINGS_HEADER_TABLE_SIZE = 0x1;
  const COMPRESSION_ERROR = "GOAWAY 9";

  type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

  class RawClient {
    frames: Frame[] = [];
    #buf = Buffer.alloc(0);
    #waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void; reject: (e: Error) => void }> = [];

    constructor(readonly socket: net.Socket) {
      socket.on("error", () => {});
      socket.on("close", () => this.#waiters.splice(0).forEach(w => w.reject(new Error("connection closed"))));
      socket.on("data", chunk => {
        this.#buf = Buffer.concat([this.#buf, chunk]);
        while (this.#buf.length >= 9) {
          const length = this.#buf.readUIntBE(0, 3);
          if (this.#buf.length < 9 + length) break;
          const received: Frame = {
            type: this.#buf.readUInt8(3),
            flags: this.#buf.readUInt8(4),
            streamId: this.#buf.readUInt32BE(5) & 0x7fffffff,
            payload: this.#buf.subarray(9, 9 + length),
          };
          this.#buf = this.#buf.subarray(9 + length);
          this.frames.push(received);
          const i = this.#waiters.findIndex(w => w.pred(received));
          if (i !== -1) this.#waiters.splice(i, 1)[0].resolve(received);
        }
      });
    }

    waitFor(pred: (f: Frame) => boolean): Promise<Frame> {
      const existing = this.frames.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => this.#waiters.push({ pred, resolve, reject }));
    }

    /** The server's SETTINGS frame (not an ACK). With `tableSize`: the one that carries that HEADER_TABLE_SIZE. */
    serverSettings(tableSize?: number): Promise<Frame> {
      return this.waitFor(f => {
        if (f.type !== SETTINGS || (f.flags & ACK) !== 0) return false;
        if (tableSize === undefined) return true;
        for (let i = 0; i + 6 <= f.payload.length; i += 6) {
          if (f.payload.readUInt16BE(i) === SETTINGS_HEADER_TABLE_SIZE)
            return f.payload.readUInt32BE(i + 2) === tableSize;
        }
        return false;
      });
    }

    ackSettings() {
      this.socket.write(frame(SETTINGS, ACK, 0));
    }

    /** "response" once `streamId` is answered, or "GOAWAY <code>" if the connection was killed. */
    async outcome(streamId: number): Promise<string> {
      const f = await this.waitFor(f => (f.type === HEADERS && f.streamId === streamId) || f.type === GOAWAY);
      return f.type === HEADERS ? "response" : `GOAWAY ${f.payload.readUInt32BE(4)}`;
    }

    request(streamId: number, block: Buffer): Promise<string> {
      this.socket.write(frame(HEADERS, END_STREAM_END_HEADERS, streamId, block));
      return this.outcome(streamId);
    }
  }

  /** HPACK integer (RFC 7541 §5.1) with an N-bit prefix; `pattern` holds the bits above the prefix. */
  function hpackInteger(value: number, prefixBits: number, pattern: number): Buffer {
    const max = (1 << prefixBits) - 1;
    if (value < max) return Buffer.from([pattern | value]);
    const out = [pattern | max];
    for (value -= max; value >= 128; value >>= 7) out.push((value & 0x7f) | 0x80);
    out.push(value);
    return Buffer.from(out);
  }

  const hpackString = (s: string) => Buffer.concat([hpackInteger(s.length, 7, 0), Buffer.from(s, "latin1")]);

  /** RFC 7541 §6.3 Dynamic Table Size Update. It has to open the header block. */
  const sizeUpdate = (size: number) => hpackInteger(size, 5, 0x20);

  /** Literal field with incremental indexing and a new name (§6.2.1): it becomes dynamic entry 62. */
  const insert = (name: string, value: string) =>
    Buffer.concat([Buffer.from([0x40]), hpackString(name), hpackString(value)]);

  /** Indexed field 62 (§6.1): the newest entry of the dynamic table. */
  const NEWEST_ENTRY = Buffer.from([0xbe]);

  /** `GET http://localhost/`: static-table fields and a literal :authority. Nothing is inserted. */
  const get = (...rest: Buffer[]) =>
    Buffer.concat([Buffer.from([0x82, 0x86, 0x84, 0x01]), hpackString("localhost"), ...rest]);

  async function listen(options: http2.ServerOptions, onFirstStream?: (session: http2.ServerHttp2Session) => void) {
    const probes: Array<string | undefined> = [];
    const server = http2.createServer(options);
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      probes.push(headers["x-probe"] as string | undefined);
      stream.respond({ ":status": 200 });
      stream.end();
      if (probes.length === 1) onFirstStream?.(stream.session!);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    await once(socket, "connect");
    const client = new RawClient(socket);
    socket.write(Buffer.concat([PREFACE, frame(SETTINGS, 0, 0)]));
    return { server, client, probes };
  }

  test("header blocks sent before the ACK of a smaller headerTableSize still use the 4096-byte table", async () => {
    const { server, client, probes } = await listen({ settings: { headerTableSize: 0 } });
    try {
      await client.serverSettings(0);
      // A client that sends two requests right after it connects: both blocks leave before it
      // has ACKed the server's SETTINGS. The first inserts `x-probe: abc`, the second refers to it.
      client.socket.write(
        Buffer.concat([
          frame(HEADERS, END_STREAM_END_HEADERS, 1, get(insert("x-probe", "abc"))),
          frame(HEADERS, END_STREAM_END_HEADERS, 3, get(NEWEST_ENTRY)),
        ]),
      );
      expect([await client.outcome(1), await client.outcome(3)]).toEqual(["response", "response"]);
      // Once ACKed, 0 is the limit. A conforming encoder opens its next block with a size update
      // to 0. A size update above the limit is a decoding error.
      client.ackSettings();
      expect(await client.request(5, Buffer.concat([sizeUpdate(0), get()]))).toBe("response");
      expect(await client.request(7, Buffer.concat([sizeUpdate(4096), get()]))).toBe(COMPRESSION_ERROR);
      expect(probes).toEqual(["abc", "abc", undefined]);
    } finally {
      client.socket.destroy();
      server.close();
    }
  });

  test("a size update up to a grown headerTableSize is accepted once the peer has ACKed it", async () => {
    const { server, client, probes } = await listen({}, session => session.settings({ headerTableSize: 8192 }));
    try {
      await client.serverSettings();
      client.ackSettings();
      expect(await client.request(1, get())).toBe("response");
      await client.serverSettings(8192);
      client.ackSettings();
      // A 6000-byte entry only stays referencable in a table that really grew past 4096.
      const big = Buffer.alloc(6000, "a").toString();
      expect(await client.request(3, Buffer.concat([sizeUpdate(8192), get(insert("x-probe", big))]))).toBe("response");
      expect(await client.request(5, get(NEWEST_ENTRY))).toBe("response");
      expect(probes).toEqual([undefined, big, big]);
    } finally {
      client.socket.destroy();
      server.close();
    }
  });

  test("an ACKed larger headerTableSize raises the limit, not the table", async () => {
    const { server, client } = await listen({ settings: { headerTableSize: 8192 } });
    try {
      await client.serverSettings(8192);
      client.ackSettings();
      // No size update was sent, so the table is still 4096 bytes: the second 3000-byte entry
      // evicts the first, and index 63 refers to nothing.
      const big = Buffer.alloc(3000, "a").toString();
      expect(await client.request(1, get(insert("x-probe", big)))).toBe("response");
      expect(await client.request(3, get(insert("x-probe", big)))).toBe("response");
      expect(await client.request(5, get(Buffer.from([0xbf])))).toBe(COMPRESSION_ERROR);
    } finally {
      client.socket.destroy();
      server.close();
    }
  });

  test("with two SETTINGS in flight, each ACK binds the headerTableSize of the oldest one", async () => {
    const { server, client } = await listen({}, session => {
      session.settings({ headerTableSize: 8192 });
      session.settings({ headerTableSize: 512 });
    });
    try {
      await client.serverSettings();
      client.ackSettings();
      expect(await client.request(1, get())).toBe("response");
      await client.serverSettings(512);
      client.ackSettings(); // ACKs 8192. 512 is still in flight.
      expect(await client.request(3, Buffer.concat([sizeUpdate(8192), get()]))).toBe("response");
      client.ackSettings(); // ACKs 512.
      expect(await client.request(5, Buffer.concat([sizeUpdate(512), get()]))).toBe("response");
      expect(await client.request(7, Buffer.concat([sizeUpdate(8192), get()]))).toBe(COMPRESSION_ERROR);
    } finally {
      client.socket.destroy();
      server.close();
    }
  });
});

// The other direction: our headerTableSize says nothing about the peer's decoder, which holds
// 4096 bytes until the peer's own SETTINGS say otherwise.
test("a headerTableSize above 4096 does not grow the encoder's table past the peer's decoder", async () => {
  // 40 fields of about 240 bytes: 9 KB of table entries, so most of them fall out of a
  // 4096-byte table before the next response repeats them.
  const fields: Record<string, string> = {};
  for (let i = 0; i < 40; i++) fields[`x-field-${i}`] = `${i}`.padStart(3, "0") + Buffer.alloc(200, "v").toString();

  const server = http2.createServer({ settings: { headerTableSize: 65536 } });
  server.on("stream", stream => {
    stream.respond({ ":status": 200, ...fields });
    stream.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  try {
    for (let i = 0; i < 3; i++) {
      const req = client.request({ ":path": "/" });
      const [headers] = await once(req, "response");
      expect(Object.fromEntries(Object.entries(headers).filter(([name]) => name.startsWith("x-field-")))).toEqual(
        fields,
      );
      req.resume();
      await once(req, "close");
    }
  } finally {
    client.destroy();
    server.close();
  }
});
