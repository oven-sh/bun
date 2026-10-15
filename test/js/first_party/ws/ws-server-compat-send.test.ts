// Tests send(), ping() and pong() on a `ws` server socket, using a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { openAsBlob } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { constants, inflateRawSync } from "node:zlib";
import type { WebSocket as Socket } from "ws";
import {
  createServer,
  encodeFrame,
  type Frame,
  implementations,
  nextEvent,
  OP,
  openServer,
  type RawClient,
  show,
  showFrame,
  tryCall,
  upgradeRequest,
} from "./ws-raw-peer";

const MiB = 1024 * 1024;
const repeatA = (count: number) => Buffer.alloc(count, "a").toString();
const invalidData = (received: string) =>
  'throws TypeError "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an ' +
  `Array-like Object. Received ${received}" ERR_INVALID_ARG_TYPE`;
const tooLong = 'throws RangeError "The data size must not be greater than 125 bytes"';
const notOpen = (state: string) => `Error "WebSocket is not open: readyState ${state}"`;
// Defaults each row's label to show(row.data).
const withLabels = <Row extends { data: unknown }>(rows: (Row & { label?: string })[]) =>
  rows.map(row => ({ label: show(row.data), ...row }));

function shared(bytes: number[]) {
  const buffer = new SharedArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function resizable(bytes: number[]) {
  const buffer = new ArrayBuffer(bytes.length, { maxByteLength: 64 });
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function detached() {
  const view = new Uint8Array(4);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
}

/** Records each callback invocation as `[name, ...args]`. `waitForCalls(n)` resolves after `n` invocations. */
function createRecorder() {
  const calls: unknown[][] = [];
  let wake = () => {};
  return {
    calls,
    /** One line per call, e.g. `0 null` or `send Error "WebSocket is not open: readyState 3 (CLOSED)"`. */
    get lines() {
      return calls.map(call => call.map(value => (typeof value === "string" ? value : show(value))).join(" "));
    },
    callback:
      (name: string | number) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        wake();
      },
    async waitForCalls(count: number) {
      while (calls.length < count) await new Promise<void>(resolve => (wake = resolve));
    },
  };
}

// Formats a large frame with its first byte, e.g. `binary 1048576 bytes of 7`.
const showLargeFrame = (frame: Frame | undefined) => (frame ? `${showFrame(frame)} of ${frame.payload[0]}` : "EOF");

async function readLargeFrames(client: RawClient, count: number) {
  const lines: string[] = [];
  while (lines.length < count) lines.push(showLargeFrame(await client.nextFrame()));
  return lines;
}

describe.each(implementations)("ws server send ($name)", ({ ws: implementation, builtin }) => {
  const { OPEN, CLOSING, CLOSED } = implementation.WebSocket;

  describe("send(data)", () => {
    test.each(
      withLabels([
        { data: "abc", frame: 'text "abc"' },
        { data: "", frame: "text" },
        { data: "café", frame: 'text "café"' },
        { data: "é世😶", frame: 'text "é世😶"' },
        { data: repeatA(125), frame: "text 125 bytes" },
        { data: repeatA(126), frame: "text 126 bytes" },
        { data: repeatA(65535), frame: "text 65535 bytes" },
        { data: repeatA(65536), frame: "text 65536 bytes" },
        // Numbers are sent as their decimal string.
        { data: 42, frame: 'text "42"' },
        { data: 0, frame: 'text "0"' },
        { data: NaN, frame: 'text "NaN"' },
        { data: Buffer.from("buf"), frame: 'binary "buf"' },
        { data: Buffer.alloc(0), frame: "binary" },
        { data: Buffer.from("0123456789").subarray(2, 5), label: "a Buffer subarray", frame: 'binary "234"' },
        { data: new Uint8Array([1, 2]), frame: "binary 0x0102" },
        { data: new Uint16Array([0x0102, 0x0304]), frame: "binary 0x02010403" },
        { data: new DataView(new Uint8Array([8, 9]).buffer), frame: "binary 0x0809" },
        {
          data: new DataView(new Uint8Array([0, 8, 9, 0]).buffer, 1, 2),
          label: "a DataView with an offset",
          frame: "binary 0x0809",
        },
        { data: new Uint8Array([5, 6, 7]).buffer, frame: "binary 0x050607" },
        { data: shared([1, 2]), frame: "binary 0x0102" },
        { data: resizable([3, 4]), label: "a resizable ArrayBuffer", frame: "binary 0x0304" },
        { data: new Blob(["blobby"]), frame: 'binary "blobby"' },
        { data: new Blob([]), frame: "binary" },
        // Other falsy values are sent as an empty binary message.
        { data: null, frame: "binary" },
        { data: undefined, frame: "binary" },
        { data: false, frame: "binary" },
        // Everything else is converted with Buffer.from().
        { data: [1, 2], frame: "binary 0x0102" },
        { data: { length: 2, 0: 104, 1: 105 }, label: "an array-like object", frame: 'binary "hi"' },
      ]),
    )("send($label) sends $frame", async ({ data, frame }) => {
      await using server = await openServer(implementation);
      expect(tryCall(() => server.ws.send(data as any))).toBe("undefined");
      expect(await server.client.roundTrip()).toEqual([frame]);
    });

    test.each(
      withLabels([
        { data: {}, label: "{}", thrown: invalidData("an instance of Object") },
        { data: true, thrown: invalidData("type boolean (true)") },
        { data: 10n, label: "10n", thrown: invalidData("type bigint (10n)") },
        { data: Symbol("s"), thrown: invalidData("type symbol (Symbol(s))") },
      ]),
    )("send($label) throws without sending anything or changing socket state", async ({ data, thrown }) => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const recorder = createRecorder();
      expect(tryCall(() => ws.send(data as any, { fin: false }, recorder.callback("send")))).toBe(thrown);
      expect(await client.roundTrip()).toEqual([]);
      expect(ws.readyState).toBe(OPEN);
      expect(ws.bufferedAmount).toBe(0);
      // The failed { fin: false } call must not have started a fragmented message.
      ws.send("next");
      expect(await client.roundTrip()).toEqual(['text "next"']);
      expect(recorder.calls).toEqual([]);
    });

    test.each([
      { label: "a detached ArrayBuffer", data: () => detached().buffer },
      { label: "a view over a detached ArrayBuffer", data: detached },
    ])("send($label) throws a TypeError and sends nothing", async ({ data }) => {
      await using server = await openServer(implementation);
      expect(() => server.ws.send(data())).toThrow(TypeError);
      expect(await server.client.roundTrip()).toEqual([]);
    });
  });

  describe("send(data, { binary })", () => {
    const binaryValues = [true, false, undefined, 0, 1, null, "", NaN, "yes", {}];
    const frameTypes = ["binary", "text", "text", "text", "binary", "text", "text", "text", "binary", "binary"];

    test.each([
      { label: "a string", data: "hi", payload: ' "hi"' },
      { label: "a non-ASCII string", data: "café", payload: ' "café"' },
      { label: "a number", data: 12, payload: ' "12"' },
      { label: "a Buffer", data: Buffer.from("hi"), payload: ' "hi"' },
      { label: "a Uint16Array", data: new Uint16Array([0x6968]), payload: ' "hi"' },
      { label: "an ArrayBuffer", data: new Uint8Array([104, 105]).buffer, payload: ' "hi"' },
      { label: "a Blob", data: new Blob(["hi"]), payload: ' "hi"' },
      { label: "invalid UTF-8 bytes", data: Buffer.from([0xff, 0x68]), payload: " 0xff68" },
      { label: "an empty Buffer", data: Buffer.alloc(0), payload: "" },
      { label: "an empty string", data: "", payload: "" },
    ])(
      "$label: truthiness of `binary` picks the frame type and the payload is sent unchanged",
      async ({ data, payload }) => {
        await using server = await openServer(implementation);
        for (const binary of binaryValues) server.ws.send(data as any, { binary: binary as boolean });
        expect(await server.client.roundTrip()).toEqual(frameTypes.map(type => type + payload));
      },
    );

    test.each(["nodebuffer", "arraybuffer", "blob"] as const)(
      "echoing with send(data, { binary: isBinary }) preserves the frame type, binaryType %s",
      async binaryType => {
        await using server = await openServer(implementation);
        const { ws, client } = server;
        ws.binaryType = binaryType as Socket["binaryType"];
        ws.on("message", (data, isBinary) => ws.send(data as Buffer, { binary: isBinary }));
        client.text("hi");
        client.binary(Buffer.from([1, 2, 3]));
        expect(await client.roundTrip()).toEqual(['text "hi"', "binary 0x010203"]);
      },
    );
  });

  describe("send(data, { fin })", () => {
    test("fin: false starts a fragmented message and the next send() with fin: true ends it", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      ws.send("fra", { fin: false });
      ws.send("gme", { fin: false });
      ws.send("nt", { fin: true });
      ws.send("after");
      expect(await client.roundTrip()).toEqual([
        'text "fra" !fin',
        'continuation "gme" !fin',
        'continuation "nt"',
        'text "after"',
      ]);
    });

    test("only the first fragment sets the frame type; later fragments ignore `binary` and the data type", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      ws.send(Buffer.from("a"), { binary: false, fin: false });
      ws.send("b", { binary: true, fin: false });
      ws.send(Buffer.from("c"));
      ws.send("d", { binary: true, fin: false });
      ws.send("");
      expect(await client.roundTrip()).toEqual([
        'text "a" !fin',
        'continuation "b" !fin',
        'continuation "c"',
        'binary "d" !fin',
        "continuation",
      ]);
    });

    test("coerces `fin` to a boolean", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      ws.send("a", { fin: 0 as any });
      ws.send("b", { fin: undefined });
      ws.send("c", { fin: 1 as any });
      expect(await client.roundTrip()).toEqual(['text "a" !fin', 'continuation "b" !fin', 'continuation "c"']);
    });

    // npm ws reads every Blob asynchronously. The built-in can't read a file-backed Blob synchronously in send(), so it
    // throws.
    test.skipIf(!builtin).each([
      { blob: "Bun.file()", make: (file: string) => Bun.file(file) },
      { blob: "fs.openAsBlob()", make: (file: string) => openAsBlob(file) },
    ])(
      "send($blob, { fin: false }) throws, never reports success and doesn't start a fragmented message",
      async ({ make }) => {
        using dir = tempDir("ws-send-file", { "data.txt": "from a file" });
        const blob = await make(path.join(String(dir), "data.txt"));
        await using server = await openServer(implementation);
        const { ws, client: peer } = server;
        const results: unknown[] = [];
        expect(() => ws.send(blob as any, { fin: false }, error => results.push(error))).toThrow("file");
        const sent = new Promise(resolve => ws.send("x", resolve));
        expect(await peer.roundTrip()).toEqual(['text "x"']);
        expect(await sent).toBeNull();
        expect(results.filter(result => !(result instanceof Error))).toEqual([]);
      },
    );

    test("sends a ping between two fragments", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      ws.send("a", { fin: false });
      ws.ping("p");
      ws.send("b");
      expect(await client.roundTrip()).toEqual(['text "a" !fin', 'ping "p"', 'continuation "b"']);
    });
  });

  describe("callbacks", () => {
    type Callback = (error?: Error | null) => void;
    test.each([
      { call: 'send("x", cb)', act: (ws, cb) => ws.send("x", cb), frame: 'text "x"' },
      { call: 'send("x", {}, cb)', act: (ws, cb) => ws.send("x", {}, cb), frame: 'text "x"' },
      { call: 'send("x", undefined, cb)', act: (ws, cb) => ws.send("x", undefined as any, cb), frame: 'text "x"' },
      { call: 'send("x", null, cb)', act: (ws, cb) => ws.send("x", null as any, cb), frame: 'text "x"' },
      {
        call: 'send("x", { compress: false }, cb)',
        act: (ws, cb) => ws.send("x", { compress: false }, cb),
        frame: 'text "x"',
      },
      { call: "send(blob, cb)", act: (ws, cb) => ws.send(new Blob(["x"]) as any, cb), frame: 'binary "x"' },
      { call: "ping(cb)", act: (ws, cb) => ws.ping(cb), frame: "ping" },
      { call: 'ping("x", cb)', act: (ws, cb) => ws.ping("x", cb as any), frame: 'ping "x"' },
      { call: 'ping("x", undefined, cb)', act: (ws, cb) => ws.ping("x", undefined, cb), frame: 'ping "x"' },
      { call: "ping(undefined, undefined, cb)", act: (ws, cb) => ws.ping(undefined, undefined, cb), frame: "ping" },
      { call: "pong(cb)", act: (ws, cb) => ws.pong(cb), frame: "pong" },
      { call: 'pong("x", cb)', act: (ws, cb) => ws.pong("x", cb as any), frame: 'pong "x"' },
      { call: 'pong("x", undefined, cb)', act: (ws, cb) => ws.pong("x", undefined, cb), frame: 'pong "x"' },
    ] as { call: string; act(ws: Socket, cb: Callback): void; frame: string }[])(
      "$call returns undefined and calls back asynchronously with null",
      async ({ act, frame }) => {
        await using server = await openServer(implementation);
        const recorder = createRecorder();
        expect(tryCall(() => act(server.ws, recorder.callback("cb")))).toBe("undefined");
        expect(recorder.calls).toEqual([]);
        await recorder.waitForCalls(1);
        expect(await server.client.roundTrip()).toEqual([frame]);
        expect(recorder.calls).toEqual([["cb", null]]);
      },
    );

    test("callbacks for empty messages fire too, in call order", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const recorder = createRecorder();
      ws.send("", recorder.callback(0));
      ws.send(Buffer.alloc(0), recorder.callback(1));
      ws.ping(recorder.callback(2));
      ws.send("after", recorder.callback(3));
      await recorder.waitForCalls(4);
      expect(await client.roundTrip()).toEqual(["text", "binary", "ping", 'text "after"']);
      expect(recorder.lines).toEqual(["0 null", "1 null", "2 null", "3 null"]);
      expect(ws.bufferedAmount).toBe(0);
    });
  });

  describe("ping(data) and pong(data)", () => {
    test.each(
      withLabels([
        { data: undefined, payload: "" },
        { data: null, payload: "" },
        { data: false, payload: "" },
        { data: "", payload: "" },
        { data: 0, payload: ' "0"' },
        { data: 12, payload: ' "12"' },
        { data: "hi", payload: ' "hi"' },
        { data: Buffer.from("hi"), payload: ' "hi"' },
        { data: new Uint8Array([1, 2]), payload: " 0x0102" },
        { data: new Uint8Array([1, 2]).buffer, payload: " 0x0102" },
        { data: new Blob(["hi"]), payload: ' "hi"' },
        { data: [1, 2], payload: " 0x0102" },
        { data: repeatA(125), payload: " 125 bytes" },
        { data: Buffer.alloc(125), payload: " 125 bytes" },
      ]),
    )("ping($label) sends ping$payload and pong($label) sends pong$payload", async ({ data, payload }) => {
      await using server = await openServer(implementation);
      expect(tryCall(() => server.ws.ping(data))).toBe("undefined");
      expect(tryCall(() => server.ws.pong(data))).toBe("undefined");
      expect(await server.client.roundTrip()).toEqual(["ping" + payload, "pong" + payload]);
    });

    test.each(
      withLabels([
        { data: {}, label: "{}", thrown: invalidData("an instance of Object") },
        { data: true, thrown: invalidData("type boolean (true)") },
        { data: repeatA(126), thrown: tooLong },
        { data: Buffer.alloc(126), thrown: tooLong },
        { data: new Blob([repeatA(126)]), thrown: tooLong },
        { data: Buffer.alloc(126, "é").toString(), label: "63 two-byte characters", thrown: tooLong },
      ]),
    )("ping($label) and pong($label) throw, send nothing and leave the socket open", async ({ data, thrown }) => {
      await using server = await openServer(implementation);
      const recorder = createRecorder();
      expect(tryCall(() => server.ws.ping(data, undefined, recorder.callback("ping")))).toBe(thrown);
      expect(tryCall(() => server.ws.pong(data, undefined, recorder.callback("pong")))).toBe(thrown);
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.ws.readyState).toBe(OPEN);
      expect(recorder.calls).toEqual([]);
    });
  });

  describe.each(["send", "ping", "pong"] as const)("%s() on a socket that isn't open", method => {
    const call = (ws: Socket, data: unknown, cb?: (error?: Error | null) => void) =>
      (ws as any)[method](data, undefined, cb);

    test("sends nothing and calls back asynchronously with an error", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const recorder = createRecorder();
      ws.close(1000);
      expect(ws.readyState).toBe(CLOSING);
      expect(tryCall(() => call(ws, "late"))).toBe("undefined");
      expect(tryCall(() => call(ws, "late", recorder.callback("closing")))).toBe("undefined");
      expect(recorder.calls).toEqual([]);
      await recorder.waitForCalls(1);

      client.close(1000);
      await server.closed;
      expect(ws.readyState).toBe(CLOSED);
      expect(tryCall(() => call(ws, "late"))).toBe("undefined");
      expect(tryCall(() => call(ws, "late", recorder.callback("closed")))).toBe("undefined");
      expect(recorder.calls.length).toBe(1);
      await recorder.waitForCalls(2);

      expect(recorder.lines).toEqual([`closing ${notOpen("2 (CLOSING)")}`, `closed ${notOpen("3 (CLOSED)")}`]);
      expect(await client.remainingFrames()).toEqual(["close 1000"]);
      expect(events).toEqual(["close 1000 Buffer() rs=3"]);
    });

    test("adds the payload size to bufferedAmount", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const payloads = withLabels([
        { data: "four", size: 4 },
        { data: "éé", size: 4 },
        { data: 1234, size: 4 },
        { data: 0, size: 1 },
        { data: Buffer.from("four"), size: 4 },
        { data: new ArrayBuffer(4), size: 4 },
        { data: new DataView(new ArrayBuffer(4)), size: 4 },
        { data: new Blob(["four"]), size: 4 },
        { data: [1, 2, 3, 4], size: 4 },
        // Too long for a control frame, but the length isn't validated when the socket isn't open.
        { data: Buffer.alloc(126), size: 126 },
        { data: "", size: 0 },
        { data: null, size: 0 },
        { data: undefined, size: 0 },
        { data: false, size: 0 },
      ]);
      const measureDeltas = () =>
        payloads.map(({ label, data }) => {
          const before = ws.bufferedAmount;
          call(ws, data);
          return [label, ws.bufferedAmount - before];
        });
      const expected = payloads.map(({ label, size }) => [label, size]);

      ws.close(1000);
      expect(ws.bufferedAmount).toBe(0);
      expect(measureDeltas()).toEqual(expected);
      client.close(1000);
      await server.closed;
      expect(measureDeltas()).toEqual(expected);
      expect(ws.bufferedAmount).toBe(2 * 159);
      expect(await client.remainingFrames()).toEqual(["close 1000"]);
    });

    test("still throws on an invalid payload type, without running the callback", async () => {
      await using server = await openServer(implementation);
      const { ws } = server;
      const recorder = createRecorder();
      ws.terminate();
      expect(ws.readyState).toBe(CLOSING);
      expect(tryCall(() => call(ws, {}, recorder.callback("closing")))).toBe(invalidData("an instance of Object"));
      await server.closed;
      expect(tryCall(() => call(ws, true, recorder.callback("closed")))).toBe(invalidData("type boolean (true)"));
      // If either callback above had been queued, it would fire before this one.
      call(ws, "x", recorder.callback("last"));
      await recorder.waitForCalls(1);
      expect(recorder.lines).toEqual([`last ${notOpen("3 (CLOSED)")}`]);
      expect(ws.bufferedAmount).toBe(1);
    });
  });

  // The second half of the message repeats the first half, 3000 bytes back. A compressor using a larger window than it
  // negotiated emits a back-reference to it, and an inflater using the negotiated window then fails with
  // "invalid distance too far back".
  describe("permessage-deflate: messages inflate with the window size negotiated in the 101", () => {
    test.each([
      { serverNoContextTakeover: true, serverMaxWindowBits: 10 },
      { serverNoContextTakeover: true, serverMaxWindowBits: 9 },
      { serverNoContextTakeover: true, serverMaxWindowBits: 15 },
      { serverNoContextTakeover: false, serverMaxWindowBits: 10 },
    ])(
      "serverNoContextTakeover: $serverNoContextTakeover, serverMaxWindowBits: $serverMaxWindowBits",
      async perMessageDeflate => {
        const { serverNoContextTakeover, serverMaxWindowBits: windowBits } = perMessageDeflate;
        await using server = await openServer(
          implementation,
          { perMessageDeflate },
          { headers: { "Sec-WebSocket-Extensions": "permessage-deflate" } },
        );
        const { ws, client } = server;
        expect(client.header("sec-websocket-extensions")).toBe(
          `permessage-deflate${serverNoContextTakeover ? "; server_no_context_takeover" : ""}; server_max_window_bits=${windowBits}`,
        );

        const noise = randomBytes(3000);
        const message = Buffer.concat([noise, noise]);
        let stream = Buffer.alloc(0);
        let inflated = 0;
        for (let i = 0; i < 3; i++) {
          ws.send(message);
          const frame = (await client.nextFrame())!;
          expect(showFrame(frame)).toBe(`binary ${frame.length} bytes rsv1`);
          // Without context takeover each message is its own deflate stream. With it, each one continues the last.
          if (serverNoContextTakeover) [stream, inflated] = [Buffer.alloc(0), 0];
          stream = Buffer.concat([stream, frame.payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
          // Small output chunks force zlib to resolve back-references through its window.
          const output = inflateRawSync(stream, { windowBits, chunkSize: 64, finishFlush: constants.Z_SYNC_FLUSH });
          expect(output.subarray(inflated).equals(message)).toBe(true);
          inflated = output.length;
        }
      },
    );
  });

  test("after terminate(), callbacks fire with errors in call order", async () => {
    await using server = await openServer(implementation);
    const { ws } = server;
    const recorder = createRecorder();
    ws.on("close", recorder.callback("close"));
    ws.terminate();
    ws.send("x", recorder.callback("send"));
    ws.ping(recorder.callback("ping"));
    ws.pong("x", recorder.callback("pong") as any);
    ws.send("x", { binary: true }, recorder.callback("send"));
    expect(recorder.calls).toEqual([]);
    await recorder.waitForCalls(5);
    const error = notOpen("2 (CLOSING)");
    const callbacks = [`send ${error}`, `ping ${error}`, `pong ${error}`, `send ${error}`];
    // The built-in queues 'close' inside terminate(), so it fires before callbacks queued afterwards.
    expect(recorder.lines).toEqual(
      builtin ? ["close 1006 Buffer()", ...callbacks] : [...callbacks, "close 1006 Buffer()"],
    );
  });

  // On loopback, Winsock accepts the whole write, so there's never any backpressure.
  describe.skipIf(isWindows)("when the peer stops reading", () => {
    // A peer can send unlimited pings, so queued pongs from a ping flood must not exhaust the server's memory.
    // RFC 6455 5.5.3 allows answering only the most recent ping. npm ws queues a pong for every ping.
    test.skipIf(!builtin).each([
      { transport: "the native transport", earlyFrame: false },
      { transport: "the stream transport", earlyFrame: true },
    ])("skips auto-pong while more than 16 MiB is buffered, on $transport", async ({ earlyFrame }) => {
      await using server = await createServer(implementation);
      const { wss } = server;
      if (earlyFrame) {
        // A frame in the upgrade `head` forces the built-in onto the stream transport, on top of the node:http socket.
        const { handleUpgrade } = wss;
        wss.handleUpgrade = (req, socket, head, done) =>
          handleUpgrade.call(wss, req, socket, encodeFrame(OP.pong, "early", { mask: true }), done);
      }
      const connection = once(wss, "connection");
      const client = server.connect();
      const [ws] = (await connection) as [Socket];
      await client.response;
      let sent = 0;
      const send = (size: number) => (ws.send(Buffer.alloc(size, sent)), sent++, size);
      client.socket.pause();
      // Go well past the limit. The kernel already accepted part of this, and its buffers grow while the pings arrive.
      const sizes = [send(33 * MiB)];
      while (ws.bufferedAmount <= 32 * MiB && sent < 16) sizes.push(send(MiB));
      expect(ws.bufferedAmount).toBeGreaterThan(32 * MiB);

      const pings = 100;
      const { promise: allPingsReceived, resolve } = Promise.withResolvers<void>();
      let received = 0;
      ws.on("ping", () => ++received === pings && resolve());
      for (let i = 0; i < pings; i++) client.ping("flood");
      await allPingsReceived;

      client.socket.resume();
      expect(await readLargeFrames(client, sizes.length)).toEqual(
        sizes.map((size, i) => `binary ${size} bytes of ${i}`),
      );
      // roundTrip() waits for a pong to its own ping, which proves auto-pong has resumed.
      expect(await client.roundTrip()).toEqual([]);
    });

    // send() flushes queued data first, so a later send() can be the first to notice that backpressure cleared. The
    // client reads from another process because this one never returns to its event loop. npm ws only writes from the
    // event loop.
    test.skipIf(!builtin)("send() callbacks fire in call order after backpressure clears", async () => {
      const wss = new implementation.WebSocketServer({ port: 0, host: "127.0.0.1" });
      await once(wss, "listening");
      await using reader = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const socket = require("node:net").connect(${(wss.address() as AddressInfo).port}, "127.0.0.1");
           socket.write(${JSON.stringify(upgradeRequest())});
           socket.resume();`,
        ],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
      });
      try {
        const [ws] = (await once(wss, "connection")) as [Socket];
        const order: number[] = [];
        const { promise: done, resolve } = Promise.withResolvers<void>();
        let calls = 0;
        const send = (data: Buffer) => {
          const call = calls++;
          ws.send(data, () => order.push(call) === calls && resolve());
        };
        // Send until the kernel stops accepting the whole write.
        while (ws.bufferedAmount === 0 && calls < 32) send(Buffer.alloc(8 * MiB));
        expect(ws.bufferedAmount).toBeGreaterThan(0);
        const oneByte = Buffer.alloc(1);
        // Give the reader process time to drain the socket, without returning to our event loop.
        for (let attempts = 0; ws.bufferedAmount > 0; attempts++) {
          if (attempts === 10_000) throw new Error("the client isn't reading");
          Bun.sleepSync(1);
          send(oneByte);
        }
        await done;
        expect(order).toEqual(Array.from({ length: calls }, (_, call) => call));
      } finally {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
    });

    // Bun.serve() drops messages once 16 MiB is buffered. A `ws` socket has no such limit.
    test("queues messages and callbacks past 16 MiB, then delivers each message once, in order", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const recorder = createRecorder();
      const sizes: number[] = [];
      const send = (size: number) => {
        ws.send(Buffer.alloc(size, sizes.length), recorder.callback(sizes.length));
        sizes.push(size);
      };
      client.socket.pause();
      expect(ws.bufferedAmount).toBe(0);
      send(17 * MiB);
      // The kernel already accepted part of it.
      while (ws.bufferedAmount <= 16 * MiB && sizes.length < 32) send(MiB);
      expect(ws.bufferedAmount).toBeGreaterThan(16 * MiB);
      for (let i = 0; i < 4; i++) send(MiB);

      // Queue one of each kind of send behind them.
      const kinds = ["ArrayBuffer", "Blob", "ping", "pong", "empty", "first", "last"];
      ws.send(new Uint8Array([104, 105]).buffer, { binary: false }, recorder.callback("ArrayBuffer"));
      ws.send(new Blob(["blob"]) as any, recorder.callback("Blob"));
      ws.ping("p", undefined, recorder.callback("ping"));
      ws.pong("q", undefined, recorder.callback("pong"));
      ws.send("", recorder.callback("empty"));
      ws.send("a", { fin: false }, recorder.callback("first"));
      ws.send("b", recorder.callback("last"));

      // The peer can still write while it isn't reading. Waiting for its message runs the server's event loop once.
      client.text("turn");
      await nextEvent(ws, "message");
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      expect(recorder.calls.length).toBeLessThan(sizes.length + kinds.length);

      client.socket.resume();
      expect(await readLargeFrames(client, sizes.length)).toEqual(
        sizes.map((size, i) => `binary ${size} bytes of ${i}`),
      );
      expect(await client.roundTrip()).toEqual([
        'text "hi"',
        'binary "blob"',
        'ping "p"',
        'pong "q"',
        "text",
        'text "a" !fin',
        'continuation "b"',
      ]);
      await recorder.waitForCalls(sizes.length + kinds.length);
      expect(await client.roundTrip()).toEqual([]);
      expect(recorder.lines).toEqual([...sizes.keys(), ...kinds].map(name => `${name} null`));
      expect(ws.bufferedAmount).toBe(0);
      expect(events).toEqual(['message Buffer("turn") text rs=1']);
    });

    test.each([
      { how: "terminate()", act: ({ ws }) => ws.terminate() },
      { how: "a peer reset", act: ({ client }) => client.reset() },
    ] as { how: string; act(server: Awaited<ReturnType<typeof openServer>>): void }[])(
      "$how fails each pending callback exactly once, before 'close'",
      async ({ act }) => {
        await using server = await openServer(implementation);
        const { ws, client, events } = server;
        const recorder = createRecorder();
        client.socket.pause();
        // More than the kernel will buffer, so this write can't complete.
        ws.send(Buffer.alloc(12 * MiB), recorder.callback("large"));
        ws.send("x", recorder.callback("small"));
        ws.ping(recorder.callback("ping"));
        expect(ws.bufferedAmount).toBeGreaterThan(0);

        ws.on("close", recorder.callback("close"));
        act(server);
        await server.closed;
        expect(recorder.calls).toEqual([
          ["large", expect.any(Error)],
          ["small", expect.any(Error)],
          ["ping", expect.any(Error)],
          ["close", 1006, Buffer.alloc(0)],
        ]);
        expect(ws.bufferedAmount).toBe(0);
        // Failed writes don't emit 'error' on the WebSocket.
        expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      },
    );
  });

  // Whether the write fails depends on when the RST arrives, so the callback's argument isn't checked.
  test("send() racing a peer reset calls back once, then emits 'close' 1006 and no 'error'", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    const order: string[] = [];
    ws.on("close", () => order.push("close"));
    client.reset();
    expect(ws.readyState).toBe(OPEN);
    expect(tryCall(() => ws.send("x", () => order.push("callback")))).toBe("undefined");
    await server.closed;
    expect(order).toEqual(["callback", "close"]);
    expect(events).toEqual(["close 1006 Buffer() rs=3"]);
  });

  test("messages sent from the 'connection' listener arrive after the 101, in order", async () => {
    await using server = await createServer(implementation);
    const recorder = createRecorder();
    server.wss.on("connection", ws => {
      for (let i = 0; i < 8; i++) ws.send(Buffer.alloc(100_000, i), recorder.callback(i));
      ws.send("end", recorder.callback("end"));
    });
    const client = server.connect();
    expect((await client.response).status).toBe("HTTP/1.1 101 Switching Protocols");
    expect(await readLargeFrames(client, 8)).toEqual(
      Array.from({ length: 8 }, (_, i) => `binary 100000 bytes of ${i}`),
    );
    expect(await client.roundTrip()).toEqual(['text "end"']);
    await recorder.waitForCalls(9);
    expect(recorder.lines).toEqual([...Array(8).keys(), "end"].map(name => `${name} null`));
  });

  test("50 connections: each gets its own echo and a broadcast calls back once per socket", async () => {
    await using server = await createServer(implementation);
    const { wss } = server;
    wss.on("connection", ws => ws.on("message", data => ws.send("echo:" + data)));
    const clients = Array.from({ length: 50 }, () => server.connect());
    await Promise.all(clients.map(client => client.response));
    clients.forEach((client, i) => client.text("n" + i));
    expect(await Promise.all(clients.map(client => client.next()))).toEqual(clients.map((_, i) => `text "echo:n${i}"`));
    expect(wss.clients.size).toBe(50);

    const recorder = createRecorder();
    for (const ws of wss.clients) ws.send("to all", recorder.callback("sent"));
    await recorder.waitForCalls(50);
    expect(await Promise.all(clients.map(client => client.roundTrip()))).toEqual(clients.map(() => ['text "to all"']));
    expect(recorder.lines).toEqual(clients.map(() => "sent null"));
  });
});
