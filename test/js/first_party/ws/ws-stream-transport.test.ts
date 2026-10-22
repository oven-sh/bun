// Tests `ws` sockets that run over a plain JS stream: handleUpgrade() with an arbitrary Duplex, or a client with
// `createConnection`. The other end of the stream is either a raw peer or a second `ws` socket. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { openAsBlob } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { Duplex, duplexPair } from "node:stream";
import type { ServerOptions, WebSocket } from "ws";
import {
  abnormalClose,
  type ClientOptions,
  closePayload,
  createInflater,
  deflateWithContext,
  encodeFrame,
  type FrameOptions,
  HttpClient,
  implementations,
  invalidFrame,
  invalidUTF8,
  MiB,
  nextEvent,
  OP,
  type Payload,
  RawSocket,
  recordEvents,
  repeatA,
  response101,
  runScript,
  scriptTimeout,
  show,
  showFrame,
  tooBig,
  upgradeRequest,
  type WsModule,
} from "./ws-raw-peer";

const writeAfterDestroy = 'Error "Cannot call write after a stream was destroyed" ERR_STREAM_DESTROYED';

type Role = "client" | "server";
const roles: Role[] = ["client", "server"];
type Pair = [Duplex, Duplex];
// The installed @types/ws predates `closeTimeout`.
type Options = ClientOptions & ServerOptions & { closeTimeout?: number };
type Setup = {
  /** The peer's Sec-WebSocket-Extensions header: its offer to a server, or its response to a client. */
  extensions?: string;
  /** Bytes that arrive with the handshake: handleUpgrade()'s `head`, or bytes after the 101 in the same packet. */
  head?: Buffer;
  /** The socket uses the first stream and the peer uses the second. */
  pair?: Pair;
};

function parseRequest(head: string) {
  const [line, ...lines] = head.trimEnd().split("\r\n");
  const headers = Object.fromEntries(
    lines.map(header => {
      const colon = header.indexOf(":");
      return [header.slice(0, colon).toLowerCase(), header.slice(colon + 1).trim()];
    }),
  );
  return { method: line.split(" ")[0], url: line.split(" ")[1], headers } as IncomingMessage;
}

/** Reads an HTTP request from `stream` and calls `onRequest` with its head. */
function readRequest(stream: Duplex, onRequest: (head: string) => void) {
  let pending = Buffer.alloc(0);
  stream.on("data", function read(chunk: Buffer) {
    pending = Buffer.concat([pending, chunk]);
    const end = pending.indexOf("\r\n\r\n");
    if (end === -1) return;
    stream.off("data", read);
    onRequest(pending.subarray(0, end).toString("latin1"));
  });
}

function dispose(sockets: WebSocket[], streams: Duplex[]) {
  for (const ws of sockets) {
    ws.on("error", () => {});
    ws.terminate();
  }
  for (const stream of streams) stream.destroy();
}

/**
 * Opens a `ws` socket as `role` on `stream`. `peer` is a raw socket on the other stream of the pair. `events` is
 * `watch(ws)`, started after 'open'. `closed` resolves with the 'close' event's `wasClean`.
 */
async function open(implementation: WsModule, role: Role, options: Options = {}, setup: Setup = {}) {
  const { extensions, head = Buffer.alloc(0), pair = duplexPair() } = setup;
  const [stream, far] = pair;
  const events: string[] = [];
  let ws!: WebSocket;
  let peer: RawSocket;

  if (role === "server") {
    const client = (peer = new HttpClient(far));
    const request = parseRequest(upgradeRequest({ headers: { "Sec-WebSocket-Extensions": extensions ?? null } }));
    const wss = new implementation.WebSocketServer({ noServer: true, ...options });
    wss.handleUpgrade(request, stream, head, socket => void recordEvents((ws = socket), events));
    await client.nextResponse();
  } else {
    const server = (peer = new RawSocket(far as Socket, false));
    readRequest(far, request => {
      server.head = request;
      far.on("data", chunk => server.push(chunk));
      const headers = extensions ? [`Sec-WebSocket-Extensions: ${extensions}`] : [];
      far.write(Buffer.concat([Buffer.from(response101(server, headers)), head]));
    });
    ws = new implementation.WebSocket("ws://localhost/", { createConnection: () => stream, ...options });
    ws.on("open", () => void recordEvents(ws, events));
    await nextEvent(ws, "open");
  }

  const closed = new Promise<boolean>(resolve => ws.addEventListener("close", event => resolve(event.wasClean)));
  return { ws, stream, peer, events, closed, [Symbol.asyncDispose]: async () => dispose([ws], pair) };
}
type Connection = Awaited<ReturnType<typeof open>>;

/** Opens a `ws` client and a `ws` server socket, one on each stream of `pair`. */
async function openBoth(
  implementation: WsModule,
  clientOptions: Options = {},
  serverOptions: Options = {},
  pair: Pair = duplexPair(),
) {
  const [near, far] = pair;
  const wss = new implementation.WebSocketServer({ noServer: true, ...serverOptions });
  const accepted = new Promise<WebSocket>(resolve =>
    readRequest(far, head => wss.handleUpgrade(parseRequest(head), far, Buffer.alloc(0), resolve)),
  );
  const client = new implementation.WebSocket("ws://localhost/", { createConnection: () => near, ...clientOptions });
  const opened = nextEvent(client, "open");
  const server = await accepted;
  await opened;
  return { client, server, near, far, [Symbol.asyncDispose]: async () => dispose([client, server], pair) };
}

/**
 * Like duplexPair(), but write() runs the other side's 'data' listeners synchronously, even when it's called from
 * inside one of those listeners.
 */
function synchronousPair(): Pair {
  const pair: Duplex[] = [0, 1].map(
    index =>
      new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          callback();
          pair[1 - index].push(chunk);
        },
        final(callback) {
          pair[1 - index].push(null);
          callback();
        },
      }),
  );
  return pair as Pair;
}

/** Prelude for runScript(). `connect()` resolves with an OPEN client and server socket joined by a duplexPair(). */
const connectScript = `
  const { duplexPair } = require("node:stream");
  ${parseRequest}
  ${readRequest}
  const wss = new WebSocketServer({ noServer: true, clientTracking: false });
  async function connect() {
    const [near, far] = duplexPair();
    const accepted = new Promise(resolve =>
      readRequest(far, head => wss.handleUpgrade(parseRequest(head), far, Buffer.alloc(0), resolve)),
    );
    const client = new WebSocket("ws://localhost/", { createConnection: () => near });
    await new Promise(resolve => client.on("open", resolve));
    return [client, await accepted];
  }
`;

/** Expects the socket to fail the connection: 'error' while CLOSING, a Close frame with `code`, end(), 'close'. */
async function expectFailure({ peer, events, closed }: Connection, error: string, code: number) {
  expect(await peer.remainingFrames()).toEqual([`close ${code}`]);
  expect(peer.socketEvents).toEqual(["end"]);
  expect(events).toEqual([`error ${error} rs=2`]);
  peer.end();
  expect(await closed).toBe(false);
  expect(events.slice(1)).toEqual([abnormalClose]);
}

/** `callback(label)` returns a callback that records its arguments as `<label> null` or `<label> <error>`. */
function callbackRecorder() {
  const results: string[] = [];
  let wake = () => {};
  return {
    results,
    callback:
      (label: string) =>
      (...args: unknown[]) => {
        results.push([label, ...args.map(show)].join(" "));
        wake();
      },
    /** Resolves with `results` once `count` callbacks have run. */
    async resultsAfter(count: number) {
      while (results.length < count) await new Promise<void>(resolve => (wake = resolve));
      return results;
    },
  };
}

/** Re-encodes a frame that has a 7-bit length to use the 64-bit length field. */
function widenLength(frame: Buffer) {
  const length = Buffer.alloc(8);
  length[7] = frame[1] & 127;
  return Buffer.concat([Buffer.from([frame[0], frame[1] | 127]), length, frame.subarray(2)]);
}

/** 2000 pseudo-random bytes with no repeated sequences, so they don't compress. */
const noise = Buffer.alloc(2000);
for (let i = 0, x = 1; i < noise.length; i++) noise[i] = (x = (x * 1103515245 + 12345) % 2147483648) >> 16;

describe.each(implementations)("ws over a JS stream ($name)", ({ ws: implementation, builtin, specifier }) => {
  describe.each(roles)("%s", role => {
    // A server's peer is a client, and clients mask their frames.
    const mask = role === "server";
    const frame = (opcode: number, payload?: Payload, options?: FrameOptions) =>
      encodeFrame(opcode, payload, { mask, ...options });

    test("`_socket` is the stream", async () => {
      await using connection = await open(implementation, role);
      const { ws, stream, peer, events } = connection;
      expect((ws as any)._socket).toBe(stream);
      expect(ws.readyState).toBe(ws.OPEN);
      ws.send("to the peer");
      expect(await peer.next()).toBe('text "to the peer"');
      peer.text("to the socket");
      expect(await peer.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("to the socket") text rs=1']);
    });

    test("parses bytes that arrive with the handshake as frames", async () => {
      const split = frame(OP.text, "split");
      await using connection = await open(
        implementation,
        role,
        {},
        { head: Buffer.concat([frame(OP.text, "early"), frame(OP.ping, "early"), split.subarray(0, 3)]) },
      );
      const { peer, events } = connection;
      peer.write(split.subarray(3));
      expect(await peer.roundTrip()).toEqual(['pong "early"']);
      expect(events).toEqual([
        'message Buffer("early") text rs=1',
        'ping Buffer("early") rs=1',
        'message Buffer("split") text rs=1',
      ]);
    });

    describe("frames split across chunks", () => {
      test.each([
        { length: "7-bit", bytes: frame(OP.text, "hello"), message: 'Buffer("hello")' },
        { length: "16-bit", bytes: frame(OP.text, repeatA(130)), message: "Buffer(130 bytes)" },
        { length: "64-bit", bytes: widenLength(frame(OP.text, "hello")), message: 'Buffer("hello")' },
      ])("one byte at a time, with a $length length", async ({ bytes, message }) => {
        await using connection = await open(implementation, role);
        const { ws, stream, peer, events } = connection;
        let chunks = 0;
        stream.prependListener("data", () => chunks++);
        const received = nextEvent(ws, "message");
        for (const byte of bytes) peer.write(Buffer.from([byte]));
        await received;
        expect(chunks).toBe(bytes.length);
        expect(events).toEqual([`message ${message} text rs=1`]);
      });

      test("control frames one byte at a time", async () => {
        await using connection = await open(implementation, role);
        const { peer, events, closed } = connection;
        const bytes = Buffer.concat([
          frame(OP.ping, "0123456789"),
          frame(OP.pong, "abcdefghij"),
          frame(OP.close, closePayload(4000, "a reason")),
        ]);
        for (const byte of bytes) peer.write(Buffer.from([byte]));
        peer.end();
        expect(await peer.remainingFrames()).toEqual(['pong "0123456789"', 'close 4000 "a reason"']);
        expect(await closed).toBe(true);
        expect(events).toEqual([
          'ping Buffer("0123456789") rs=1',
          'pong Buffer("abcdefghij") rs=1',
          'close 4000 Buffer("a reason") rs=3',
        ]);
      });

      test.each([
        { label: "1", offsets: [1] },
        { label: "2", offsets: [2] },
        { label: "3", offsets: [3] },
        { label: "5", offsets: [5] },
        { label: "1, 3, 6 and 11", offsets: [1, 3, 6, 11] },
      ])("a payload split at $label", async ({ offsets }) => {
        await using connection = await open(implementation, role);
        const { stream, peer, events } = connection;
        const payload = "0123456789abcde";
        const bytes = Buffer.concat([frame(OP.text, payload), frame(OP.text, "next")]);
        const start = frame(OP.text, payload).length - payload.length;
        const sizes: number[] = [];
        stream.prependListener("data", chunk => sizes.push(chunk.length));
        const cuts = [0, ...offsets.map(offset => start + offset), bytes.length];
        for (let i = 1; i < cuts.length; i++) peer.write(bytes.subarray(cuts[i - 1], cuts[i]));
        expect(await peer.roundTrip()).toEqual([]);
        expect(sizes.slice(0, -1)).toEqual(cuts.slice(1).map((cut, i) => cut - cuts[i]));
        expect(events).toEqual([`message Buffer("${payload}") text rs=1`, 'message Buffer("next") text rs=1']);
      });

      test("64 KiB in 1021-byte chunks", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer } = connection;
        const payload = Buffer.alloc(65536);
        for (let i = 0; i < payload.length; i += noise.length) noise.copy(payload, i);
        const bytes = frame(OP.binary, payload);
        const received = nextEvent(ws, "message");
        for (let i = 0; i < bytes.length; i += 1021) peer.write(bytes.subarray(i, i + 1021));
        const [data, isBinary] = await received;
        expect(isBinary).toBe(true);
        expect(payload.equals(data)).toBe(true);
      });

      test.each([{ chunks: "one chunk" }, { chunks: "three chunks" }])(
        "a ping between two fragments, in $chunks",
        async ({ chunks }) => {
          await using connection = await open(implementation, role);
          const { peer, events } = connection;
          const frames = [
            frame(OP.text, "frag", { fin: false }),
            frame(OP.ping, "between"),
            frame(OP.continuation, "ments"),
          ];
          for (const bytes of chunks === "one chunk" ? [Buffer.concat(frames)] : frames) peer.write(bytes);
          expect(await peer.roundTrip()).toEqual(['pong "between"']);
          expect(events).toEqual(['ping Buffer("between") rs=1', 'message Buffer("fragments") text rs=1']);
        },
      );

      test("50 frames in one chunk, each echoed from the 'message' listener", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer } = connection;
        const numbers = Array.from({ length: 50 }, (_, i) => `${i}`);
        ws.on("message", data => ws.send(`echo ${data}`));
        peer.write(Buffer.concat(numbers.map(number => frame(OP.text, number))));
        expect(await peer.nextFrames(50)).toEqual(numbers.map(number => `text "echo ${number}"`));
      });

      test("a truncated frame followed by the end of the stream", async () => {
        await using connection = await open(implementation, role);
        const { peer, events, closed } = connection;
        peer.write(frame(OP.text, "never complete").subarray(0, 9));
        peer.end();
        expect(await peer.remainingFrames()).toEqual([]);
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
      });

      test("frames with an empty payload", async () => {
        await using connection = await open(implementation, role);
        const { peer, events } = connection;
        peer.text("");
        peer.binary("");
        peer.ping();
        peer.pong();
        expect(await peer.roundTrip()).toEqual(["pong"]);
        expect(events).toEqual([
          "message Buffer() text rs=1",
          "message Buffer() binary rs=1",
          "ping Buffer() rs=1",
          "pong Buffer() rs=1",
        ]);
      });
    });

    test("ticks and microtasks scheduled by a listener run after the stream's 'data' event", async () => {
      await using connection = await open(implementation, role);
      const { ws, stream, peer } = connection;
      const order: string[] = [];
      ws.on("message", () => {
        order.push("'message'");
        process.nextTick(() => order.push("tick"));
        Promise.resolve().then(() => order.push("promise reaction"));
      });
      stream.on("data", () => order.push("the next 'data' listener"));
      peer.text("x");
      order.push("write() has returned");
      await new Promise(resolve => process.nextTick(resolve));
      expect(order.slice(0, 3)).toEqual(["'message'", "the next 'data' listener", "write() has returned"]);
      expect(order.slice(3).sort()).toEqual(["promise reaction", "tick"]);
    });

    test(`sends every frame ${mask ? "unmasked" : "masked"}`, async () => {
      await using connection = await open(implementation, role);
      const { ws, peer } = connection;
      ws.send("text");
      ws.send(Buffer.from([1, 2]));
      ws.send("");
      ws.send("frag", { fin: false });
      ws.send("ments", { fin: true });
      ws.send(repeatA(126));
      ws.send(repeatA(65536));
      ws.ping("ping");
      ws.pong("pong");
      const sent = await peer.nextFrames(9);
      peer.ping("answer me");
      sent.push(await peer.next());
      ws.close(1000, "bye");
      sent.push(await peer.next());
      // showFrame() appends "masked" or "unmasked" to a frame with the wrong mask bit.
      expect(sent).toEqual([
        'text "text"',
        "binary 0x0102",
        "text",
        'text "frag" !fin',
        'continuation "ments"',
        "text 126 bytes",
        "text 65536 bytes",
        'ping "ping"',
        'pong "pong"',
        'pong "answer me"',
        'close 1000 "bye"',
      ]);
      expect(peer.frames.map(frame => frame.masked)).toEqual(Array(11).fill(!mask));
    });

    describe("fails the connection on", () => {
      test.each([
        mask
          ? {
              label: "an unmasked frame",
              bytes: encodeFrame(OP.text, "x"),
              error: invalidFrame("MASK must be set", "WS_ERR_EXPECTED_MASK"),
              code: 1002,
            }
          : {
              label: "a masked frame",
              bytes: encodeFrame(OP.text, "x", { mask: true }),
              error: invalidFrame("MASK must be clear", "WS_ERR_UNEXPECTED_MASK"),
              code: 1002,
            },
        {
          label: "opcode 3",
          bytes: frame(3, "x"),
          error: invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE"),
          code: 1002,
        },
        {
          label: "RSV1 without an extension",
          bytes: frame(OP.text, "x", { rsv1: true }),
          error: invalidFrame("RSV1 must be clear", "WS_ERR_UNEXPECTED_RSV_1"),
          code: 1002,
        },
        {
          label: "a ping without FIN",
          bytes: frame(OP.ping, "x", { fin: false }),
          error: invalidFrame("FIN must be set", "WS_ERR_EXPECTED_FIN"),
          code: 1002,
        },
        {
          label: "a Close frame with code 1005",
          bytes: frame(OP.close, closePayload(1005)),
          error: invalidFrame("invalid status code 1005", "WS_ERR_INVALID_CLOSE_CODE"),
          code: 1002,
        },
        {
          label: "invalid UTF-8 text",
          bytes: frame(OP.text, Buffer.from([0xc3, 0x28])),
          error: invalidUTF8,
          code: 1007,
        },
      ])("$label", async ({ bytes, error, code }) => {
        await using connection = await open(implementation, role);
        // Frames after the invalid one must be ignored.
        connection.peer.write(Buffer.concat([bytes, frame(OP.text, "same chunk")]));
        connection.peer.text("next chunk");
        await expectFailure(connection, error, code);
      });

      test.each([
        { label: "a 126-byte ping", opcode: OP.ping, length: 126 },
        { label: "a 1-byte Close frame", opcode: OP.close, length: 1 },
      ])("just the first two bytes of $label", async ({ opcode, length }) => {
        await using connection = await open(implementation, role);
        connection.peer.write(Buffer.from([0x80 | opcode, (mask ? 0x80 : 0) | length]));
        const error = invalidFrame(`invalid payload length ${length}`, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
        await expectFailure(connection, error, 1002);
      });
    });

    describe("permessage-deflate", () => {
      // The second message repeats bytes from 2000 bytes back and the third from 500 bytes back. A sender whose window
      // reaches that far emits a back-reference, which makes the frame short.
      const messages = [noise, noise, noise.subarray(-500)];
      const windows = {
        "32 KiB": { windowBits: 15, sizes: ["long", "short", "short"] },
        "1 KiB": { windowBits: 10, sizes: ["long", "long", "short"] },
        "no context takeover": { windowBits: 0, sizes: ["long", "long", "long"] },
      };

      test.each([
        { parameters: "server_no_context_takeover", client: "32 KiB", server: "no context takeover" },
        { parameters: "client_max_window_bits=10", client: "1 KiB", server: "32 KiB" },
      ] as const)("$parameters", async row => {
        await using connection = await open(
          implementation,
          role,
          { perMessageDeflate: { threshold: 0 } },
          { extensions: `permessage-deflate; ${row.parameters}` },
        );
        const { ws, peer } = connection;
        expect(ws.extensions).toBe("permessage-deflate");
        expect(peer.header("sec-websocket-extensions")).toBe(
          role === "server" ? `permessage-deflate; ${row.parameters}` : "permessage-deflate; client_max_window_bits",
        );

        const ownWindow = windows[row[role]];
        let inflate = createInflater();
        for (const message of messages) ws.send(message);
        const sizes: string[] = [];
        for (const message of messages) {
          const sent = (await peer.nextFrame())!;
          expect(sent.rsv).toBe(4);
          if (!ownWindow.windowBits) inflate = createInflater();
          expect(inflate(sent.payload).equals(message)).toBe(true);
          sizes.push(sent.length < 100 ? "short" : "long");
        }
        expect(sizes).toEqual(ownWindow.sizes);

        const { windowBits } = windows[row[role === "server" ? "client" : "server"]];
        const payloads = windowBits
          ? await deflateWithContext(messages, windowBits)
          : (await Promise.all(messages.map(message => deflateWithContext([message], 15)))).flat();
        const received: Buffer[] = [];
        ws.on("message", data => received.push(data as Buffer));
        for (const payload of payloads) peer.binary(payload, { rsv1: true });
        expect(await peer.roundTrip()).toEqual([]);
        expect(received.map((data, i) => data.equals(messages[i]))).toEqual([true, true, true]);
      });

      test("a fragmented compressed message, split across chunks, with a ping in between", async () => {
        await using connection = await open(
          implementation,
          role,
          { perMessageDeflate: true },
          { extensions: "permessage-deflate" },
        );
        const { ws, peer } = connection;
        const message = Buffer.concat([noise, Buffer.alloc(3000, "a"), noise]);
        const [payload] = await deflateWithContext([message], 15);
        const bytes = Buffer.concat([
          frame(OP.binary, payload.subarray(0, 1000), { rsv1: true, fin: false }),
          frame(OP.ping, "between"),
          frame(OP.continuation, payload.subarray(1000, 1001), { fin: false }),
          frame(OP.continuation, payload.subarray(1001)),
        ]);
        const received = nextEvent(ws, "message");
        for (let i = 0; i < bytes.length; i += 333) peer.write(bytes.subarray(i, i + 333));
        const [data, isBinary] = await received;
        expect(isBinary).toBe(true);
        expect(message.equals(data)).toBe(true);
        expect(await peer.next()).toBe('pong "between"');
      });

      test("maxPayload applies to the inflated size", async () => {
        await using connection = await open(
          implementation,
          role,
          { perMessageDeflate: true, maxPayload: 1000 },
          { extensions: "permessage-deflate" },
        );
        const { peer, events } = connection;
        const [fits, tooLong] = await deflateWithContext([Buffer.alloc(1000, "a"), Buffer.alloc(1001, "a")], 15);
        peer.text(fits, { rsv1: true });
        expect(await peer.roundTrip()).toEqual([]);
        expect(events.splice(0)).toEqual(["message Buffer(1000 bytes) text rs=1"]);
        peer.text(tooLong, { rsv1: true });
        await expectFailure(connection, tooBig, 1009);
      });
    });

    describe("the closing handshake", () => {
      test("close() ends the stream after the peer's Close frame and emits 'close' after the peer's end", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, peer, events, closed } = connection;
        ws.close(1000, "mine");
        expect(await peer.next()).toBe('close 1000 "mine"');

        const received = nextEvent(ws, "message");
        peer.text("still read");
        await received;
        expect(events).toEqual(['message Buffer("still read") text rs=2']);
        expect(stream.writableEnded).toBe(false);

        peer.close(4001, "theirs");
        expect(await peer.remainingFrames()).toEqual([]);
        expect(peer.socketEvents).toEqual(["end"]);
        expect(events.slice(1)).toEqual([]);
        expect(ws.readyState).toBe(ws.CLOSING);

        peer.end();
        expect(await closed).toBe(true);
        expect(events.slice(1)).toEqual(['close 4001 Buffer("theirs") rs=3']);
        expect(stream.destroyed).toBe(true);
      });

      test.each([
        {
          label: "with a code and a reason",
          args: [4000, "theirs"],
          echo: 'close 4000 "theirs"',
          close: 'close 4000 Buffer("theirs") rs=3',
        },
        { label: "with a code", args: [1001], echo: "close 1001", close: "close 1001 Buffer() rs=3" },
        { label: "without a code", args: [], echo: "close", close: "close 1005 Buffer() rs=3" },
      ])("echoes a Close frame $label, then ends the stream", async ({ args, echo, close }) => {
        await using connection = await open(implementation, role);
        const { ws, peer, events, closed } = connection;
        peer.close(...(args as [number, string]));
        expect(await peer.remainingFrames()).toEqual([echo]);
        expect(peer.socketEvents).toEqual(["end"]);
        expect(events).toEqual([]);
        expect(ws.readyState).toBe(ws.CLOSING);
        peer.end();
        expect(await closed).toBe(true);
        expect(events).toEqual([close]);
      });

      test("ignores data after the peer's Close frame", async () => {
        await using connection = await open(implementation, role);
        const { peer, events, closed } = connection;
        peer.write(Buffer.concat([frame(OP.close, closePayload(1000)), frame(OP.text, "same chunk"), frame(OP.ping)]));
        peer.text("next chunk");
        peer.end();
        expect(await peer.remainingFrames()).toEqual(["close 1000"]);
        expect(await closed).toBe(true);
        expect(events).toEqual(["close 1000 Buffer() rs=3"]);
      });

      test("close() from a 'ping' listener sends the pong first", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer, closed } = connection;
        ws.on("ping", () => ws.close(1000));
        peer.ping("x");
        expect(await peer.nextFrames(2)).toEqual(['pong "x"', "close 1000"]);
        peer.close(1000);
        peer.end();
        expect(await closed).toBe(true);
      });

      test("the Close frame is queued behind data the stream hasn't flushed yet", async () => {
        await using connection = await open(implementation, role, {}, { pair: duplexPair({ highWaterMark: 1024 }) });
        const { ws, peer, closed } = connection;
        peer.socket.pause();
        ws.send(repeatA(2000));
        ws.send(repeatA(3000));
        ws.close(1000, "last");
        peer.socket.resume();
        expect(await peer.nextFrames(3)).toEqual(["text 2000 bytes", "text 3000 bytes", 'close 1000 "last"']);
        peer.close(1000, "last");
        peer.end();
        expect(await closed).toBe(true);
      });

      test("parses a Close frame that is still buffered in a destroyed stream", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, peer, events, closed } = connection;
        ws.pause();
        peer.write(Buffer.concat([frame(OP.text, "held back"), frame(OP.close, closePayload(4000, "held back"))]));
        expect(stream.readableLength).toBeGreaterThan(0);
        stream.destroy();
        expect(await closed).toBe(false);
        expect(events).toEqual(['message Buffer("held back") text rs=2', 'close 4000 Buffer("held back") rs=3']);
      });

      test("when both sides close at once, each sends one Close frame", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer, events, closed } = connection;
        ws.close(1000, "mine");
        peer.close(1001, "theirs");
        peer.end();
        expect(await peer.remainingFrames()).toEqual(['close 1000 "mine"']);
        expect(await closed).toBe(true);
        expect(events).toEqual(['close 1001 Buffer("theirs") rs=3']);
      });

      test("the peer ends the stream without a Close frame", async () => {
        await using connection = await open(implementation, role);
        const { stream, peer, events, closed } = connection;
        peer.end();
        expect(await peer.remainingFrames()).toEqual([]);
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
        expect(stream.destroyed).toBe(true);
      });

      test("the peer answers close() by ending the stream", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer, events, closed } = connection;
        ws.close(1000);
        peer.end();
        expect(await peer.remainingFrames()).toEqual(["close 1000"]);
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
      });

      test.each([
        { when: "an open socket", before: (_ws: WebSocket) => {} },
        { when: "a closing socket", before: (ws: WebSocket) => ws.close(1000) },
      ])("terminate() on $when destroys the stream", async ({ before }) => {
        await using connection = await open(implementation, role);
        const { ws, stream, events, closed } = connection;
        before(ws);
        ws.terminate();
        expect(stream.destroyed).toBe(true);
        expect(ws.readyState).toBe(ws.CLOSING);
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
      });

      test("terminate() after both Close frames, before the peer has ended the stream", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, peer, events, closed } = connection;
        ws.close(1000);
        peer.close(1000);
        await peer.ended;
        expect(stream.destroyed).toBe(false);
        ws.terminate();
        expect(stream.destroyed).toBe(true);
        expect(await closed).toBe(true);
        expect(events).toEqual(["close 1000 Buffer() rs=3"]);
      });

      test("terminate() from a 'message' listener", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, peer, events, closed } = connection;
        ws.on("message", () => ws.terminate());
        peer.text("go");
        expect(await closed).toBe(false);
        expect(events).toEqual(['message Buffer("go") text rs=1', abnormalClose]);
        expect(stream.destroyed).toBe(true);
        expect(peer.frames).toEqual([]);
      });

      test("close() from a 'message' listener", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer, events, closed } = connection;
        ws.on("message", () => ws.close(1000, "done"));
        peer.text("go");
        expect(await peer.next()).toBe('close 1000 "done"');
        peer.close(1000, "done");
        peer.end();
        expect(await closed).toBe(true);
        expect(events).toEqual(['message Buffer("go") text rs=1', 'close 1000 Buffer("done") rs=3']);
      });

      // The installed npm ws predates `closeTimeout` and hardcodes 30 s.
      describe.skipIf(!builtin)("`closeTimeout` destroys the stream when the peer never ends it", () => {
        test.each([
          {
            label: "an unanswered close()",
            start: ({ ws }) => ws.close(1000),
            sent: ["close 1000"],
            events: [abnormalClose],
            clean: false,
          },
          {
            label: "an answered close()",
            start: ({ ws, peer }) => (ws.close(1000), peer.close(1000)),
            sent: ["close 1000"],
            events: ["close 1000 Buffer() rs=3"],
            clean: true,
          },
          {
            label: "the peer's Close frame",
            start: ({ peer }) => peer.close(4000),
            sent: ["close 4000"],
            events: ["close 4000 Buffer() rs=3"],
            clean: true,
          },
          {
            label: "a protocol error",
            start: ({ peer }) => peer.send(3),
            sent: ["close 1002"],
            events: [`error ${invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE")} rs=2`, abnormalClose],
            clean: false,
          },
        ] as {
          label: string;
          start(connection: Connection): void;
          sent: string[];
          events: string[];
          clean: boolean;
        }[])("after $label", async ({ start, sent, events, clean }) => {
          await using connection = await open(implementation, role, { closeTimeout: 20 });
          start(connection);
          expect(await connection.closed).toBe(clean);
          expect(connection.events).toEqual(events);
          expect(connection.stream.destroyed).toBe(true);
          expect(connection.peer.frames.map(showFrame)).toEqual(sent);
        });

        // Expected values are from npm ws 8.18.3 on Node v26.3.0, with its 30 s timer shortened.
        test.each<{
          buffered: string;
          frames: [opcode: number, payload?: Payload][];
          events: string[];
          clean: boolean;
        }>([
          {
            buffered: "a message and a Close frame",
            frames: [
              [OP.text, "held back"],
              [OP.close, closePayload(4000, "held back")],
            ],
            events: ['message Buffer("held back") text rs=2', 'close 4000 Buffer("held back") rs=3'],
            clean: true,
          },
          {
            buffered: "a Ping and a message",
            frames: [
              [OP.ping, "p"],
              [OP.text, "held back"],
            ],
            events: ['ping Buffer("p") rs=2', 'message Buffer("held back") text rs=2', abnormalClose],
            clean: false,
          },
          {
            buffered: "an invalid frame",
            frames: [[3, "x"]],
            events: [`error ${invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE")} rs=2`, abnormalClose],
            clean: false,
          },
        ])("parses $buffered still buffered in a paused stream", async ({ frames, events, clean }) => {
          await using connection = await open(implementation, role, { closeTimeout: 20 });
          const { ws, stream, peer } = connection;
          ws.pause();
          peer.write(Buffer.concat(frames.map(args => frame(...args))));
          expect(stream.readableLength).toBeGreaterThan(0);
          ws.close(1000);
          expect(await connection.closed).toBe(clean);
          expect(connection.events).toEqual(events);
          expect(peer.frames.map(showFrame)).toEqual(["close 1000"]);
        });
      });
    });

    describe("when the stream fails", () => {
      test("destroy(error) emits 'close' with 1006 and no 'error'", async () => {
        await using connection = await open(implementation, role);
        const { stream, events, closed } = connection;
        stream.destroy(new Error("boom"));
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
      });

      test("an 'error' event destroys the stream", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, events, closed } = connection;
        stream.emit("error", new Error("boom"));
        expect(stream.destroyed).toBe(true);
        expect(ws.readyState).toBe(ws.CLOSING);
        expect(await closed).toBe(false);
        expect(events).toEqual([abnormalClose]);
      });
    });

    describe("send callbacks", () => {
      test("fire in call order with null", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer } = connection;
        const { callback, resultsAfter } = callbackRecorder();
        ws.send("a", callback("send"));
        ws.ping("b", undefined, callback("ping"));
        ws.send(Buffer.alloc(70000), callback("send 70000"));
        ws.pong("c", undefined, callback("pong"));
        ws.send("", { fin: false }, callback("fragment"));
        ws.send("", callback("last"));
        expect(await resultsAfter(6)).toEqual([
          "send null",
          "ping null",
          "send 70000 null",
          "pong null",
          "fragment null",
          "last null",
        ]);
        expect(await peer.nextFrames(6)).toEqual([
          'text "a"',
          'ping "b"',
          "binary 70000 bytes",
          'pong "c"',
          "text !fin",
          "continuation",
        ]);
      });

      // The stream is written to in the store that the socket was created in, so the stream's own write callbacks run
      // there. npm ws, on Node too, runs the callback of a queued write in the store of the write in front of it, and
      // the callback of a compressed send in the store of the first compressed send.
      test.skipIf(!builtin).each([
        { extension: "without permessage-deflate", options: {}, setup: {} },
        {
          extension: "with permessage-deflate",
          options: { perMessageDeflate: { threshold: 0 } },
          setup: { extensions: "permessage-deflate" },
        },
      ])("run in the AsyncLocalStorage store of their own call, $extension", async ({ options, setup }) => {
        const storage = new AsyncLocalStorage<string>();
        await using connection = await storage.run("the socket's", () => open(implementation, role, options, setup));
        const { ws } = connection;
        const calls: string[][] = [];
        const { promise: done, resolve } = Promise.withResolvers<void>();
        const callback =
          (call: string) =>
          (...args: unknown[]) => {
            if (calls.push([call, args.map(show).join(", "), storage.getStore() ?? "no store"]) === 5) resolve();
          };
        ws.send("a", callback("send"));
        ws.ping("b", undefined, callback("ping"));
        ws.pong("c", undefined, callback("pong"));
        storage.run("the sender's", () => ws.send("d", callback("send")));
        storage.run("the pinger's", () => ws.ping("e", undefined, callback("ping")));
        await done;
        expect(calls).toEqual([
          ["send", "null", "no store"],
          ["ping", "null", "no store"],
          ["pong", "null", "no store"],
          ["send", "null", "the sender's"],
          ["ping", "null", "the pinger's"],
        ]);
      });

      test.each([null, false, 0, ""])("a callback that is %p is ignored", async ignored => {
        await using connection = await open(implementation, role);
        const { ws, peer } = connection;
        const { callback, resultsAfter } = callbackRecorder();
        ws.send("a", {}, ignored as any);
        ws.ping("b", undefined, ignored as any);
        ws.pong("c", undefined, ignored as any);
        ws.send("d", callback("send"));
        expect(await resultsAfter(1)).toEqual(["send null"]);
        expect(await peer.nextFrames(4)).toEqual(['text "a"', 'ping "b"', 'pong "c"', 'text "d"']);
      });

      // npm ws reads every Blob asynchronously. The built-in can't read a file-backed Blob synchronously in send(), so
      // it throws.
      test.skipIf(!builtin).each([
        { blob: "Bun.file()", make: (file: string) => Bun.file(file) },
        { blob: "fs.openAsBlob()", make: (file: string) => openAsBlob(file) },
      ])(
        "send($blob, { fin: false }) throws, never reports success and doesn't start a fragmented message",
        async ({ make }) => {
          using dir = tempDir("ws-send-file", { "data.txt": "from a file" });
          const blob = await make(path.join(String(dir), "data.txt"));
          await using connection = await open(implementation, role);
          const { ws, peer } = connection;
          const results: unknown[] = [];
          expect(() => ws.send(blob as any, { fin: false }, error => results.push(error))).toThrow("file");
          const sent = new Promise(resolve => ws.send("x", resolve));
          expect(await peer.roundTrip()).toEqual(['text "x"']);
          expect(await sent).toBeNull();
          expect(results.filter(result => !(result instanceof Error))).toEqual([]);
        },
      );

      test.skipIf(!builtin).each(["ping", "pong"] as const)(
        "%s(Bun.file()) throws and its callback isn't reused for the next frame",
        async method => {
          using dir = tempDir("ws-ping-file", { "data.txt": "file" });
          await using connection = await open(implementation, role);
          const { ws, stream, peer } = connection;
          const results: unknown[] = [];
          const file = Bun.file(path.join(String(dir), "data.txt"));
          expect(() => ws[method](file, undefined, error => results.push(error))).toThrow("file");
          // A frame the engine writes on its own would pick up a stale callback if one was left behind.
          ws.close(1000);
          expect(await peer.nextFrames(1)).toEqual(["close 1000"]);
          // Stream write callbacks run in write order, so this one runs after the Close frame's.
          await new Promise(resolve => stream.write(Buffer.alloc(0), resolve));
          expect(results).toEqual([]);
        },
      );

      test("a Blob keeps its position in the send order", async () => {
        await using connection = await open(implementation, role);
        const { ws, peer } = connection;
        const { callback, resultsAfter } = callbackRecorder();
        ws.send("before", callback("before"));
        ws.send(new Blob(["a ", "Blob"]) as any, callback("Blob"));
        ws.send("after", callback("after"));
        ws.ping(new Blob(["ping"]), undefined, callback("ping"));
        expect(await resultsAfter(4)).toEqual(["before null", "Blob null", "after null", "ping null"]);
        expect(await peer.nextFrames(4)).toEqual(['text "before"', 'binary "a Blob"', 'text "after"', 'ping "ping"']);
      });

      test("get an Error for sends after the stream was destroyed", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, events, closed } = connection;
        const { callback, resultsAfter } = callbackRecorder();
        stream.destroy();
        expect(ws.readyState).toBe(ws.OPEN);
        ws.send("a", callback("send"));
        ws.ping("b", undefined, callback("ping"));
        ws.pong("c", undefined, callback("pong"));
        expect(await resultsAfter(3)).toEqual([
          `send ${writeAfterDestroy}`,
          `ping ${writeAfterDestroy}`,
          `pong ${writeAfterDestroy}`,
        ]);
        await closed;
        expect(events).toEqual([abnormalClose]);
      });

      test("get an Error for sends still queued when the stream was destroyed", async () => {
        await using connection = await open(implementation, role);
        const { ws, stream, events, closed } = connection;
        const { callback, resultsAfter } = callbackRecorder();
        // The stream is busy with the first write until the next tick, so the others are queued behind it.
        ws.send("first");
        ws.send("a", callback("send"));
        ws.ping("b", undefined, callback("ping"));
        expect(stream.writableLength).toBeGreaterThan(0);
        stream.destroy();
        expect(await resultsAfter(2)).toEqual([`send ${writeAfterDestroy}`, `ping ${writeAfterDestroy}`]);
        await closed;
        expect(events).toEqual([abnormalClose]);
      });

      test("are deferred, and bufferedAmount grows, while the stream isn't draining", async () => {
        await using connection = await open(implementation, role, {}, { pair: duplexPair({ highWaterMark: 1024 }) });
        const { ws, peer } = connection;
        const { results, callback, resultsAfter } = callbackRecorder();
        peer.socket.pause();
        const size = 2000 + (mask ? 4 : 8);
        const amounts: number[] = [];
        for (const label of ["a", "b", "c"]) {
          ws.send(Buffer.alloc(2000, label), callback(label));
          amounts.push(ws.bufferedAmount);
        }
        expect(amounts).toEqual([size, 2 * size, 3 * size]);

        // Once the other side's readable buffer is over its highWaterMark, it stops pulling until something reads it.
        while (peer.socket.readableLength < 1024) await new Promise(setImmediate);
        expect(results).toEqual([]);
        expect(ws.bufferedAmount).toBeGreaterThanOrEqual(3 * size - 8);

        peer.socket.resume();
        expect(await resultsAfter(3)).toEqual(["a null", "b null", "c null"]);
        expect(ws.bufferedAmount).toBe(0);
        expect(await peer.nextFrames(3)).toEqual(["binary 2000 bytes", "binary 2000 bytes", "binary 2000 bytes"]);
      });
    });

    test("pause() buffers everything until resume()", async () => {
      await using connection = await open(implementation, role);
      const { ws, stream, peer, events } = connection;
      ws.pause();
      expect(ws.isPaused).toBe(true);
      const bytes = Buffer.concat([frame(OP.text, "one"), frame(OP.ping, "two"), frame(OP.binary, "three")]);
      // The callback runs once the socket's stream has buffered the bytes and asks for more.
      await new Promise(resolve => peer.socket.write(bytes, resolve));
      expect(stream.readableLength).toBe(bytes.length);
      expect(events).toEqual([]);
      expect(peer.frames).toEqual([]);

      ws.resume();
      expect(ws.isPaused).toBe(false);
      expect(await peer.roundTrip()).toEqual(['pong "two"']);
      expect(events).toEqual([
        'message Buffer("one") text rs=1',
        'ping Buffer("two") rs=1',
        'message Buffer("three") binary rs=1',
      ]);
    });

    test("1 MiB text and binary messages in both directions", async () => {
      await using connection = await open(implementation, role);
      const { ws, peer } = connection;
      const binary = Buffer.alloc(MiB);
      for (let i = 0; i < MiB; i += noise.length) noise.copy(binary, i);
      const text = binary.toString("base64").slice(0, MiB);

      const received: [data: Buffer, isBinary: boolean][] = [];
      ws.on("message", (data, isBinary) => received.push([data as Buffer, isBinary]));
      peer.text(text);
      peer.binary(binary);
      expect(await peer.roundTrip()).toEqual([]);
      expect(received.map(([data, isBinary]) => [data.length, isBinary])).toEqual([
        [MiB, false],
        [MiB, true],
      ]);
      expect(received[0][0].equals(Buffer.from(text))).toBe(true);
      expect(received[1][0].equals(binary)).toBe(true);

      ws.send(text);
      ws.send(binary);
      const sent = [(await peer.nextFrame())!, (await peer.nextFrame())!];
      expect(sent.map(showFrame)).toEqual([`text ${MiB} bytes`, `binary ${MiB} bytes`]);
      expect(sent[0].payload.equals(Buffer.from(text))).toBe(true);
      expect(sent[1].payload.equals(binary)).toBe(true);
    });

    describe("maxPayload: 10", () => {
      test.each([
        { label: "10 bytes", frames: [frame(OP.text, repeatA(10))] },
        {
          label: "fragments of 5 and 5 bytes",
          frames: [frame(OP.text, repeatA(5), { fin: false }), frame(OP.continuation, repeatA(5))],
        },
      ])("delivers $label", async ({ frames }) => {
        await using connection = await open(implementation, role, { maxPayload: 10 });
        const { peer, events } = connection;
        for (const bytes of frames) peer.write(bytes);
        expect(await peer.roundTrip()).toEqual([]);
        expect(events).toEqual(['message Buffer("aaaaaaaaaa") text rs=1']);
      });

      test.each([
        { label: "11 bytes", frames: [frame(OP.text, repeatA(11))] },
        { label: "the header of an 11-byte frame", frames: [frame(OP.text, repeatA(11)).subarray(0, 2)] },
        {
          label: "fragments of 5 and 6 bytes",
          frames: [frame(OP.text, repeatA(5), { fin: false }), frame(OP.continuation, repeatA(6))],
        },
      ])("fails the connection on $label", async ({ frames }) => {
        await using connection = await open(implementation, role, { maxPayload: 10 });
        for (const bytes of frames) connection.peer.write(bytes);
        await expectFailure(connection, tooBig, 1009);
      });
    });

    test("skipUTF8Validation delivers invalid UTF-8 text", async () => {
      await using connection = await open(implementation, role, { skipUTF8Validation: true });
      const { peer, events } = connection;
      peer.text(Buffer.from([0xc3, 0x28]));
      expect(await peer.roundTrip()).toEqual([]);
      expect(events).toEqual(["message Buffer(0xc328) text rs=1"]);
    });

    test("autoPong: false doesn't send a pong automatically", async () => {
      await using connection = await open(implementation, role, { autoPong: false });
      const { ws, peer, events } = connection;
      ws.on("message", () => ws.send("after the ping"));
      peer.ping("unanswered");
      peer.text("x");
      expect(await peer.next()).toBe('text "after the ping"');
      expect(events).toEqual(['ping Buffer("unanswered") rs=1', 'message Buffer("x") text rs=1']);
    });
  });

  describe.each([
    { kind: "duplexPair()", pair: () => duplexPair() },
    { kind: "a synchronous pair", pair: synchronousPair },
  ])("ws client and ws server on $kind", ({ pair }) => {
    test("echo, ping and pong, close", async () => {
      await using both = await openBoth(implementation, {}, {}, pair());
      const { client, server, near, far } = both;
      const events = { client: recordEvents(client), server: recordEvents(server) };
      const closed = Promise.all([nextEvent(client, "close"), nextEvent(server, "close")]);
      server.on("message", (data, isBinary) => server.send(data, { binary: isBinary }));

      let echoed = nextEvent(client, "message");
      client.send("text");
      await echoed;
      echoed = nextEvent(client, "message");
      client.send(Buffer.from([1, 2, 3]));
      await echoed;

      let answered = nextEvent(client, "pong");
      client.ping("from the client");
      await answered;
      answered = nextEvent(server, "pong");
      server.ping("from the server");
      await answered;

      client.close(1000, "done");
      await closed;
      expect(events).toEqual({
        client: [
          'message Buffer("text") text rs=1',
          "message Buffer(0x010203) binary rs=1",
          'pong Buffer("from the client") rs=1',
          'ping Buffer("from the server") rs=1',
          'close 1000 Buffer("done") rs=3',
        ],
        server: [
          'message Buffer("text") text rs=1',
          "message Buffer(0x010203) binary rs=1",
          'ping Buffer("from the client") rs=1',
          'pong Buffer("from the server") rs=1',
          'close 1000 Buffer("done") rs=3',
        ],
      });
      expect([near.destroyed, far.destroyed]).toEqual([true, true]);
    });

    test("server-initiated close", async () => {
      await using both = await openBoth(implementation, {}, {}, pair());
      const { client, server } = both;
      const events = { client: recordEvents(client), server: recordEvents(server) };
      const closed = Promise.all([nextEvent(client, "close"), nextEvent(server, "close")]);
      server.close(4000, "go away");
      await closed;
      expect(events).toEqual({
        client: ['close 4000 Buffer("go away") rs=3'],
        server: ['close 4000 Buffer("go away") rs=3'],
      });
    });

    test.each([
      { label: "the defaults", client: true, server: true },
      {
        label: "no context takeover, small windows",
        client: { clientNoContextTakeover: true, serverMaxWindowBits: 9 },
        server: { serverNoContextTakeover: true, clientMaxWindowBits: 10, threshold: 0 },
      },
      {
        label: "the smallest windows",
        client: { clientMaxWindowBits: 8, serverMaxWindowBits: 8 },
        server: true,
      },
    ])("permessage-deflate with $label", async ({ client: clientOption, server: serverOption }) => {
      await using both = await openBoth(
        implementation,
        { perMessageDeflate: clientOption },
        { perMessageDeflate: serverOption },
        pair(),
      );
      const { client, server, near, far } = both;
      expect([client.extensions, server.extensions]).toEqual(["permessage-deflate", "permessage-deflate"]);
      let bytes = 0;
      near.on("data", chunk => (bytes += chunk.length));
      far.on("data", chunk => (bytes += chunk.length));
      server.on("message", (data, isBinary) => server.send(data, { binary: isBinary }));

      const messages = [Buffer.alloc(100_000, "compressible "), noise, noise, Buffer.alloc(0), Buffer.from("short")];
      const echoed: Buffer[] = [];
      const done = Promise.withResolvers<void>();
      client.on("message", data => echoed.push(data as Buffer) === messages.length && done.resolve());
      for (const message of messages) client.send(message);
      await done.promise;
      expect(echoed.map((data, i) => data.equals(messages[i]))).toEqual([true, true, true, true, true]);
      // The 100,000-byte message compresses to a few hundred bytes in each direction.
      expect(bytes).toBeLessThan(20_000);
    });
  });

  describe("ws client and ws server", () => {
    test.each([
      { starter: "client", extension: "no extension", perMessageDeflate: false },
      { starter: "server", extension: "no extension", perMessageDeflate: false },
      { starter: "client", extension: "permessage-deflate", perMessageDeflate: true },
      { starter: "server", extension: "permessage-deflate", perMessageDeflate: true },
    ] as const)(
      "100 nested echoes from 'message' listeners on a synchronous pair, started by the $starter, with $extension",
      async ({ starter, perMessageDeflate }) => {
        await using both = await openBoth(
          implementation,
          { perMessageDeflate },
          { perMessageDeflate },
          synchronousPair(),
        );
        const first = both[starter];
        const second = both[starter === "client" ? "server" : "client"];
        const received: string[] = [];
        const done = Promise.withResolvers<void>();
        second.on("message", data => second.send(`${data}`));
        first.on("message", data => {
          received.push(`${data}`);
          if (received.length < 100) first.send(`${received.length}`);
          else done.resolve();
        });
        first.send("0");
        // Without zlib's async step, the whole exchange runs synchronously inside that send().
        if (!perMessageDeflate) expect(received).toHaveLength(100);
        await done.promise;
        expect(received).toEqual(Array.from({ length: 100 }, (_, i) => `${i}`));
      },
    );

    test("createWebSocketStream() on both sockets", async () => {
      await using both = await openBoth(implementation);
      const client = implementation.createWebSocketStream(both.client);
      const server = implementation.createWebSocketStream(both.server);
      const closed = Promise.all([nextEvent(client, "close"), nextEvent(server, "close")]);
      const received = { client: [] as Buffer[], server: [] as Buffer[] };
      client.on("data", chunk => received.client.push(chunk));
      server.on("data", chunk => received.server.push(chunk));
      server.on("end", () => server.end());

      const answered = nextEvent(client, "data");
      server.once("data", () => server.write("an answer"));
      client.write("a question");
      await answered;
      client.write(noise);
      client.end("the end");
      await closed;
      expect(received.client.map(show)).toEqual(['Buffer("an answer")']);
      expect(received.server.map(show)).toEqual(['Buffer("a question")', "Buffer(2000 bytes)", 'Buffer("the end")']);
      expect([both.client.readyState, both.server.readyState]).toEqual([3, 3]);
      expect([both.near.destroyed, both.far.destroyed]).toEqual([true, true]);
    });

    test.concurrent(
      "open sockets don't keep the process alive",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          connectScript +
            `
            process.on("exit", () => console.log("exit"));
            connect().then(sockets => console.log(sockets.map(ws => ws.readyState).join()));
          `,
        );
        expect(lines).toEqual(["1,1", "exit"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    // The other end replies to the Close frame while close() is still running.
    test.concurrent(
      "closed sockets don't keep the process alive",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          connectScript +
            `
            connect().then(sockets => {
              let closedAt = 0;
              for (const ws of sockets) {
                ws.on("close", code => {
                  console.log("close " + code);
                  closedAt = performance.now();
                });
              }
              process.on("exit", () => console.log(performance.now() - closedAt < 10_000 ? "exit at once" : "exit late"));
              sockets[0].close(1000);
            });
          `,
        );
        expect(lines).toEqual(["close 1000", "close 1000", "exit at once"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    test.concurrent(
      "unreferenced open sockets are garbage collected along with their streams",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          connectScript +
            `
            const collect = globalThis.Bun
              ? () => Bun.gc(true)
              : (require("node:v8").setFlagsFromString("--expose-gc"), require("node:vm").runInNewContext("gc"));
            let collected = 0;
            const registry = new FinalizationRegistry(() => collected++);
            (async () => {
              for (let i = 0; i < 100; i++) for (const ws of await connect()) registry.register(ws);
              for (let i = 0; i < 50 && collected < 150; i++) {
                collect();
                await new Promise(setImmediate);
              }
              console.log(collected < 150 ? collected + " of 200" : "most of them");
            })();
          `,
        );
        expect(lines).toEqual(["most of them"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );
  });
});
