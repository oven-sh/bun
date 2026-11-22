/**
 * The pending queue of a client session (`ClientHttp2Session.#pendingRequests`).
 *
 * A request has no stream id while it waits for the socket to connect, or for a stream slot under
 * the peer's SETTINGS_MAX_CONCURRENT_STREAMS. A request that is destroyed while it waits leaves the
 * queue at once: the session releases it, and a closed session stops waiting for it.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-pending-requests.test.ts
 *   node --test test/js/node/http2/node-http2-pending-requests.test.ts
 *
 * node v26.3.0 has no such queue behind the stream limit: it gives the request its id at once and
 * nghttp2 holds the HEADERS frame. Where that gives another outcome, the test has the outcome of
 * each runtime, or it does not run under node and its skip reason says what node does.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import dc from "node:diagnostics_channel";
import { once, type EventEmitter } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { describe, test } from "node:test";

const isBun = typeof Bun !== "undefined";

const PREFACE_LENGTH = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".length;
const FrameType = { HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6, GOAWAY: 7 };
const FRAME_NAMES: Record<number, string> = { 0: "DATA", 1: "HEADERS", 3: "RST_STREAM", 9: "CONTINUATION" };
const ACK = 0x1;
const SETTINGS_MAX_CONCURRENT_STREAMS = 0x3;

function encodeFrame(type: number, flags: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  return Buffer.concat([header, payload]);
}

function streamLimit(streams: number): Buffer {
  const setting = Buffer.alloc(6);
  setting.writeUInt16BE(SETTINGS_MAX_CONCURRENT_STREAMS, 0);
  setting.writeUInt32BE(streams, 2);
  return encodeFrame(FrameType.SETTINGS, 0, setting);
}

function eventOf<T = unknown>(emitter: EventEmitter, name: string): Promise<T> {
  return new Promise(resolve => emitter.once(name, resolve));
}

const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * A raw HTTP/2 peer on loopback. It ACKs SETTINGS and PING, never answers a request and never
 * closes the connection on its own. `streams` is the stream limit that it announces: with 0,
 * every request waits.
 */
async function rawPeer({ streams }: { streams?: number }) {
  const sockets = new Set<net.Socket>();
  /** Every frame the client sent on a stream, for example "HEADERS#1". */
  const streamFrames: string[] = [];
  const disconnected = Promise.withResolvers<void>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => disconnected.resolve());
    socket.write(streams === undefined ? encodeFrame(FrameType.SETTINGS, 0) : streamLimit(streams));
    let buffered = Buffer.alloc(0);
    let prefaceSeen = false;
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!prefaceSeen) {
        if (buffered.length < PREFACE_LENGTH) return;
        prefaceSeen = true;
        buffered = buffered.subarray(PREFACE_LENGTH);
      }
      while (buffered.length >= 9) {
        const length = buffered.readUIntBE(0, 3);
        if (buffered.length < 9 + length) break;
        const type = buffered[3];
        const flags = buffered[4];
        const streamId = buffered.readUInt32BE(5) & 0x7fffffff;
        const payload = buffered.subarray(9, 9 + length);
        buffered = buffered.subarray(9 + length);
        if (streamId !== 0) {
          streamFrames.push(`${FRAME_NAMES[type] ?? type}#${streamId}`);
        } else if (type === FrameType.SETTINGS && (flags & ACK) === 0) {
          socket.write(encodeFrame(FrameType.SETTINGS, ACK));
        } else if (type === FrameType.PING && (flags & ACK) === 0) {
          socket.write(encodeFrame(FrameType.PING, ACK, payload));
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await eventOf(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    streamFrames,
    /** Resolves when the client has closed the connection: the peer has then read all that it sent. */
    disconnected: disconnected.promise,
    /** GOAWAY(NO_ERROR) with last stream id 0. The connection stays open. */
    goaway() {
      for (const socket of sockets) socket.write(encodeFrame(FrameType.GOAWAY, 0, Buffer.alloc(8)));
    },
    /** A new SETTINGS frame that allows `streams` streams. */
    allowStreams(streams: number) {
      for (const socket of sockets) socket.write(streamLimit(streams));
    },
    [Symbol.dispose]() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

/**
 * Connects and waits for both SETTINGS exchanges: the peer's SETTINGS carries the stream limit, and
 * its ACK of the client's SETTINGS ends the grace that close() gives an unACKed SETTINGS. The
 * session gets no 'error' listener: a session error fails the test.
 */
async function connectTo(url: string): Promise<http2.ClientHttp2Session> {
  const session = http2.connect(url);
  await Promise.all([eventOf(session, "remoteSettings"), eventOf(session, "localSettings")]);
  return session;
}

/** A session whose socket never connects: the lookup never answers. */
function sessionThatNeverConnects() {
  const socket = net.connect({ host: "never-connects.invalid", port: 80, lookup: () => {} });
  const session = http2.connect("http://never-connects.invalid", { createConnection: () => socket });
  return {
    session,
    [Symbol.dispose]() {
      session.destroy();
      socket.destroy();
    },
  };
}

type MakeRequest = (options?: http2.ClientSessionRequestOptions, method?: string) => http2.ClientHttp2Stream;

/** What the "http2.client.stream.created" diagnostics channel publishes. */
type CreatedMessage = { stream: http2.ClientHttp2Stream; headers: http2.OutgoingHttpHeaders };

/**
 * Makes requests that have to wait, and records the error of each one. Under node a request
 * behind the stream limit is not `pending`, so that premise is checked under Bun only. The tests
 * on a raw peer also look at the frames that reached it.
 */
function waitingRequests(session: http2.ClientHttp2Session) {
  const errors: string[] = [];
  const request: MakeRequest = (options, method = "GET") => {
    const req = session.request({ ":path": "/", ":method": method }, options);
    req.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code ?? err.message));
    if (isBun) assert.strictEqual(req.pending, true);
    return req;
  };
  return { errors, request };
}

/** An HTTP/2 server that allows one stream at a time and does not answer "/hold" until `release()`. */
async function serverWithOneStreamSlot() {
  const paths: string[] = [];
  const held = Promise.withResolvers<http2.ServerHttp2Stream>();
  const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
  server.on("stream", (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    stream.on("error", () => {});
    paths.push(String(headers[":path"]));
    if (headers[":path"] === "/hold") return held.resolve(stream);
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await eventOf(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    /** The paths of the requests that reached the server, in order. */
    paths,
    /** Resolves when "/hold" has taken the only slot. */
    holding: held.promise,
    async release() {
      const stream = await held.promise;
      stream.respond({ ":status": 200 });
      stream.end("late");
    },
    [Symbol.dispose]() {
      server.close();
    },
  };
}

/** Connects and takes the server's only stream slot. */
async function connectAndHoldTheSlot(server: Awaited<ReturnType<typeof serverWithOneStreamSlot>>) {
  const session = http2.connect(server.url);
  session.on("error", () => {});
  await eventOf(session, "remoteSettings");
  const holder = session.request({ ":path": "/hold" });
  holder.on("error", () => {});
  holder.resume();
  await server.holding;
  return { session, holder };
}

function statusOf(req: http2.ClientHttp2Stream): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  req.on("error", reject);
  req.on("response", headers => resolve(Number(headers[":status"])));
  req.resume();
  return promise;
}

describe("a closed session does not wait for a request that was destroyed while it waited", () => {
  // Each case runs on a session whose peer allows no stream, so every request waits. The case
  // gives its requests up and closes the session. Nothing is in flight then, so the session is
  // destroyed at the next immediate, as in node.
  type GiveUpAndClose = (session: http2.ClientHttp2Session, request: MakeRequest) => void;
  const cases: { name: string; errors: string[]; giveUpAndClose: GiveUpAndClose; node?: string }[] = [
    {
      name: "destroy(), then close()",
      errors: [],
      giveUpAndClose(session, request) {
        request().destroy();
        session.close();
      },
    },
    {
      name: "destroy(err), then close()",
      errors: ["given up"],
      giveUpAndClose(session, request) {
        request().destroy(new Error("given up"));
        session.close();
      },
    },
    {
      name: "close(), then destroy()",
      errors: [],
      giveUpAndClose(session, request) {
        const req = request();
        session.close();
        req.destroy();
      },
    },
    {
      name: "the request's AbortSignal, then close()",
      errors: ["ABORT_ERR"],
      giveUpAndClose(session, request) {
        const controller = new AbortController();
        request({ signal: controller.signal });
        controller.abort();
        session.close();
      },
    },
    {
      name: "a 'created' diagnostics subscriber that destroys the request, then close()",
      errors: [],
      giveUpAndClose(session, request) {
        const destroyCreated = (message: unknown) => {
          const { stream } = message as CreatedMessage;
          if (stream.session === session) stream.destroy();
        };
        dc.subscribe("http2.client.stream.created", destroyCreated);
        try {
          assert.strictEqual(request().destroyed, true);
        } finally {
          dc.unsubscribe("http2.client.stream.created", destroyCreated);
        }
        session.close();
      },
    },
    {
      name: "destroy() with an 'aborted' listener that throws, then close()",
      errors: ["thrown by the 'aborted' listener"],
      // node takes a request out of its session after the 'aborted' emit. Bun does that before the
      // emit for a request that has no stream id, and after it for every other request, as node.
      node: "the throw keeps the request in its session, and the session never ends",
      giveUpAndClose(session, request) {
        const req = request(undefined, "POST");
        req.on("aborted", () => {
          throw new Error("thrown by the 'aborted' listener");
        });
        req.destroy();
        session.close();
      },
    },
    {
      // No listener is left to see the request's 'close': only _destroy can tell the session.
      name: "removeAllListeners() and destroy(), then close()",
      errors: [],
      giveUpAndClose(session, request) {
        const req = request();
        req.removeAllListeners();
        req.destroy();
        session.close();
      },
    },
    {
      name: "close(), then destroy() of three requests, the oldest first",
      errors: [],
      giveUpAndClose(session, request) {
        const requests = [request(), request(), request()];
        session.close();
        for (const req of requests) req.destroy();
      },
    },
    {
      name: "close(), then destroy() of three requests, the middle one first",
      errors: [],
      giveUpAndClose(session, request) {
        const [oldest, middle, newest] = [request(), request(), request()];
        session.close();
        middle.destroy();
        newest.destroy();
        oldest.destroy();
      },
    },
  ];

  for (const { name, errors, giveUpAndClose, node } of cases) {
    test(name, { skip: !isBun && node }, async () => {
      using peer = await rawPeer({ streams: 0 });
      const session = await connectTo(peer.url);
      try {
        const closed = once(session, "close");
        const waiting = waitingRequests(session);
        giveUpAndClose(session, waiting.request);
        await immediate();
        assert.strictEqual(session.destroyed, true);
        await closed;
        assert.deepStrictEqual(waiting.errors, errors);
        // A request that was given up while it waited never reaches the wire, not even as a
        // RST_STREAM.
        await peer.disconnected;
        assert.deepStrictEqual(peer.streamFrames, []);
      } finally {
        session.destroy();
      }
    });
  }

  test("destroy(), then ping() and close()", async () => {
    using peer = await rawPeer({ streams: 0 });
    const session = await connectTo(peer.url);
    try {
      const closed = once(session, "close");
      const waiting = waitingRequests(session);
      waiting.request().destroy();
      // The session ends at the ping's ACK, or when the grace for that ACK is over.
      session.ping(() => {});
      session.close();
      await closed;
      assert.deepStrictEqual(waiting.errors, []);
    } finally {
      session.destroy();
    }
  });

  // Bun rejects the request at the GOAWAY, and the closed session then has nothing left to wait
  // for.
  test(
    "close() with a request that still waits, then the peer's GOAWAY",
    { skip: !isBun && "nghttp2 keeps the request, and the session stays" },
    async () => {
      using peer = await rawPeer({ streams: 0 });
      const session = await connectTo(peer.url);
      try {
        const closed = once(session, "close");
        const waiting = waitingRequests(session);
        waiting.request();
        session.close();
        peer.goaway();
        await closed;
        assert.deepStrictEqual(waiting.errors, ["ERR_HTTP2_GOAWAY_SESSION"]);
      } finally {
        session.destroy();
      }
    },
  );

  test("a request that was only close()d keeps its place, and its session waits for it", async () => {
    using peer = await rawPeer({ streams: 0 });
    const session = await connectTo(peer.url);
    try {
      const closed = once(session, "close");
      const waiting = waitingRequests(session);
      const req = waiting.request();
      req.close();
      session.close();
      // Had close() found nothing in flight, the session would be destroyed by now.
      await immediate();
      assert.deepStrictEqual(
        { request: req.destroyed, session: session.destroyed },
        { request: false, session: false },
      );
      req.destroy();
      await closed;
      assert.deepStrictEqual(waiting.errors, []);
    } finally {
      session.destroy();
    }
  });

  // node destroys this session at the next immediate, and emits no 'close' while the socket still
  // connects. Bun waits for the ACK of its SETTINGS first, for at most 250 ms.
  test("before the socket connects: destroy(), then close()", async () => {
    using connecting = sessionThatNeverConnects();
    const { session } = connecting;
    const closed = once(session, "close");
    const waiting = waitingRequests(session);
    waiting.request().destroy();
    session.close();
    if (isBun) await closed;
    else await immediate();
    assert.strictEqual(session.destroyed, true);
    assert.deepStrictEqual(waiting.errors, []);
  });

  // The flush takes a request off the queue before it knows that the request gets a stream. When
  // the request fails there, the closed session has nothing left to wait for.
  const failsAtTheFlush: [string, (session: http2.ClientHttp2Session) => http2.ClientHttp2Stream, string][] = [
    [
      "a header that the native side rejects",
      session => session.request({ ":path": "/", "x-undefined": undefined }),
      "ERR_HTTP2_INVALID_HEADER_VALUE",
    ],
    [
      "no stream id left",
      session => {
        const req = session.request({ ":path": "/" });
        (session as http2.ClientHttp2Session & { setNextStreamID(id: number): void }).setNextStreamID(2 ** 32 - 1);
        return req;
      },
      "ERR_HTTP2_OUT_OF_STREAMS",
    ],
  ];
  for (const [name, makeRequest, code] of failsAtTheFlush) {
    test(
      `close(), then the last waiting request fails when a slot is free: ${name}`,
      { skip: !isBun && "the request has its stream id and its header block from the start, so it does not fail" },
      async () => {
        using peer = await rawPeer({ streams: 0 });
        const session = await connectTo(peer.url);
        try {
          const closed = once(session, "close");
          const req = makeRequest(session);
          assert.strictEqual(req.pending, true);
          const failed = eventOf<NodeJS.ErrnoException>(req, "error");
          session.close();
          peer.allowStreams(100);
          assert.strictEqual((await failed).code, code);
          await closed;
        } finally {
          session.destroy();
        }
      },
    );
  }
});

describe("a closed session is destroyed when nothing is in flight, and not before", () => {
  test("close() on an idle session with nothing unACKed destroys it at the next immediate", async () => {
    using peer = await rawPeer({});
    const session = await connectTo(peer.url);
    try {
      session.close();
      await immediate();
      assert.strictEqual(session.destroyed, true);
    } finally {
      session.destroy();
    }
  });

  // The ACK of a PING can be the last thing that a closed session waits for. The callback gets
  // the round-trip time, or a cancel error when the grace for the ACK is over first.
  test("close() with a PING in flight: the session is destroyed when the PING's callback has run", async () => {
    using peer = await rawPeer({});
    const session = await connectTo(peer.url);
    try {
      const pinged = new Promise(resolve => session.ping(resolve));
      session.close();
      await pinged;
      await immediate();
      assert.strictEqual(session.destroyed, true);
    } finally {
      session.destroy();
    }
  });

  test("destroy() of the only waiting request leaves an open session alone", async () => {
    using peer = await rawPeer({ streams: 0 });
    const session = await connectTo(peer.url);
    try {
      waitingRequests(session).request().destroy();
      await immediate();
      assert.deepStrictEqual(
        { closed: session.closed, destroyed: session.destroyed },
        { closed: false, destroyed: false },
      );
      // Nothing waits any more: once the peer allows a stream, a new request is sent at once.
      const allowed = eventOf(session, "remoteSettings");
      peer.allowStreams(1);
      await allowed;
      const next = session.request({ ":path": "/" });
      next.on("error", () => {});
      assert.strictEqual(next.pending, false);
    } finally {
      session.destroy();
    }
  });

  // A node or Bun server answers the client's GOAWAY with its own. Bun rejects the request that
  // waits at that GOAWAY, while the first request is still open. nghttp2 refuses it when the
  // first stream is over.
  test("close() while a request waits behind an open one, on a server that answers the GOAWAY", async () => {
    using server = await serverWithOneStreamSlot();
    const { session, holder } = await connectAndHoldTheSlot(server);
    try {
      const closed = once(session, "close");
      const held = statusOf(holder);
      const waiting = session.request({ ":path": "/waiting" });
      const failed = eventOf<NodeJS.ErrnoException>(waiting, "error");
      const waitingClosed = eventOf(waiting, "close");
      session.close();
      if (isBun) {
        await waitingClosed;
        assert.strictEqual(holder.closed, false);
      }
      await server.release();
      assert.deepStrictEqual(
        { held: await held, error: (await failed).code, rstCode: waiting.rstCode, paths: server.paths },
        {
          held: 200,
          error: isBun ? "ERR_HTTP2_GOAWAY_SESSION" : "ERR_HTTP2_STREAM_ERROR",
          rstCode: http2.constants.NGHTTP2_REFUSED_STREAM,
          paths: ["/hold"],
        },
      );
      await closed;
    } finally {
      session.destroy();
    }
  });
});

describe("every waiting request is ended once", () => {
  // Three requests wait. While the session ends them, the 'aborted' listener of the oldest one
  // destroys the one behind it. Under node the three have their stream ids, so session.destroy()
  // ends them as open streams: with no error, or with the error of the session.
  type End = (session: http2.ClientHttp2Session, peer: { goaway(): void }) => void;
  type Events = { oldest: string[]; middle: string[]; newest: string[] };
  const ends: { name: string; end: End; bun: Events; node: Events | string }[] = [
    {
      name: "session.destroy()",
      end: session => session.destroy(),
      bun: {
        oldest: ["ERR_HTTP2_STREAM_CANCEL", "close"],
        middle: ["close"],
        newest: ["ERR_HTTP2_STREAM_CANCEL", "close"],
      },
      node: { oldest: ["close"], middle: ["close"], newest: ["close"] },
    },
    {
      name: "session.destroy(err)",
      end: session => session.destroy(new Error("session destroyed")),
      bun: {
        oldest: ["ERR_HTTP2_STREAM_CANCEL", "close"],
        middle: ["close"],
        newest: ["ERR_HTTP2_STREAM_CANCEL", "close"],
      },
      node: {
        oldest: ["session destroyed", "close"],
        middle: ["ERR_HTTP2_STREAM_ERROR", "close"],
        newest: ["session destroyed", "close"],
      },
    },
    {
      name: "the peer's GOAWAY",
      end: (_, peer) => peer.goaway(),
      bun: {
        oldest: ["ERR_HTTP2_GOAWAY_SESSION", "close"],
        middle: ["close"],
        newest: ["ERR_HTTP2_GOAWAY_SESSION", "close"],
      },
      node: "nghttp2 keeps the requests, and the session stays",
    },
  ];

  for (const { name, end, bun, node } of ends) {
    test(`by ${name}`, { skip: !isBun && typeof node === "string" && node }, async () => {
      using peer = await rawPeer({ streams: 0 });
      const session = await connectTo(peer.url);
      session.on("error", () => {});
      try {
        const events: Events = { oldest: [], middle: [], newest: [] };
        const [oldest, middle] = (["oldest", "middle", "newest"] as const).map(name => {
          const req = session.request({ ":path": "/", ":method": "POST" });
          req.on("error", (err: NodeJS.ErrnoException) => events[name].push(err.code ?? err.message));
          req.on("close", () => events[name].push("close"));
          return req;
        });
        oldest.on("aborted", () => middle.destroy());
        const closed = eventOf(session, "close");
        end(session, peer);
        await closed;
        assert.deepStrictEqual(events, isBun ? bun : node);
      } finally {
        session.destroy();
      }
    });
  }
});

// Each scenario runs in a process of its own, without the concurrent JIT: an optimizing compilation
// in flight keeps the values that it refers to alive, and these can be requests. node starts the
// processes together. Bun's node:test runs one test at a time.
describe("a request that was given up while it waited is released", { concurrency: true }, () => {
  const fixture = path.join(import.meta.dirname, "node-http2-pending-requests-fixture.ts");
  async function run(scenario: string) {
    const child = spawn(process.execPath, [...(isBun ? [] : ["--expose-gc"]), fixture, scenario], {
      env: { ...process.env, BUN_JSC_useConcurrentJIT: "0" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    const [exitCode] = await once(child, "close");
    return { stdout: stdout.trim(), exitCode };
  }
  const printed = (result: object) => ({ stdout: JSON.stringify(result), exitCode: 0 });

  // The requests wait behind a keeper, which stays. So a request leaves the queue from every
  // place but the front.
  for (const scenario of [
    "destroy, oldest first",
    "destroy with an error, newest first",
    "AbortSignal, oldest first",
  ]) {
    test(`while the peer's stream slot is still taken: ${scenario}`, async () => {
      assert.deepStrictEqual(await run(scenario), printed({ alive: 0, givenUp: 16, slotTaken: true }));
    });
  }

  // node keeps these requests until the connect.
  test("before the socket connects", async () => {
    assert.deepStrictEqual(
      await run("before the connect"),
      printed({ alive: isBun ? 0 : 16, givenUp: 16, connecting: true }),
    );
  });

  test(
    "a record that outlives its request keeps no other request alive",
    { skip: !isBun && "the scenario reads the record that Bun's queue has for a request" },
    async () => {
      assert.deepStrictEqual(
        await run("a record is held"),
        printed({ alive: 0, givenUp: 15, heldRequestDestroyed: true }),
      );
    },
  );
});

describe("the order of the queue", () => {
  test("the requests that still wait keep their order when one between them is destroyed", async () => {
    using server = await serverWithOneStreamSlot();
    const { session } = await connectAndHoldTheSlot(server);
    try {
      const [a, b, c] = ["/a", "/b", "/c"].map(path => session.request({ ":path": path }));
      b.on("error", () => {});
      if (isBun) assert.deepStrictEqual([a.pending, b.pending, c.pending], [true, true, true]);
      const answered = Promise.all([statusOf(a), statusOf(c)]);
      b.destroy();
      await server.release();
      assert.deepStrictEqual(await answered, [200, 200]);
      assert.deepStrictEqual(server.paths, ["/hold", "/a", "/c"]);
    } finally {
      session.destroy();
    }
  });

  // A request is in the queue before it is published, as in node.
  test("a request() made from a 'created' subscriber waits behind the request that was published", async () => {
    using server = await serverWithOneStreamSlot();
    const { session } = await connectAndHoldTheSlot(server);
    try {
      let nested!: http2.ClientHttp2Stream;
      const requestNested = (message: unknown) => {
        const { stream, headers } = message as CreatedMessage;
        if (stream.session === session && headers[":path"] === "/outer")
          nested = session.request({ ":path": "/nested" });
      };
      dc.subscribe("http2.client.stream.created", requestNested);
      let outer: http2.ClientHttp2Stream;
      try {
        outer = session.request({ ":path": "/outer" });
      } finally {
        dc.unsubscribe("http2.client.stream.created", requestNested);
      }
      if (isBun) assert.deepStrictEqual([outer.pending, nested.pending], [true, true]);
      const answered = Promise.all([statusOf(outer), statusOf(nested)]);
      await server.release();
      assert.deepStrictEqual(await answered, [200, 200]);
      assert.deepStrictEqual(server.paths, ["/hold", "/outer", "/nested"]);
    } finally {
      session.destroy();
    }
  });

  test("a 'created' subscriber that destroys the session cancels the request that was published", async () => {
    using connecting = sessionThatNeverConnects();
    const { session } = connecting;
    const destroySession = (message: unknown) => {
      if ((message as CreatedMessage).stream.session === session) session.destroy();
    };
    dc.subscribe("http2.client.stream.created", destroySession);
    let req: http2.ClientHttp2Stream;
    try {
      req = session.request({ ":path": "/" });
    } finally {
      dc.unsubscribe("http2.client.stream.created", destroySession);
    }
    const failed = eventOf<NodeJS.ErrnoException>(req, "error");
    const closed = eventOf(req, "close");
    assert.strictEqual((await failed).code, "ERR_HTTP2_STREAM_CANCEL");
    await closed;
    assert.strictEqual(req.destroyed, true);
  });
});

if (isBun) {
  const node = Bun.which("node");
  // Alpine's node segfaults at a random point of an http2 test file (see
  // node-http2-client-close.test.ts), and the CI runner fails a file for any new core dump. The
  // glibc, macOS and Windows lanes keep the cross-check.
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", { skip: !node || isMusl }, async () => {
      await using proc = Bun.spawn({
        cmd: [node as string, "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
