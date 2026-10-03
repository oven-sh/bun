import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

// The reset of a stream that reached the handler does not use maxSessionRejectedStreams, whatever
// code it carries and whoever asks for it. Node counts in one place only, where it rejects a stream
// at creation: https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1035-L1050

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const HEADERS = 0x1;
const RST_STREAM = 0x3;
const SETTINGS = 0x4;
const PING = 0x6;
const GOAWAY = 0x7;
const END_STREAM = 0x1;
const END_HEADERS = 0x4;
const ACK = 0x1;
const REFUSED_STREAM = http2.constants.NGHTTP2_REFUSED_STREAM;
const ENHANCE_YOUR_CALM = http2.constants.NGHTTP2_ENHANCE_YOUR_CALM;

type Frame = { type: number; flags: number; streamId: number; payload: Buffer };

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

// :method GET or POST, :scheme http, :path /, and a literal :authority. No dynamic table entry.
function requestBlock(method: "GET" | "POST"): Buffer {
  const authority = Buffer.from("localhost", "latin1");
  return Buffer.concat([Buffer.from([method === "POST" ? 0x83 : 0x82, 0x86, 0x84, 0x01, authority.length]), authority]);
}

/** A raw HTTP/2 client. It has no timers: a wait ends with a frame or with the end of the connection. */
class RawClient {
  frames: Frame[] = [];
  closed = false;
  #buffered = Buffer.alloc(0);
  #waiters: Array<{ matches: (f: Frame) => boolean; resolve: (f: Frame | null) => void }> = [];

  constructor(readonly socket: net.Socket) {
    socket.on("error", () => {});
    socket.on("close", () => {
      this.closed = true;
      for (const waiter of this.#waiters.splice(0)) waiter.resolve(null);
    });
    socket.on("data", chunk => {
      this.#buffered = Buffer.concat([this.#buffered, chunk]);
      while (this.#buffered.length >= 9) {
        const length = this.#buffered.readUIntBE(0, 3);
        if (this.#buffered.length < 9 + length) break;
        const received: Frame = {
          type: this.#buffered.readUInt8(3),
          flags: this.#buffered.readUInt8(4),
          streamId: this.#buffered.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(this.#buffered.subarray(9, 9 + length)),
        };
        this.#buffered = this.#buffered.subarray(9 + length);
        this.frames.push(received);
        const index = this.#waiters.findIndex(waiter => waiter.matches(received));
        if (index !== -1) this.#waiters.splice(index, 1)[0].resolve(received);
      }
    });
  }

  static async connect(server: http2.Http2Server): Promise<RawClient> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    await once(socket, "connect");
    const client = new RawClient(socket);
    socket.write(Buffer.concat([PREFACE, frame(SETTINGS, 0, 0)]));
    return client;
  }

  /** Resolves with the first frame that matches, or with null when the connection ended first. */
  waitFor(matches: (f: Frame) => boolean): Promise<Frame | null> {
    const existing = this.frames.find(matches);
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.resolve(null);
    return new Promise(resolve => this.#waiters.push({ matches, resolve }));
  }

  get(streamId: number) {
    this.socket.write(frame(HEADERS, END_STREAM | END_HEADERS, streamId, requestBlock("GET")));
  }

  /** A request whose body stays open. */
  upload(streamId: number) {
    this.socket.write(frame(HEADERS, END_HEADERS, streamId, requestBlock("POST")));
  }

  /** True when the server answered the PING. False when it sent GOAWAY or closed the connection. */
  async ping(tag: number): Promise<boolean> {
    const payload = Buffer.alloc(8);
    payload.writeUInt32BE(tag, 0);
    this.socket.write(frame(PING, 0, 0, payload));
    const answer = await this.waitFor(
      f => f.type === GOAWAY || (f.type === PING && (f.flags & ACK) !== 0 && f.payload.equals(payload)),
    );
    return answer?.type === PING;
  }

  goawayCodes(): number[] {
    return this.frames.filter(f => f.type === GOAWAY).map(f => f.payload.readUInt32BE(4));
  }

  resets(): Array<[number, number]> {
    return this.frames.filter(f => f.type === RST_STREAM).map(f => [f.streamId, f.payload.readUInt32BE(0)]);
  }
}

/**
 * Opens `count` requests on one connection, one after the other, and sends a PING after each.
 * A stream is reset from setImmediate callbacks that close() and _destroy() queue, so the PING
 * goes out one turn after the server's stream emitted 'close'.
 * Resolves with the number of PINGs the server answered and the code of every GOAWAY it wrote.
 */
async function pingAfterEachRequest(
  server: http2.Http2Server,
  count: number,
  open: (client: RawClient, streamId: number, opened: Promise<void>) => void | Promise<void> = (client, streamId) =>
    client.get(streamId),
) {
  const streams = new Map<number, { opened: PromiseWithResolvers<void>; closed: PromiseWithResolvers<void> }>();
  const events = (streamId: number) => {
    if (!streams.has(streamId)) {
      streams.set(streamId, { opened: Promise.withResolvers(), closed: Promise.withResolvers() });
    }
    return streams.get(streamId)!;
  };
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    const { opened, closed } = events(stream.id!);
    stream.once("close", () => closed.resolve());
    opened.resolve();
  });
  server.on("session", session => session.on("error", () => {}));
  const client = await RawClient.connect(server);
  const ended = once(client.socket, "close");
  try {
    let acked = 0;
    for (let i = 0; i < count; i++) {
      const streamId = 1 + 2 * i;
      const { opened, closed } = events(streamId);
      await Promise.race([open(client, streamId, opened.promise), ended]);
      await Promise.race([closed.promise, ended]);
      if (client.closed) break;
      await new Promise(resolve => setImmediate(resolve));
      if (!(await client.ping(i + 1))) break;
      acked++;
    }
    return { acked, goaways: client.goawayCodes() };
  } finally {
    client.socket.destroy();
    server.close();
  }
}

describe("maxSessionRejectedStreams and the reset of a delivered stream", () => {
  const refusals: Record<string, (stream: http2.ServerHttp2Stream) => void> = {
    "close(REFUSED_STREAM)": stream => stream.close(REFUSED_STREAM),
    "respond() then close(REFUSED_STREAM)": stream => {
      stream.respond({ ":status": 200 });
      stream.close(REFUSED_STREAM);
    },
    "close(REFUSED_STREAM) from a later turn": stream => {
      setImmediate(() => stream.close(REFUSED_STREAM));
    },
    "close(REFUSED_STREAM) twice then destroy()": stream => {
      stream.close(REFUSED_STREAM);
      stream.close(REFUSED_STREAM);
      stream.destroy();
    },
  };

  describe.each(Object.keys(refusals))("%s in every handler", name => {
    test.each([
      ["a request that has ended", (client: RawClient, streamId: number) => client.get(streamId)],
      ["a request whose body is still open", (client: RawClient, streamId: number) => client.upload(streamId)],
    ])("of %s keeps the session", async (_, open) => {
      const server = http2.createServer({ maxSessionRejectedStreams: 2 });
      server.on("stream", stream => {
        stream.on("error", () => {});
        refusals[name](stream);
      });
      expect(await pingAfterEachRequest(server, 6, open)).toEqual({ acked: 6, goaways: [] });
    });
  });

  test("close(REFUSED_STREAM) of every pushed stream keeps the session", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 2 });
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        if (err) return;
        pushed.on("error", () => {});
        pushed.close(REFUSED_STREAM);
      });
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    expect(await pingAfterEachRequest(server, 6)).toEqual({ acked: 6, goaways: [] });
  });

  test("req.stream.close(REFUSED_STREAM) in every request listener keeps the session", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 2 }, (req, res) => {
      req.on("error", () => {});
      res.on("error", () => {});
      req.stream.on("error", () => {});
      req.stream.close(REFUSED_STREAM);
    });
    expect(await pingAfterEachRequest(server, 6)).toEqual({ acked: 6, goaways: [] });
  });

  test("RST_STREAM(REFUSED_STREAM) from the peer on every stream keeps the session", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 2 });
    server.on("stream", stream => {
      stream.on("error", () => {});
    });
    const result = await pingAfterEachRequest(server, 6, async (client, streamId, opened) => {
      client.upload(streamId);
      await opened;
      client.socket.write(frame(RST_STREAM, 0, streamId, u32(REFUSED_STREAM)));
    });
    expect(result).toEqual({ acked: 6, goaways: [] });
  });

  test.each([0, 1, 2])("maxSessionRejectedStreams: %d keeps the session after one refused request", async max => {
    const server = http2.createServer({ maxSessionRejectedStreams: max });
    server.on("stream", stream => {
      stream.on("error", () => {});
      stream.close(REFUSED_STREAM);
    });
    expect(await pingAfterEachRequest(server, 1)).toEqual({ acked: 1, goaways: [] });
  });

  test("a long-lived stream survives refused requests on its connection", async () => {
    const server = http2.createServer({ maxSessionRejectedStreams: 2 });
    server.on("stream", (stream, headers) => {
      stream.on("error", () => {});
      if (headers[":path"] === "/events") {
        stream.respond({ ":status": 200 });
        stream.on("data", chunk => stream.write(chunk));
        return;
      }
      stream.close(REFUSED_STREAM);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    try {
      const seen: { goaway: number[]; sessionError?: string; eventsError?: string } = { goaway: [] };
      client.on("goaway", code => seen.goaway.push(code));
      client.on("error", err => (seen.sessionError = err.message));

      const events = client.request({ ":path": "/events", ":method": "POST" });
      events.on("error", (err: NodeJS.ErrnoException) => (seen.eventsError = err.code));
      events.setEncoding("utf8");
      await once(events, "response");

      for (let i = 0; i < 5; i++) {
        const closed = Promise.withResolvers<void>();
        const req = client.request({ ":path": "/work" });
        // A refused request ends with an 'error' on node.
        req.on("error", () => {});
        req.on("close", () => closed.resolve());
        req.end();
        await closed.promise;
        // The long-lived stream still carries data in both directions.
        events.write(`${i}`);
        expect((await once(events, "data"))[0]).toBe(`${i}`);
      }
      expect({ ...seen, closed: client.closed, destroyed: client.destroyed }).toEqual({
        goaway: [],
        closed: false,
        destroyed: false,
      });
      events.close();
    } finally {
      client.close();
      server.close();
    }
  });

  // Node charges this refusal to maxSessionInvalidFrames, so maxSessionRejectedStreams plays no part.
  test("a stream refused over maxConcurrentStreams does not use maxSessionRejectedStreams", async () => {
    const seen: number[] = [];
    let sessionErrorCode: string | undefined;
    const server = http2.createServer({ settings: { maxConcurrentStreams: 1 }, maxSessionRejectedStreams: 3 });
    server.on("sessionError", (err: NodeJS.ErrnoException) => (sessionErrorCode = err.code));
    server.on("session", session => session.on("error", () => {}));
    server.on("stream", stream => {
      seen.push(stream.id!);
      stream.on("error", () => {});
      stream.respond({ ":status": 200 });
      stream.write("hello");
    });
    const client = await RawClient.connect(server);
    try {
      client.get(1);
      await client.waitFor(f => f.type === HEADERS && f.streamId === 1);
      for (const streamId of [3, 5, 7]) client.get(streamId);
      await client.waitFor(f => f.type === GOAWAY || (f.type === RST_STREAM && f.streamId === 7));
      expect({
        seen,
        resets: client.resets(),
        acked: await client.ping(1),
        goaways: client.goawayCodes(),
        sessionErrorCode,
      }).toEqual({
        seen: [1],
        resets: [
          [3, REFUSED_STREAM],
          [5, REFUSED_STREAM],
          [7, REFUSED_STREAM],
        ],
        acked: true,
        goaways: [],
        sessionErrorCode: undefined,
      });
    } finally {
      client.socket.destroy();
      server.close();
    }
  });
});
