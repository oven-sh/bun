/**
 * A request made while the socket of an http2 client connects is submitted by a 'connect' listener
 * that the first such request() adds, as in node. The listeners that run before that one find the
 * request pending, so a listener that refuses the peer there stops the request.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-request-before-connect.test.ts
 *   node test/js/node/http2/node-http2-request-before-connect.test.ts
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { before, describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import fixtureExports from "./node-http2-request-before-connect.fixture.js";

type Target = { url: string; tlsOptions?: { ca: string; servername: string } };
type Door = { secure: boolean; open(target: Target, listener: () => void): http2.ClientHttp2Session };
const doors: Record<string, Door> = fixtureExports.doors;
const doorNames = Object.keys(doors);
const fixture = path.join(import.meta.dirname, "node-http2-request-before-connect.fixture.js");

const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const serverIdentity = {
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
};
const tlsOptions = { ca: fs.readFileSync(path.join(keys, "ca1-cert.pem"), "utf8"), servername: "agent1" };

const isBun = typeof Bun !== "undefined";
// Node.js cannot load the harness of Bun's tests.
const harness = isBun ? await import("harness") : undefined;
// A debug build of Bun takes seconds to load node:http2 in a new process, and to run its first session.
const slowInDebug = harness?.isDebug ? { timeout: 60_000 } : {};

const FRAME_TYPES = ["DATA", "HEADERS", "PRIORITY", "RST_STREAM", "SETTINGS", "PUSH_PROMISE", "PING", "GOAWAY"];
const isHeaders = (frame: string) => frame.startsWith("HEADERS");

type PeerOptions = { secure?: boolean | "TLSv1.2"; ackSettings?: boolean; maxConcurrentStreams?: number };
type Peer = Awaited<ReturnType<typeof startPeer>>;
type Own = <S extends http2.ClientHttp2Session>(session: S) => S;

// A raw HTTP/2 peer for one client. It records the frames that the client sends, answers each HEADERS
// with a 200, and acknowledges a PING. `gone` resolves when the connection of the client ends, which is
// behind every byte it sent.
async function startPeer({ secure = false, ackSettings = true, maxConcurrentStreams }: PeerOptions) {
  const frames: string[] = [];
  const { promise: gone, resolve: onGone } = Promise.withResolvers<void>();
  const onSocket = (socket: net.Socket) => {
    let received = Buffer.alloc(0);
    let sawPreface = false;
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (!sawPreface) {
        if (received.length < 24) return;
        received = received.subarray(24);
        sawPreface = true;
      }
      while (received.length >= 9) {
        const length = received.readUIntBE(0, 3);
        if (received.length < 9 + length) break;
        const type = received[3];
        const stream = received.readUInt32BE(5) & 0x7fffffff;
        frames.push((FRAME_TYPES[type] ?? `TYPE_${type}`) + (stream ? `#${stream}` : ""));
        const isAck = (received[4] & 1) !== 0;
        if (type === 4 && !isAck && ackSettings) socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
        if (type === 6 && !isAck) {
          socket.write(Buffer.concat([Buffer.from([0, 0, 8, 6, 1, 0, 0, 0, 0]), received.subarray(9, 17)]));
        }
        if (type === 1) {
          // HEADERS with END_STREAM and END_HEADERS. 0x88 is ":status: 200".
          const response = Buffer.from([0, 0, 1, 1, 5, 0, 0, 0, 0, 0x88]);
          response.writeUInt32BE(stream, 5);
          socket.write(response);
        }
        received = received.subarray(9 + length);
      }
    });
    socket.on("end", () => socket.end());
    socket.on("close", () => onGone());
    socket.write(
      maxConcurrentStreams === undefined
        ? Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0])
        : Buffer.from([0, 0, 6, 4, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, maxConcurrentStreams]),
    );
  };
  const maxVersion = secure === "TLSv1.2" ? secure : undefined;
  const server = secure
    ? tls
        .createServer({ ...serverIdentity, ALPNProtocols: ["h2"], maxVersion }, onSocket)
        .on("tlsClientError", () => onGone())
    : net.createServer(onSocket);
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as net.AddressInfo;
  const target: Target = secure
    ? { url: `https://127.0.0.1:${port}`, tlsOptions }
    : { url: `http://127.0.0.1:${port}` };
  return { port, target, frames, gone, close: () => void server.close() };
}

// Runs `body` with a new peer. The sessions that `body` gives to `own` are destroyed at the end, also when it throws.
async function withPeer<T>(options: PeerOptions, body: (peer: Peer, own: Own) => Promise<T>): Promise<T> {
  const peer = await startPeer(options);
  const sessions: http2.ClientHttp2Session[] = [];
  try {
    return await body(peer, session => {
      sessions.push(session.on("error", () => {}));
      return session;
    });
  } finally {
    for (const session of sessions) session.destroy();
    peer.close();
  }
}

// How a request ended: its 'error' code or its status, in the order of the events.
function ending(req: http2.ClientHttp2Stream) {
  const { promise, resolve } = Promise.withResolvers<string[]>();
  const events: string[] = [];
  req.on("error", err => events.push(`error ${(err as NodeJS.ErrnoException).code}`));
  req.on("response", headers => events.push(`response ${headers[":status"]}`));
  req.on("close", () => resolve(events));
  req.resume();
  return promise;
}

function closed(session: http2.ClientHttp2Session) {
  return new Promise<void>(resolve => session.once("close", () => resolve()));
}

// Makes a request on the line behind the connect() call. The listener of the door destroys the session or does nothing.
function requestBehindConnect(door: string, listenerDestroys: boolean) {
  return withPeer({ secure: doors[door].secure }, async (peer, own) => {
    const session = own(
      doors[door].open(peer.target, () => {
        if (listenerDestroys) session.destroy();
      }),
    );
    const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
    const request = await ending(req);
    session.close();
    await peer.gone;
    return { request, id: req.id, sent: peer.frames.filter(isHeaders) };
  });
}

type ClientRun = { stdout: string[]; stderr: string; exitCode: number | null; sent: string[] };

// Runs the fixture, whose listener throws, in another process: the throw can end the process.
function runThrowingClient(door: string, survive = false): Promise<ClientRun> {
  return withPeer({ secure: doors[door].secure }, async peer => {
    const child = spawn(process.execPath, [fixture, JSON.stringify({ door, target: peer.target, survive })], {
      stdio: ["ignore", "pipe", "pipe"],
      env: harness ? harness.bunEnv : process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    const [exitCode] = await once(child, "close");
    // The listener ran, so the client did connect, and the peer sees that connection end.
    if (stdout.startsWith("listener: throws")) await peer.gone;
    return { stdout: stdout.trim().split("\n"), stderr, exitCode, sent: peer.frames.filter(isHeaders) };
  });
}

describe("a request made before the connect", () => {
  before(async () => {
    await requestBehindConnect("http2.connect(url, options, listener)", false);
  }, slowInDebug);

  for (const door of doorNames) {
    describe(door, () => {
      test("is sent when the listener accepts the peer", async () => {
        assert.deepStrictEqual(await requestBehindConnect(door, false), {
          request: ["response 200"],
          id: 1,
          sent: ["HEADERS#1"],
        });
      });

      test("is not sent when the listener destroys the session", async () => {
        assert.deepStrictEqual(await requestBehindConnect(door, true), {
          request: ["error ERR_HTTP2_STREAM_CANCEL"],
          id: undefined,
          sent: [],
        });
      });
    });
  }

  describe("is not sent when the listener throws", () => {
    const runs = new Map<string, Promise<ClientRun>>();
    // The clients start together. Each has its own peer.
    before(() => {
      for (const door of doorNames) runs.set(door, runThrowingClient(door));
      runs.set("survive", runThrowingClient("session.on('connect', listener)", true));
      for (const run of runs.values()) run.catch(() => {});
    });

    // node ends the process at the throw. The request never gets a stream id.
    const inNode = { stdout: ["listener: throws", "at exit: the request is pending"], exitCode: 1, sent: [] };
    // Bun catches a throw from these listeners and gives it to the session as its 'error'. The process goes on.
    const caughtInBun = (atExit: string) => ({
      stdout: ["listener: throws", "session error: PEER REFUSED", `at exit: the request is ${atExit}`],
      exitCode: 0,
      sent: [],
    });
    const inBun: Record<string, ReturnType<typeof caughtInBun>> = {
      "http2.connect(url, options, listener)": caughtInBun("pending"),
      "cleartext http2.connect(url, listener)": caughtInBun("pending"),
      // The session gets the throw after the queued ticks ran: the request has an id by then, and nothing is written.
      "createConnection with a net socket that still connects, socket.on('connect', listener)":
        caughtInBun("submitted"),
    };

    for (const door of doorNames) {
      // Known gap in Bun: a throw from a listener on the socket is reported, and then the ticks that
      // are queued still run. The 'connect' emit of the session is one of them, so the request is
      // submitted (`at exit: the request is submitted`, HEADERS#1 at the peer). node ends the
      // process at the throw. https://github.com/oven-sh/bun/pull/34661 makes the report do that.
      const knownGap = isBun && door === "session.socket.on('secureConnect', listener)";
      const expectFailure = knownGap ? "the process does not end at the throw" : false;
      test(door, { ...slowInDebug, expectFailure }, async () => {
        const { stdout, stderr, exitCode, sent } = await runs.get(door)!;
        const expected = (isBun && inBun[door]) || inNode;
        assert.deepStrictEqual({ stdout, exitCode, sent }, expected);
        assert.match(stdout.join("\n") + stderr, /PEER REFUSED/);
      });
    }

    test("and stays pending when the process goes on, while a later request is answered", slowInDebug, async () => {
      const { stdout, exitCode, sent } = await runs.get("survive")!;
      assert.deepStrictEqual(
        {
          uncaught: stdout.includes("uncaught: PEER REFUSED"),
          later: stdout.includes("later response: 200"),
          atExit: stdout.at(-1),
          exitCode,
          sent,
        },
        { uncaught: true, later: true, atExit: "at exit: the request is pending", exitCode: 0, sent: ["HEADERS#1"] },
      );
    });
  });

  test("is pending in a 'connect' listener added before it, and open in one added after it", () =>
    withPeer({}, async (peer, own) => {
      const seen: unknown[][] = [];
      let early!: http2.ClientHttp2Stream;
      const session = own(http2.connect(peer.target.url, () => seen.push(["listener argument", early.pending])));
      session.on("connect", () => seen.push(["added before", early.pending]));
      const listeners = [session.listenerCount("connect")];
      early = session.request({ ":path": "/" });
      listeners.push(session.listenerCount("connect"));
      const second = session.request({ ":path": "/" });
      listeners.push(session.listenerCount("connect"));
      session.on("connect", () => seen.push(["added after", early.pending, early.id, second.id]));
      assert.deepStrictEqual(await Promise.all([ending(early), ending(second)]), [["response 200"], ["response 200"]]);
      assert.deepStrictEqual(
        { seen, listenersAdded: listeners.map(count => count - listeners[0]) },
        {
          seen: [
            ["listener argument", true],
            ["added before", true],
            ["added after", false, 1, 3],
          ],
          // One 'connect' listener submits all the requests.
          listenersAdded: [0, 1, 1],
        },
      );
    }));

  test("goes out behind a request that a 'connect' listener makes first", () =>
    withPeer({}, async (peer, own) => {
      let late!: http2.ClientHttp2Stream;
      let lateEnded!: Promise<string[]>;
      const session = own(
        http2.connect(peer.target.url, () => {
          late = session.request({ ":path": "/late" });
          lateEnded = ending(late);
        }),
      );
      const early = session.request({ ":path": "/early" });
      const earlyEnded = ending(early);
      await once(session, "connect");
      assert.deepStrictEqual(await Promise.all([earlyEnded, lateEnded]), [["response 200"], ["response 200"]]);
      session.close();
      await peer.gone;
      assert.deepStrictEqual(
        { early: early.id, late: late.id, sent: peer.frames.filter(isHeaders) },
        { early: 3, late: 1, sent: ["HEADERS#1", "HEADERS#3"] },
      );
    }));

  test("keeps its place when a 'newListener' listener makes a request", () =>
    withPeer({}, async (peer, own) => {
      const session = own(http2.connect(peer.target.url));
      let second: http2.ClientHttp2Stream | undefined;
      // request() adds its 'connect' listener: this runs inside the first request() call.
      session.on("newListener", event => {
        if (event === "connect") second ??= session.request({ ":path": "/second" });
      });
      const first = session.request({ ":path": "/first" });
      assert.ok(second, "request() added no 'connect' listener");
      assert.deepStrictEqual(await Promise.all([ending(first), ending(second)]), [["response 200"], ["response 200"]]);
      assert.deepStrictEqual({ first: first.id, second: second.id }, { first: 1, second: 3 });
    }));

  // Only in Bun. node keeps the stream of the failed call as a pending stream: it holds a closed session
  // open, and session.destroy() gives it an 'error' that nothing listens to.
  test("is not queued when its request() call throws", { skip: !isBun }, () =>
    withPeer({}, async (peer, own) => {
      const session = own(http2.connect(peer.target.url));
      // request() takes any object with `aborted` as a signal. To listen on this one fails, after the stream exists.
      const signal = { aborted: false } as unknown as AbortSignal;
      assert.throws(() => session.request({ ":path": "/refused" }, { signal }), TypeError);
      const req = session.request({ ":path": "/" });
      const request = await ending(req);
      session.close();
      await peer.gone;
      assert.deepStrictEqual(
        { request, id: req.id, sent: peer.frames.filter(isHeaders) },
        { request: ["response 200"], id: 1, sent: ["HEADERS#1"] },
      );
    }),
  );

  test("is rejected when a 'connect' listener closes the session", () =>
    // This peer never acknowledges the SETTINGS: nothing that it sends ends the session.
    withPeer({ ackSettings: false }, async (peer, own) => {
      const session = own(http2.connect(peer.target.url, () => session.close()));
      const sessionClosed = closed(session);
      const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
      const seen: Record<string, unknown> = {};
      const usable = () => ({ destroyed: session.destroyed, socket: session.socket !== undefined });
      session.on("connect", () => (seen.inLaterListener = usable()));
      req.on("error", () => (seen.inErrorListener = usable()));
      const request = await ending(req);
      await sessionClosed;
      await peer.gone;
      assert.deepStrictEqual(
        { request, pending: req.pending, id: req.id, ...seen, sent: peer.frames.filter(isHeaders) },
        {
          request: ["error ERR_HTTP2_GOAWAY_SESSION"],
          pending: true,
          id: undefined,
          inLaterListener: { destroyed: false, socket: true },
          inErrorListener: { destroyed: false, socket: true },
          sent: [],
        },
      );
    }));

  test("is rejected when a 'connect' listener makes a request and closes the session", () =>
    withPeer({}, async (peer, own) => {
      let late!: http2.ClientHttp2Stream;
      let lateEnded!: Promise<string[]>;
      const session = own(
        http2.connect(peer.target.url, () => {
          late = session.request({ ":path": "/late" });
          lateEnded = ending(late);
          session.close();
        }),
      );
      const sessionClosed = closed(session);
      const early = session.request({ ":path": "/early", authorization: "Bearer SECRET" });
      const earlyEnded = ending(early);
      await once(session, "connect");
      // The session stays open for the request of the listener.
      assert.deepStrictEqual(await Promise.all([earlyEnded, lateEnded]), [
        ["error ERR_HTTP2_GOAWAY_SESSION"],
        ["response 200"],
      ]);
      await sessionClosed;
      await peer.gone;
      assert.deepStrictEqual({ late: late.id, sent: peer.frames.filter(isHeaders) }, { late: 1, sent: ["HEADERS#1"] });
    }));

  test("is rejected when a 'connect' listener pings and closes the session", () =>
    withPeer({}, async (peer, own) => {
      const { promise: ping, resolve: onPing } = Promise.withResolvers<string>();
      const session = own(
        http2.connect(peer.target.url, () => {
          session.ping(err => onPing(err ? String((err as NodeJS.ErrnoException).code) : "acknowledged"));
          session.close();
        }),
      );
      const sessionClosed = closed(session);
      const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
      const request = await ending(req);
      await sessionClosed;
      await peer.gone;
      assert.deepStrictEqual(
        { request, ping: await ping, sent: peer.frames.filter(isHeaders) },
        {
          request: ["error ERR_HTTP2_GOAWAY_SESSION"],
          // Bun waits for an ACK that is due before it ends a closed session, as its close() does. node does not.
          ping: isBun ? "acknowledged" : "ERR_HTTP2_PING_CANCEL",
          sent: [],
        },
      );
    }));

  test("is not sent when a 'connect' listener destroys it", () =>
    withPeer({}, async (peer, own) => {
      let req!: http2.ClientHttp2Stream;
      const session = own(http2.connect(peer.target.url, () => req.destroy()));
      req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
      const request = await ending(req);
      session.close();
      await peer.gone;
      assert.deepStrictEqual({ request, sent: peer.frames.filter(isHeaders) }, { request: [], sent: [] });
    }));

  test("ends, and so does the retry of its 'aborted' listener, when a listener destroys the session", () =>
    withPeer({}, async (peer, own) => {
      const session = own(http2.connect(peer.target.url, () => session.destroy()));
      const attempts: Promise<string[]>[] = [];
      // A request whose writable side is open emits 'aborted' when the session cancels it.
      const post = () => {
        const req = session.request({ ":method": "POST", ":path": "/", authorization: "Bearer SECRET" });
        req.on("aborted", () => {
          if (!session.destroyed) post();
        });
        attempts.push(ending(req));
      };
      post();
      const endings: string[][] = [];
      for (let i = 0; i < attempts.length; i++) endings.push(await attempts[i]);
      await peer.gone;
      // node: `session.destroyed` is true in the listener. Bun: it is false while destroy() runs, so the
      // listener makes one more request, and the session refuses that one.
      const refused = isBun ? [["error ERR_HTTP2_INVALID_SESSION"]] : [];
      assert.deepStrictEqual(
        { endings, sent: peer.frames.filter(isHeaders) },
        { endings: [["error ERR_HTTP2_STREAM_CANCEL"], ...refused], sent: [] },
      );
    }));

  test("stays pending without its 'connect' listener, and does not hold back later requests", () =>
    // One stream at a time: the second of the later requests waits for the slot of the first.
    withPeer({ maxConcurrentStreams: 1 }, async (peer, own) => {
      const session = own(http2.connect(peer.target.url));
      const early = session.request({ ":path": "/early", authorization: "Bearer SECRET" });
      early.on("error", () => {});
      // As in node, the listener that submits the request is an ordinary 'connect' listener.
      session.removeAllListeners("connect");
      await once(session, "remoteSettings");
      const later = [session.request({ ":path": "/later/1" }), session.request({ ":path": "/later/2" })];
      assert.deepStrictEqual(await Promise.all(later.map(ending)), [["response 200"], ["response 200"]]);
      const pending = early.pending;
      session.destroy();
      await peer.gone;
      assert.deepStrictEqual(
        { pending, later: later.map(req => req.id), sent: peer.frames.filter(isHeaders) },
        { pending: true, later: [1, 3], sent: ["HEADERS#1", "HEADERS#3"] },
      );
    }));

  test("keeps a closed session open while it is pending without its 'connect' listener", () =>
    withPeer({}, async (peer, own) => {
      const session = own(http2.connect(peer.target.url));
      const early = session.request({ ":path": "/early", authorization: "Bearer SECRET" });
      early.on("error", () => {});
      session.removeAllListeners("connect");
      // With its SETTINGS acknowledged, a closed session waits for nothing but its streams.
      await once(session, "localSettings");
      const later = session.request({ ":path": "/later" });
      session.close();
      assert.deepStrictEqual(await ending(later), ["response 200"]);
      // A session that can end does so on the immediate after its last stream. Two are past that.
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      assert.deepStrictEqual(
        { pending: early.pending, destroyed: session.destroyed, sent: peer.frames.filter(isHeaders) },
        { pending: true, destroyed: false, sent: ["HEADERS#1"] },
      );
    }));

  for (const destroyFirst of [true, false]) {
    const when = destroyFirst ? "before" : "after";
    test(`does not keep a closed session open when it is destroyed ${when} close(), without its 'connect' listener`, () =>
      withPeer({}, async (peer, own) => {
        const session = own(http2.connect(peer.target.url));
        const early = session.request({ ":path": "/early", authorization: "Bearer SECRET" });
        early.on("error", () => {});
        session.removeAllListeners("connect");
        await once(session, "localSettings");
        const sessionClosed = closed(session);
        if (destroyFirst) early.destroy();
        session.close();
        if (!destroyFirst) early.destroy();
        await sessionClosed;
        await peer.gone;
        assert.deepStrictEqual(peer.frames.filter(isHeaders), []);
      }));
  }

  test("is sent at once on a socket that is already connected", () =>
    withPeer({}, async (peer, own) => {
      const socket = net.connect(peer.port, "127.0.0.1");
      await once(socket, "connect");
      let inListener: unknown;
      let late!: http2.ClientHttp2Stream;
      let lateEnded!: Promise<string[]>;
      const session = own(
        http2.connect(peer.target.url, { createConnection: () => socket }, () => {
          inListener = { pending: early.pending, id: early.id };
          late = session.request({ ":path": "/late" });
          lateEnded = ending(late);
        }),
      );
      const listeners = session.listenerCount("connect");
      const early = session.request({ ":path": "/early" });
      const listenersAdded = session.listenerCount("connect") - listeners;
      const earlyEnded = ending(early);
      await once(session, "connect");
      assert.deepStrictEqual(await Promise.all([earlyEnded, lateEnded]), [["response 200"], ["response 200"]]);
      // node does not wait for 'connect' here: the session is not connecting.
      assert.deepStrictEqual(
        { inListener, listenersAdded, early: early.id, late: late.id },
        { inListener: { pending: false, id: 1 }, listenersAdded: 0, early: 1, late: 3 },
      );
    }));

  test("is not sent when the TLS handshake runs on a connected socket and the listener destroys the session", () =>
    withPeer({ secure: true }, async (peer, own) => {
      const socket = net.connect(peer.port, "127.0.0.1");
      await once(socket, "connect");
      // The TLS socket is not `connecting`, but its handshake is not done: the session still connects.
      const createConnection = () => tls.connect({ socket, ALPNProtocols: ["h2"], ...tlsOptions });
      const session = own(http2.connect(peer.target.url, { createConnection }, () => session.destroy()));
      const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
      const request = await ending(req);
      await peer.gone;
      assert.deepStrictEqual(
        { request, id: req.id, sent: peer.frames.filter(isHeaders) },
        { request: ["error ERR_HTTP2_STREAM_CANCEL"], id: undefined, sent: [] },
      );
    }));

  test("is not sent when the SETTINGS of the peer arrive with the end of the TLS handshake", () =>
    withPeer({ secure: "TLSv1.2" }, async (peer, own) => {
      const raw = net.connect(peer.port, "127.0.0.1");
      await once(raw, "connect");
      // The transport of a tunnel. It holds the records from ChangeCipherSpec (20) on until the first
      // application data record (23) is complete, and gives them to the TLS socket as one chunk.
      const transport = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          raw.write(chunk, callback);
        },
        final(callback) {
          raw.end();
          callback();
        },
      });
      let buffered = Buffer.alloc(0);
      let held: Buffer[] | undefined;
      let recordsInOneChunk = 0;
      raw.on("data", (chunk: Buffer) => {
        if (recordsInOneChunk > 0) return void transport.push(chunk);
        buffered = Buffer.concat([buffered, chunk]);
        const passed: Buffer[] = [];
        while (buffered.length >= 5 && buffered.length >= 5 + buffered.readUInt16BE(3)) {
          const record = buffered.subarray(0, 5 + buffered.readUInt16BE(3));
          buffered = buffered.subarray(record.length);
          if (record[0] === 20) held = [];
          (held ?? passed).push(record);
          if (held && record[0] === 23) {
            recordsInOneChunk = held.length;
            passed.push(...held, buffered);
            break;
          }
        }
        if (passed.length > 0) transport.push(Buffer.concat(passed));
      });
      raw.on("end", () => transport.push(null));
      raw.on("error", () => {});
      raw.on("close", () => transport.destroy());

      const seen: unknown[][] = [];
      const createConnection = () => tls.connect({ socket: transport, ALPNProtocols: ["h2"], ...tlsOptions });
      const session = own(http2.connect(peer.target.url, { createConnection }));
      session.on("remoteSettings", () => seen.push(["remoteSettings", req.pending]));
      session.on("connect", () => {
        seen.push(["connect", req.pending]);
        session.destroy();
      });
      const req = session.request({ ":path": "/", authorization: "Bearer SECRET" });
      const request = await ending(req);
      await peer.gone;
      assert.deepStrictEqual(
        { recordsInOneChunk, seen, request, sent: peer.frames.filter(isHeaders) },
        {
          recordsInOneChunk: 3,
          // The SETTINGS are read before the 'connect' event here, and they submit nothing.
          seen: [
            ["remoteSettings", true],
            ["connect", true],
          ],
          request: ["error ERR_HTTP2_STREAM_CANCEL"],
          sent: [],
        },
      );
    }));
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const { bunEnv, nodeExe } = harness;
  const node = nodeExe();
  // The node of Alpine crashes at a random point of the http2 files (see node-http2-client-close.test.ts).
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;

  describe("Node.js compatibility", () => {
    // One run of the whole file, with its six client processes: seconds on a loaded machine.
    test("all tests pass in Node.js", { timeout: 60_000, skip: !node || isMusl }, async () => {
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
