// Tests send(), ping() and pong() on a `ws` client against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { openAsBlob } from "node:fs";
import path from "node:path";
import {
  closedPort,
  connectClient,
  createInflater,
  createPeer,
  detached,
  Frame,
  implementations,
  invalidData,
  MiB,
  nextEvent,
  openClient,
  overflowSize,
  type RawSocket,
  repeatA,
  resizable,
  response101,
  runScript,
  scriptTimeout,
  shared,
  show,
  showFrame,
  shrinkBuffers,
  tooLong,
  tryCall,
} from "./ws-raw-peer";

type Client = Awaited<ReturnType<typeof openClient>>;
type Callback = (...args: unknown[]) => void;

const connecting = 'throws Error "WebSocket is not open: readyState 0 (CONNECTING)"';
const closing = 'callback(Error "WebSocket is not open: readyState 2 (CLOSING)")';
const closed = 'callback(Error "WebSocket is not open: readyState 3 (CLOSED)")';

const bytes = (...values: number[]) => new Uint8Array(values);

/**
 * Runs `act(callback)`. `returned` is its `tryCall()` result. `callback` resolves to `callback(<arguments>)` once the
 * callback runs.
 */
function invoke(act: (callback: Callback) => unknown) {
  const { promise, resolve } = Promise.withResolvers<string>();
  let duringCall = true;
  let ran = false;
  const returned = tryCall(() =>
    act((...args) => {
      ran = true;
      resolve(`${duringCall ? "synchronous " : ""}callback(${args.map(show).join(", ")})`);
    }),
  );
  duringCall = false;
  return { returned, callback: promise, ran: () => ran };
}

/**
 * Makes one call on an OPEN socket and returns `<frame>, callback(<arguments>)` or `throws <error>`. Collects every
 * frame sent before a round trip completes, which also proves the socket is still open.
 */
async function callOnOpenSocket({ conn }: Client, act: (callback: Callback) => unknown) {
  const call = invoke(act);
  if (call.returned === "undefined") {
    const callback = await call.callback;
    return [...(await conn.roundTrip()), callback].join(", ");
  }
  return [call.returned, ...(await conn.roundTrip()), ...(call.ran() ? ["the callback ran"] : [])].join(", ");
}

/** Makes one call on a socket that isn't open. Returns what `invoke()` saw and how much `bufferedAmount` grew. */
async function callOnClosedSocket(ws: Client["ws"], act: (ws: any, callback: Callback) => unknown) {
  const before = ws.bufferedAmount;
  const call = invoke(callback => act(ws, callback));
  const bufferedBytes = ws.bufferedAmount - before;
  return `${call.returned === "undefined" ? await call.callback : call.returned}, +${bufferedBytes}`;
}

/** Formats a frame without its payload: `text`, `binary rsv1`, `continuation !fin`. */
const showFrameHeader = (frame: Frame) =>
  showFrame(new Frame(frame.fin, frame.rsv, frame.opcode, frame.hasWrongMask, Buffer.alloc(0), undefined));

/** For `createPeer()`, when the client that calls `shrinkBuffers({ sender })` runs in a child process. */
const withSmallReceiveBuffer = (conn: RawSocket) => (shrinkBuffers({ receiver: conn.socket }), response101(conn));

const largeSize = isWindows ? MiB : MiB / 4;

/**
 * Sends `largeSize` messages to a peer that has stopped reading until the client has to buffer some, then two small
 * ones that queue behind them. Each callback pushes `<index> null` or `<index> Error` to `results`.
 */
async function fillSendBuffer({ ws, conn }: Client) {
  const results: string[] = [];
  let sent = 0;
  let wake = () => {};
  const send = (data: string | Buffer) => {
    const index = sent++;
    ws.send(data, (...args) => {
      results.push(`${index} ${args.map(arg => (arg instanceof Error ? "Error" : show(arg))).join(", ")}`);
      wake();
    });
  };
  conn.socket.pause();
  shrinkBuffers({ sender: ws, receiver: conn.socket });
  do {
    for (let i = 0; i < 4; i++) send(Buffer.alloc(largeSize, sent));
    // Waiting for a message from the peer lets the client's event loop run and write as much as the kernel accepts.
    conn.text("turn");
    await nextEvent(ws, "message");
  } while (ws.bufferedAmount === 0 && sent < 64);
  expect(ws.bufferedAmount).toBeGreaterThan(0);
  send("x");
  send("y");
  return {
    results,
    sent,
    /** Resolves once every callback has run. */
    async settled() {
      while (results.length < sent) await new Promise<void>(resolve => (wake = resolve));
    },
  };
}

type Row = { label: string; data: unknown; sent?: string; thrown?: string };
const expected = (rows: Row[]) =>
  Object.fromEntries(rows.map(row => [row.label, row.thrown ?? `${row.sent}, callback(null)`]));

const payloads: Row[] = [
  { label: "string", data: "hi", sent: 'text "hi"' },
  { label: "empty string", data: "", sent: "text" },
  { label: "Latin-1 string", data: "café", sent: 'text "café"' },
  { label: "UTF-16 string", data: "世 😶", sent: 'text "世 😶"' },
  { label: "string with a lone surrogate", data: "\ud800", sent: "text 0xefbfbd" },
  { label: "number", data: 42, sent: 'text "42"' },
  { label: "0", data: 0, sent: 'text "0"' },
  { label: "NaN", data: NaN, sent: 'text "NaN"' },
  { label: "bigint", data: 10n, thrown: invalidData("type bigint (10n)") },
  { label: "Buffer", data: Buffer.from("hi"), sent: 'binary "hi"' },
  { label: "empty Buffer", data: Buffer.alloc(0), sent: "binary" },
  { label: "Uint8Array", data: bytes(1, 2), sent: "binary 0x0102" },
  { label: "Uint8Array with an offset", data: bytes(1, 2, 3, 4).subarray(1, 3), sent: "binary 0x0203" },
  { label: "Float32Array", data: new Float32Array([1.5]), sent: "binary 0x0000c03f" },
  { label: "DataView with an offset", data: new DataView(bytes(7, 8, 9).buffer, 1), sent: "binary 0x0809" },
  { label: "ArrayBuffer", data: bytes(5, 6).buffer, sent: "binary 0x0506" },
  { label: "empty ArrayBuffer", data: new ArrayBuffer(0), sent: "binary" },
  { label: "resizable ArrayBuffer", data: resizable(5, 6), sent: "binary 0x0506" },
  {
    label: "SharedArrayBuffer",
    get data() {
      return shared(5, 6);
    },
    sent: "binary 0x0506",
  },
  { label: "Uint8Array on a resizable ArrayBuffer", data: new Uint8Array(resizable(5, 6)), sent: "binary 0x0506" },
  { label: "Uint8Array on a SharedArrayBuffer", data: new Uint8Array(shared(5, 6)), sent: "binary 0x0506" },
  { label: "Blob", data: new Blob(["bl"]), sent: 'binary "bl"' },
  { label: "empty Blob", data: new Blob([]), sent: "binary" },
  { label: "array", data: [1, 2, 3], sent: "binary 0x010203" },
  { label: "null", data: null, sent: "binary" },
  { label: "undefined", data: undefined, sent: "binary" },
  { label: "false", data: false, sent: "binary" },
  { label: "true", data: true, thrown: invalidData("type boolean (true)") },
  { label: "object", data: { a: 1 }, thrown: invalidData("an instance of Object") },
  { label: "String object", data: new String("so"), sent: 'binary "so"' },
  { label: "object with Symbol.toPrimitive", data: { [Symbol.toPrimitive]: () => "prim" }, sent: 'binary "prim"' },
  { label: "object with valueOf", data: { valueOf: () => "vo" }, sent: 'binary "vo"' },
  { label: "symbol", data: Symbol("s"), thrown: invalidData("type symbol (Symbol(s))") },
  { label: "function", data: function fn() {}, thrown: invalidData("function fn") },
];

// Here `sent` is only the frame's payload.
const controlPayloads: Row[] = [
  { label: "undefined", data: undefined, sent: "" },
  { label: "null", data: null, sent: "" },
  { label: "false", data: false, sent: "" },
  { label: '""', data: "", sent: "" },
  { label: "0", data: 0, sent: '"0"' },
  { label: "5", data: 5, sent: '"5"' },
  { label: '"hi"', data: "hi", sent: '"hi"' },
  { label: "Buffer", data: Buffer.from("hi"), sent: '"hi"' },
  { label: "ArrayBuffer", data: bytes(1).buffer, sent: "0x01" },
  { label: "Blob", data: new Blob(["b"]), sent: '"b"' },
  { label: "array", data: [1, 2], sent: "0x0102" },
  { label: "object", data: {}, thrown: invalidData("an instance of Object") },
  { label: "125-byte string", data: repeatA(125), sent: "125 bytes" },
  { label: "126-byte string", data: repeatA(126), thrown: tooLong },
  { label: "63-character, 126-byte string", data: Buffer.alloc(126, "é").toString(), thrown: tooLong },
  { label: "126-byte Buffer", data: Buffer.alloc(126), thrown: tooLong },
  { label: "126-byte Blob", data: new Blob([repeatA(126)]), thrown: tooLong },
];

// `shown` is the payload as `showFrame` prints it. The first five rows run with every `binary` value, the rest only
// with true and false.
const binaryOptionPayloads = [
  { kind: "string", data: () => "hi", shown: '"hi"' },
  { kind: "Buffer", data: () => Buffer.from("hi"), shown: '"hi"' },
  { kind: "ArrayBuffer", data: () => bytes(104, 105).buffer, shown: '"hi"' },
  { kind: "Blob", data: () => new Blob(["hi"]), shown: '"hi"' },
  { kind: "Buffer with invalid UTF-8", data: () => Buffer.from([0xff, 0x68]), shown: "0xff68" },
  { kind: "Buffer truncated mid-character", data: () => Buffer.from("世").subarray(0, 2), shown: "0xe4b8" },
  { kind: "number", data: () => 12, shown: '"12"' },
  { kind: "Latin-1 string", data: () => "café", shown: '"café"' },
  { kind: "UTF-16 string", data: () => "世 😶", shown: '"世 😶"' },
  { kind: "Uint8Array with an offset", data: () => bytes(0xff, 104, 105, 0xff).subarray(1, 3), shown: '"hi"' },
  { kind: "Uint16Array", data: () => new Uint16Array(bytes(104, 105, 106, 107).buffer), shown: '"hijk"' },
  { kind: "Float64Array", data: () => new Float64Array([1]), shown: "0x000000000000f03f" },
  {
    kind: "DataView with an offset",
    data: () => new DataView(bytes(0xff, 104, 105, 0xff).buffer, 1, 2),
    shown: '"hi"',
  },
  { kind: "SharedArrayBuffer", data: () => shared(104, 105), shown: '"hi"' },
  { kind: "resizable ArrayBuffer", data: () => resizable(104, 105), shown: '"hi"' },
  { kind: "empty string", data: () => "", shown: "" },
  { kind: "empty Buffer", data: () => Buffer.alloc(0), shown: "" },
  { kind: "empty ArrayBuffer", data: () => new ArrayBuffer(0), shown: "" },
  { kind: "empty Blob", data: () => new Blob([]), shown: "" },
];
// An explicit `binary` key overrides the default, even when it's undefined. Only its truthiness matters.
const binaryValues = [
  { binary: true, type: "binary" },
  { binary: false, type: "text" },
  { binary: undefined, type: "text" },
  { binary: 0, type: "text" },
  { binary: 1, type: "binary" },
  { binary: null, type: "text" },
  { binary: "", type: "text" },
  { binary: NaN, type: "text" },
  { binary: "yes", type: "binary" },
  { binary: {}, type: "binary" },
];
const binaryRows = binaryOptionPayloads.flatMap(({ kind, data, shown }, i) =>
  binaryValues.slice(0, i < 5 ? binaryValues.length : 2).map(({ binary, type }) => ({
    label: `${kind}, binary: ${show(binary)}`,
    data,
    binary,
    sent: shown ? `${type} ${shown}` : type,
  })),
);

// Calls on a socket that isn't open. Each one adds its payload's byte length to `bufferedAmount`.
const closedSocketCalls: {
  call: string;
  act(ws: any, callback: Callback): void;
  bufferedBytes: number;
  thrown?: string;
}[] = [
  { call: 'send("abcd")', act: (ws, cb) => ws.send("abcd", cb), bufferedBytes: 4 },
  { call: 'ping("abcd")', act: (ws, cb) => ws.ping("abcd", undefined, cb), bufferedBytes: 4 },
  { call: 'pong("abcd")', act: (ws, cb) => ws.pong("abcd", undefined, cb), bufferedBytes: 4 },
  { call: 'send("abcd", { binary: true })', act: (ws, cb) => ws.send("abcd", { binary: true }, cb), bufferedBytes: 4 },
  { call: 'send("é")', act: (ws, cb) => ws.send("é", cb), bufferedBytes: 2 },
  { call: "send(7)", act: (ws, cb) => ws.send(7, cb), bufferedBytes: 1 },
  { call: "send(0)", act: (ws, cb) => ws.send(0, cb), bufferedBytes: 1 },
  { call: "send(Buffer)", act: (ws, cb) => ws.send(Buffer.alloc(10), cb), bufferedBytes: 10 },
  {
    call: "send(Buffer, { binary: false })",
    act: (ws, cb) => ws.send(Buffer.alloc(10), { binary: false }, cb),
    bufferedBytes: 10,
  },
  { call: "send(ArrayBuffer)", act: (ws, cb) => ws.send(new ArrayBuffer(4), cb), bufferedBytes: 4 },
  { call: "send(DataView)", act: (ws, cb) => ws.send(new DataView(new ArrayBuffer(8), 2, 4), cb), bufferedBytes: 4 },
  { call: "send(SharedArrayBuffer)", act: (ws, cb) => ws.send(new SharedArrayBuffer(3), cb), bufferedBytes: 3 },
  { call: "send(Blob)", act: (ws, cb) => ws.send(new Blob(["12345"]), cb), bufferedBytes: 5 },
  { call: "send([1, 2])", act: (ws, cb) => ws.send([1, 2], cb), bufferedBytes: 2 },
  { call: 'send("")', act: (ws, cb) => ws.send("", cb), bufferedBytes: 0 },
  { call: "send(null)", act: (ws, cb) => ws.send(null, cb), bufferedBytes: 0 },
  { call: "ping()", act: (ws, cb) => ws.ping(cb), bufferedBytes: 0 },
  // No frame is built, so the 125-byte limit isn't checked.
  { call: "ping(126 bytes)", act: (ws, cb) => ws.ping(repeatA(126), cb), bufferedBytes: 126 },
  {
    call: "send({})",
    act: (ws, cb) => ws.send({}, cb),
    bufferedBytes: 0,
    thrown: invalidData("an instance of Object"),
  },
  {
    call: "send(true)",
    act: (ws, cb) => ws.send(true, cb),
    bufferedBytes: 0,
    thrown: invalidData("type boolean (true)"),
  },
];
const totalBufferedBytes = closedSocketCalls.reduce((sum, row) => sum + row.bufferedBytes, 0);

describe.each(implementations)("ws client send ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  describe("send(data)", () => {
    test("picks the frame type from the data type and throws on unsupported types", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const results: Record<string, string> = {};
      for (const { label, data } of payloads) {
        results[label] = await callOnOpenSocket(client, callback => client.ws.send(data as any, callback));
      }
      expect(results).toEqual(expected(payloads));
    });

    test("throws for a detached ArrayBuffer or view, sends an empty frame for a detached Buffer", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      expect(() => ws.send(detached().buffer)).toThrow(TypeError);
      expect(() => ws.send(detached())).toThrow(TypeError);
      expect(() => ws.send(detached(), { binary: false })).toThrow(TypeError);
      expect(() => ws.ping(detached().buffer)).toThrow(TypeError);
      expect(await conn.roundTrip()).toEqual([]);
      const buffer = Buffer.from(new ArrayBuffer(4));
      structuredClone(buffer.buffer, { transfer: [buffer.buffer as ArrayBuffer] });
      ws.send(buffer);
      expect(await conn.next()).toBe("binary");
    });

    test.each([125, 126, 65535, 65536])("sends a %d-byte payload", async length => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const data = Buffer.alloc(length, "abc");
      ws.send(data);
      ws.send(data.toString());
      for (const type of ["binary", "text"]) {
        const frame = (await conn.nextFrame())!;
        expect(showFrame(frame)).toBe(`${type} ${length} bytes`);
        expect(frame.payload.equals(data)).toBe(true);
      }
    });

    test("copies the caller's buffer synchronously and doesn't modify it", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const buffer = Buffer.from("aaaa");
      const arrayBuffer = bytes(1, 2, 3, 4).buffer;
      ws.send(buffer);
      ws.send(arrayBuffer);
      expect([show(buffer), show(arrayBuffer)]).toEqual(['Buffer("aaaa")', "ArrayBuffer(0x01020304)"]);
      buffer.fill("b");
      new Uint8Array(arrayBuffer).fill(9);
      expect(await conn.nextFrames(2)).toEqual(['binary "aaaa"', "binary 0x01020304"]);
    });

    test("sends a Blob in order with the other frames", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { conn } = client;
      const ws: any = client.ws;
      const order: string[] = [];
      const last = Promise.withResolvers<void>();
      ws.send("a", () => order.push("a"));
      ws.send(new Blob(["b"]), () => order.push("b"));
      ws.send("c", () => order.push("c"));
      ws.ping("d", () => order.push("d"));
      ws.ping(new Blob(["e"]), () => order.push("e"));
      ws.send("f", () => last.resolve());
      expect(await conn.nextFrames(6)).toEqual([
        'text "a"',
        'binary "b"',
        'text "c"',
        'ping "d"',
        'ping "e"',
        'text "f"',
      ]);
      await last.promise;
      expect(order).toEqual(["a", "b", "c", "d", "e"]);
    });

    test("works inside the 'open' listener", async () => {
      await using client = await connectClient(implementation);
      const called = new Promise(resolve => client.ws.on("open", () => client.ws.send("first", resolve)));
      expect(await (await client.peer.connection()).next()).toBe('text "first"');
      expect(await called).toBeNull();
    });
  });

  describe("send(data, options)", () => {
    test.each([
      { transport: "TCP", secure: false },
      { transport: "TLS", secure: true },
    ])("`binary` sets the frame type and the payload is sent unchanged over $transport", async ({ secure }) => {
      await using client = await openClient(implementation, { perMessageDeflate: false, ca: tls.cert }, { secure });
      const results: Record<string, string> = {};
      for (const { label, data, binary } of binaryRows) {
        results[label] = await callOnOpenSocket(client, callback =>
          client.ws.send(data() as any, { binary } as {}, callback),
        );
      }
      expect(results).toEqual(expected(binaryRows));
    });

    // The echo pattern from the ws README: send(data, { binary: isBinary }) with the 'message' arguments. With
    // binaryType "fragments" a binary message is an array of Buffers, which send() can't take, so only text is echoed.
    test.each(["nodebuffer", "arraybuffer", "blob", "fragments"] as const)(
      "echoes a message with the same frame type when binaryType is %s",
      async binaryType => {
        await using client = await openClient(implementation, { perMessageDeflate: false });
        const { ws, conn } = client;
        ws.binaryType = binaryType as typeof ws.binaryType;
        ws.on("message", (data, isBinary) => ws.send(data as Buffer, { binary: isBinary }));
        conn.text("hi");
        expect(await conn.next()).toBe('text "hi"');
        if (binaryType === "fragments") return;
        conn.binary(bytes(1, 2, 3));
        expect(await conn.next()).toBe("binary 0x010203");
      },
    );

    test("`fin: false` starts or continues a fragmented message", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const results: string[] = [];
      for (const [data, options] of [
        ["a", { fin: false }],
        ["b", { fin: false }],
        ["c", { fin: true }],
        ["d", undefined],
        // Only the first fragment carries the frame type. `binary` is ignored on continuations.
        [Buffer.from("e"), { fin: false, binary: false }],
        [Buffer.from("f"), { fin: 0, binary: true }],
        ["g", undefined],
        // Like `binary`, an explicit `fin: undefined` overrides the default.
        [Buffer.from("h"), { fin: undefined }],
        ["i", { fin: 1 }],
      ] as [string | Buffer, object | undefined][]) {
        results.push(await callOnOpenSocket(client, callback => client.ws.send(data, options as {}, callback)));
      }
      expect(results).toEqual([
        'text "a" !fin, callback(null)',
        'continuation "b" !fin, callback(null)',
        'continuation "c", callback(null)',
        'text "d", callback(null)',
        'text "e" !fin, callback(null)',
        'continuation "f" !fin, callback(null)',
        'continuation "g", callback(null)',
        'binary "h" !fin, callback(null)',
        'continuation "i", callback(null)',
      ]);
    });

    test("sends a ping between two fragments", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      client.ws.send("a", { fin: false });
      client.ws.ping("p");
      client.ws.send("b");
      expect(await client.conn.nextFrames(3)).toEqual(['text "a" !fin', 'ping "p"', 'continuation "b"']);
    });

    test("ignores non-object options and a missing callback", async () => {
      await using client = await openClient(implementation);
      const ws: any = client.ws;
      const results: Record<string, string> = {};
      for (const [call, act] of Object.entries({
        "send()": () => ws.send(),
        'send("a", null)': () => ws.send("a", null),
        'send("b", undefined, undefined)': () => ws.send("b", undefined, undefined),
        'send("c", {}, undefined)': () => ws.send("c", {}, undefined),
        'send("d", "str")': () => ws.send("d", "str"),
        'send("e", 5)': () => ws.send("e", 5),
        'send("f", true)': () => ws.send("f", true),
        "send(Buffer, {})": () => ws.send(Buffer.from("g"), {}),
        "send(Buffer, { compress: false })": () => ws.send(Buffer.from("h"), { compress: false }),
        "send(Buffer, { compress: false, binary: false, fin: true })": () =>
          ws.send(Buffer.from("i"), { compress: false, binary: false, fin: true }),
        // The peer didn't negotiate permessage-deflate.
        'send("j", { compress: true })': () => ws.send("j", { compress: true }),
      })) {
        results[call] = [tryCall(act), ...(await client.conn.roundTrip())].join(", ");
      }
      expect(results).toEqual({
        "send()": "undefined, binary",
        'send("a", null)': 'undefined, text "a"',
        'send("b", undefined, undefined)': 'undefined, text "b"',
        'send("c", {}, undefined)': 'undefined, text "c"',
        'send("d", "str")': 'undefined, text "d"',
        'send("e", 5)': 'undefined, text "e"',
        'send("f", true)': 'undefined, text "f"',
        "send(Buffer, {})": 'undefined, binary "g"',
        "send(Buffer, { compress: false })": 'undefined, binary "h"',
        "send(Buffer, { compress: false, binary: false, fin: true })": 'undefined, text "i"',
        'send("j", { compress: true })': 'undefined, text "j"',
      });
      expect(await callOnOpenSocket(client, callback => ws.send("k", null, callback))).toBe('text "k", callback(null)');
    });
  });

  describe("with permessage-deflate", () => {
    const run = async (
      extension: string,
      rows: { label: string; data: string | Buffer | Blob; options?: object }[],
    ) => {
      await using client = await openClient(
        implementation,
        {},
        { headers: ["Sec-WebSocket-Extensions: " + extension] },
      );
      const inflate = createInflater();
      const results: Record<string, string> = {};
      for (const { label, data, options } of rows) {
        client.ws.send(data as Buffer, options as {});
        const frame = (await client.conn.nextFrame())!;
        const message = frame.rsv & 4 ? inflate(frame.payload) : frame.payload;
        const sent = data instanceof Blob ? await data.bytes() : Buffer.from(data as string);
        results[label] = `${showFrameHeader(frame)}, ${message.equals(sent) ? "intact" : show(message)}`;
      }
      return results;
    };

    test("compresses every message unless `compress` is false", async () => {
      expect(
        await run("permessage-deflate", [
          { label: "2048 bytes", data: repeatA(2048) },
          { label: "2048 bytes, compress: false", data: repeatA(2048), options: { compress: false } },
          { label: "2048 bytes, compress: true", data: repeatA(2048), options: { compress: true } },
          { label: "10 bytes", data: repeatA(10) },
          { label: "10 bytes, compress: true", data: repeatA(10), options: { compress: true } },
          { label: "1023 bytes", data: repeatA(1023) },
          { label: "1024 bytes", data: repeatA(1024) },
          { label: "Buffer", data: Buffer.alloc(2048, "世 ") },
          { label: "Buffer, binary: false", data: Buffer.alloc(2048, "世 "), options: { binary: false } },
          { label: "string, binary: true", data: Buffer.alloc(2048, "世 ").toString(), options: { binary: true } },
          { label: "Blob", data: new Blob([repeatA(100)]) },
        ]),
      ).toEqual({
        "2048 bytes": "text rsv1, intact",
        "2048 bytes, compress: false": "text, intact",
        "2048 bytes, compress: true": "text rsv1, intact",
        "10 bytes": "text rsv1, intact",
        "10 bytes, compress: true": "text rsv1, intact",
        "1023 bytes": "text rsv1, intact",
        "1024 bytes": "text rsv1, intact",
        "Buffer": "binary rsv1, intact",
        "Buffer, binary: false": "text rsv1, intact",
        "string, binary: true": "binary rsv1, intact",
        "Blob": "binary rsv1, intact",
      });
    });

    test("with client_no_context_takeover, only compresses messages of 1024 bytes or more", async () => {
      expect(
        await run("permessage-deflate; client_no_context_takeover", [
          { label: "1023 bytes", data: repeatA(1023) },
          { label: "1024 bytes", data: repeatA(1024) },
          { label: "511 characters, 1022 bytes", data: Buffer.alloc(1022, "é").toString() },
          { label: "512 characters, 1024 bytes", data: Buffer.alloc(1024, "é").toString() },
          { label: "Buffer of 1023 bytes", data: Buffer.alloc(1023) },
          { label: "Buffer of 1024 bytes", data: Buffer.alloc(1024) },
          { label: "Blob of 1023 bytes", data: new Blob([repeatA(1023)]) },
          { label: "Blob of 1024 bytes", data: new Blob([repeatA(1024)]) },
          { label: "4 bytes, compress: true", data: repeatA(4), options: { compress: true } },
          { label: "2048 bytes, compress: false", data: repeatA(2048), options: { compress: false } },
        ]),
      ).toEqual({
        "1023 bytes": "text, intact",
        "1024 bytes": "text rsv1, intact",
        "511 characters, 1022 bytes": "text, intact",
        "512 characters, 1024 bytes": "text rsv1, intact",
        "Buffer of 1023 bytes": "binary, intact",
        "Buffer of 1024 bytes": "binary rsv1, intact",
        "Blob of 1023 bytes": "binary, intact",
        "Blob of 1024 bytes": "binary rsv1, intact",
        "4 bytes, compress: true": "text, intact",
        "2048 bytes, compress: false": "text, intact",
      });
    });

    // npm ws reads every Blob asynchronously. The built-in can't read a file-backed Blob inside send(), so it throws.
    test.skipIf(!builtin).each([
      { blob: "Bun.file()", make: (file: string) => Bun.file(file) },
      { blob: "fs.openAsBlob()", make: (file: string) => openAsBlob(file) },
    ])(
      "send($blob, { fin: false }) throws, never reports success and doesn't start a fragmented message",
      async ({ make }) => {
        using dir = tempDir("ws-send-file", { "data.txt": "from a file" });
        const blob = await make(path.join(String(dir), "data.txt"));
        await using client = await openClient(implementation);
        const { ws, conn: peer } = client;
        const results: unknown[] = [];
        expect(() => ws.send(blob as any, { fin: false }, error => results.push(error))).toThrow("file");
        const sent = new Promise(resolve => ws.send("x", resolve));
        expect(await peer.roundTrip()).toEqual(['text "x"']);
        expect(await sent).toBeNull();
        expect(results.filter(result => !(result instanceof Error))).toEqual([]);
      },
    );

    // npm ws compresses fragments, the native client doesn't. Either way a receiver needs what's asserted here: RSV1 on
    // the first frame only, and a single message.
    test("the fragments of a message add up to the whole message", async () => {
      await using client = await openClient(
        implementation,
        {},
        { headers: ["Sec-WebSocket-Extensions: permessage-deflate"] },
      );
      const { ws, conn } = client;
      ws.send(repeatA(100), { fin: false });
      ws.send(repeatA(100), { fin: false });
      ws.send(repeatA(100));
      const frames = [(await conn.nextFrame())!, (await conn.nextFrame())!, (await conn.nextFrame())!];
      const compressed = (frames[0].rsv & 4) !== 0;
      expect(frames.map(showFrameHeader)).toEqual([
        compressed ? "text !fin rsv1" : "text !fin",
        "continuation !fin",
        "continuation",
      ]);
      const payload = Buffer.concat(frames.map(frame => frame.payload));
      expect((compressed ? createInflater()(payload) : payload).toString()).toBe(repeatA(300));
    });
  });

  describe.each(["ping", "pong"] as const)("%s()", method => {
    test("sends an empty payload for falsy data and throws above 125 bytes", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const rows = controlPayloads.map(row => ({
        ...row,
        label: `${method}(${row.label})`,
        sent: row.sent ? `${method} ${row.sent}` : method,
      }));
      const results: Record<string, string> = {};
      for (const { label, data } of rows) {
        results[label] = await callOnOpenSocket(client, callback => client.ws[method](data, undefined, callback));
      }
      expect(results).toEqual(expected(rows));
    });

    test("accepts the callback as the first, second or third argument", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { conn } = client;
      const ws: any = client.ws;
      expect([
        await callOnOpenSocket(client, callback => ws[method](callback)),
        await callOnOpenSocket(client, callback => ws[method]("a", callback)),
        await callOnOpenSocket(client, callback => ws[method]("b", true, callback)),
      ]).toEqual([`${method}, callback(null)`, `${method} "a", callback(null)`, `${method} "b", callback(null)`]);
      expect(tryCall(() => ws[method]())).toBe("undefined");
      expect(await conn.next()).toBe(method);
    });
  });

  test("callbacks fire asynchronously, once, with null, in call order", async () => {
    await using client = await openClient(implementation, { perMessageDeflate: false });
    const { ws, conn } = client;
    const order: string[] = [];
    const log =
      (name: string) =>
      (...args: unknown[]) =>
        order.push(`${name} callback(${args.map(show).join(", ")})`);
    ws.send("a", log("send"));
    order.push("send returned");
    ws.ping(log("ping"));
    order.push("ping returned");
    ws.pong("a", undefined, log("pong"));
    order.push("pong returned");
    await new Promise(resolve => ws.send("b", resolve));
    expect(await conn.roundTrip()).toEqual(['text "a"', "ping", 'pong "a"', 'text "b"']);
    expect(order).toEqual([
      "send returned",
      "ping returned",
      "pong returned",
      "send callback(null)",
      "ping callback(null)",
      "pong callback(null)",
    ]);
  });

  // A peer can send unlimited Pings, so a ping flood must not exhaust the client's memory. RFC 6455 5.5.3 allows
  // answering only the latest Ping. npm ws queues a Pong for each one.
  // Skipped on Windows because Winsock accepts everything on loopback, so nothing is ever buffered.
  test.skipIf(!builtin || isWindows)("skips auto-pong while more than 16 MiB is buffered", async () => {
    await using client = await openClient(implementation, { perMessageDeflate: false });
    const { ws, conn } = client;
    conn.socket.pause();
    shrinkBuffers({ sender: ws, receiver: conn.socket });
    // The kernel takes well under 1 MiB of this.
    ws.send(Buffer.alloc(17 * MiB));
    expect(ws.bufferedAmount).toBeGreaterThan(16 * MiB);

    const pings = 100;
    const { promise: allPingsReceived, resolve } = Promise.withResolvers<void>();
    let count = 0;
    ws.on("ping", () => ++count === pings && resolve());
    for (let i = 0; i < pings; i++) conn.ping("flood");
    await allPingsReceived;

    conn.socket.resume();
    expect(await conn.next()).toBe(`binary ${17 * MiB} bytes`);
    // The buffer has drained. The round trip's own Pong proves auto-pong is back on.
    expect(await conn.roundTrip()).toEqual([]);
  });

  describe("bufferedAmount", () => {
    test("is 0 on an open socket, before and after a small send()", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      expect(ws.bufferedAmount).toBe(0);
      ws.send("hello");
      expect(ws.bufferedAmount).toBe(0);
      expect(await conn.roundTrip()).toEqual(['text "hello"']);
      expect(ws.bufferedAmount).toBe(0);
    });

    test("callbacks of buffered sends don't fire until the peer reads", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const { results, sent, settled } = await fillSendBuffer(client);
      // At least one large message and the two small ones are still buffered.
      expect(results.length).toBeLessThanOrEqual(sent - 3);

      conn.socket.resume();
      await settled();
      expect(ws.bufferedAmount).toBe(0);
      expect(await conn.roundTrip()).toEqual([
        ...Array.from({ length: sent - 2 }, () => `binary ${largeSize} bytes`),
        'text "x"',
        'text "y"',
      ]);
      expect(conn.frames[sent - 3].payload.equals(Buffer.alloc(largeSize, sent - 3))).toBe(true);
      expect(results).toEqual(Array.from({ length: sent }, (_, index) => `${index} null`));
    });

    // npm ws keeps the store on Node. On Bun it depends on node:net, whose write callbacks lose it.
    test.skipIf(!builtin).each(["the peer reads", "terminate()"])(
      "the callback of a buffered send keeps its AsyncLocalStorage store after %s",
      async how => {
        await using client = await openClient(implementation, { perMessageDeflate: false });
        const { ws, conn } = client;
        await fillSendBuffer(client);
        const storage = new AsyncLocalStorage<string>();
        const store = new Promise(resolve => storage.run("the sender's", () => ws.send("z", () => resolve(storage.getStore())))); // prettier-ignore
        if (how === "terminate()") ws.terminate();
        else conn.socket.resume();
        expect(await store).toBe("the sender's");
      },
    );

    // A callback runs in the store of its own call, also when that call was made outside every store. What completes
    // it doesn't matter: an event of the socket, which has the store of `new WebSocket()`, or a terminate() call.
    test.skipIf(!builtin).each(
      [
        { transport: "native", options: {} },
        { transport: "stream", options: { family: 4 } },
      ].flatMap(row => ["the peer reads", "terminate()", "a peer reset"].map(how => ({ ...row, how }))),
    )(
      "callbacks of buffered sends run in the AsyncLocalStorage store of their own call after $how, on the $transport transport",
      async ({ transport, options, how }) => {
        const storage = new AsyncLocalStorage<string>();
        const store = () => storage.getStore() ?? "no store";
        await using client = await storage.run("the constructor's", () =>
          openClient(implementation, { perMessageDeflate: false, ...options }),
        );
        const { ws, conn } = client;
        await fillSendBuffer(client);
        const calls: string[][] = [];
        const { promise: done, resolve } = Promise.withResolvers<void>();
        const callback =
          (call: string) =>
          (...args: unknown[]) => {
            const shown = args.map(arg => (arg instanceof Error ? "Error" : show(arg))).join(", ");
            if (calls.push([call, shown, store()]) === 5) resolve();
          };
        const closeStore = new Promise<string>(resolve => ws.on("close", () => resolve(store())));
        storage.run("the first sender's", () => ws.send("a", callback("send")));
        ws.send("b", callback("send"));
        ws.ping("c", undefined, callback("ping"));
        ws.pong("d", undefined, callback("pong"));
        storage.run("the last sender's", () => ws.send("e", callback("send")));
        if (how === "the peer reads") conn.socket.resume();
        else if (how === "terminate()") storage.run("the terminator's", () => ws.terminate());
        else conn.reset();
        await done;
        const argument = how === "the peer reads" ? "null" : "Error";
        expect(calls).toEqual([
          ["send", argument, "the first sender's"],
          ["send", argument, "no store"],
          ["ping", argument, "no store"],
          ["pong", argument, "no store"],
          ["send", argument, "the last sender's"],
        ]);
        // The store of a callback ends with it. On the stream transport, 'close' is the 'close' of `_socket` instead.
        if (transport === "native" && how !== "the peer reads") expect(await closeStore).toBe("the constructor's");
      },
    );

    // Each callback is called on its own: it is not a method of the queue, and a store that it enters doesn't reach
    // the next callback. npm ws on Node calls a queued callback as a method of a node:stream write entry, and a store
    // that a callback enters reaches the callbacks that complete with it.
    test.skipIf(!builtin).each(["inside a store", "outside every store"])(
      "a buffered send's callback has no `this` and doesn't pass on the store that it enters, on a socket made %s",
      async where => {
        const storage = new AsyncLocalStorage<string>();
        const open = () => openClient(implementation, { perMessageDeflate: false });
        await using client = await (where === "inside a store" ? storage.run("the constructor's", open) : open());
        const { ws, conn } = client;
        await fillSendBuffer(client);
        const { promise: seen, resolve } = Promise.withResolvers<unknown[]>();
        let receiver: unknown = "not called";
        ws.send("a", function (this: unknown) {
          receiver = this;
          storage.enterWith("the first callback's");
        });
        ws.send("b", () => resolve([receiver, storage.getStore() ?? "no store"]));
        conn.socket.resume();
        expect(await seen).toEqual([undefined, "no store"]);
      },
    );

    // The async context also says which Bun.ModuleGraph is running. The events of a socket that a graph made are the
    // graph's. Over node:http, which `family` selects, every callback waits for one of them.
    test.skipIf(!builtin)("a callback runs in the Bun.ModuleGraph context of its own call", async () => {
      const graph = new Bun.ModuleGraph();
      try {
        await using client = await graph.run(() => openClient(implementation, { perMessageDeflate: false, family: 4 }));
        const { ws } = client;
        const owners: string[] = [];
        const { promise: done, resolve } = Promise.withResolvers<void>();
        const callback = () => {
          const current = Bun.ModuleGraph.current;
          owners.push(current === graph ? "the graph" : current ? "another graph" : "the host");
          if (owners.length === 4) resolve();
        };
        ws.send("a", callback);
        ws.ping("b", undefined, callback);
        ws.pong("c", undefined, callback);
        graph.run(() => ws.send("d", callback));
        await done;
        expect(owners).toEqual(["the host", "the host", "the host", "the graph"]);
      } finally {
        graph.dispose();
      }
    });

    test("terminate() passes an Error to the callbacks of buffered sends", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { results, sent, settled } = await fillSendBuffer(client);
      const written = results.length;
      expect(written).toBeLessThanOrEqual(sent - 3);
      client.ws.terminate();
      await Promise.all([settled(), client.closed]);
      expect(results).toEqual(
        Array.from({ length: sent }, (_, index) => `${index} ${index < written ? "null" : "Error"}`),
      );
    });

    // With npm ws on Bun, node:net drops the callbacks of queued writes when the peer resets the connection.
    test.skipIf(!builtin).each([
      { transport: "native", options: {} },
      { transport: "stream", options: { family: 4 } },
    ])(
      "a peer reset passes an Error to the callbacks of buffered sends, on the $transport transport",
      async ({ options }) => {
        await using client = await openClient(implementation, { perMessageDeflate: false, ...options });
        const { results, sent } = await fillSendBuffer(client);
        expect(results.length).toBeLessThanOrEqual(sent - 3);
        client.conn.reset();
        await client.closed;
        expect(results.map(result => result.split(" ")[0])).toEqual(
          Array.from({ length: sent }, (_, index) => `${index}`),
        );
        expect(results.slice(-3)).toEqual([`${sent - 3} Error`, `${sent - 2} Error`, `${sent - 1} Error`]);
      },
    );

    // With npm ws on Bun, node:net swallows the exception after terminate() and drops the callback on a reset.
    // Skipped on Windows because Winsock accepts everything on loopback, so nothing is ever buffered.
    test.concurrent.skipIf(!builtin || isWindows).each(["terminate()", "a peer reset"])(
      "a buffered send's callback that throws after %s doesn't skip 'close'",
      async how => {
        await using peer = await createPeer({ respond: withSmallReceiveBuffer });
        const child = runScript(
          { specifier },
          `
          const ws = new WebSocket(process.env.PEER_URL, { perMessageDeflate: false });
          ws.on("close", code => console.log("close", code));
          ws.on("open", () => {
            // More than the kernel will buffer, so this write can't complete.
            shrinkBuffers({ sender: ws });
            ws.send(Buffer.alloc(${overflowSize}), error => {
              console.log("callback", error instanceof Error);
              throw new Error("thrown by the callback");
            });
            if (process.env.HOW === "terminate()") ws.terminate();
          });
        `,
          { PEER_URL: peer.url, HOW: how },
        );
        const conn = await peer.connection();
        if (how === "a peer reset") {
          // The first bytes of the message prove that send() has been called.
          await once(conn.socket, "data");
          conn.reset();
        }
        const { lines, exitCode } = await child;
        // On Node, 'close' comes after the uncaught exception.
        expect(lines).toEqual(["callback true", "close 1006", 'uncaught Error "thrown by the callback"']);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    // Sends four messages in one tick. The first is more than the kernel will buffer, so every callback has to wait.
    const sendFour = (thrower: number, { stream = false, then = "", inFirstCallback = "" } = {}) => `
      const ws = new WebSocket(process.env.PEER_URL, { perMessageDeflate: false, family: ${stream ? 4 : 0} });
      ws.on("close", code => console.log("close", code));
      ws.on("open", () => {
        shrinkBuffers({ sender: ws });
        [${overflowSize}, 1, 1, 1].forEach((size, i) =>
          ws.send(Buffer.alloc(size), error => {
            console.log("callback", i, error instanceof Error ? "Error" : error);
            if (i === 0) {
              ${inFirstCallback}
            }
            if (i === ${thrower}) throw new Error("thrown by the callback");
          }),
        );
        if (${!isWindows} && ws.bufferedAmount === 0) console.log("nothing was buffered");
        ${then}
      });
    `;

    // With npm ws, on Node too, node:stream drops the callbacks behind the one that throws unless that's the first. If
    // it is the first, node:net on Bun destroys the socket.
    test.concurrent.each(builtin ? [0, 1, 3] : [3])(
      "when the queue drains and callback %i of 4 throws, every callback still runs once",
      async thrower => {
        await using peer = await createPeer({ respond: withSmallReceiveBuffer });
        const child = runScript({ specifier }, sendFour(thrower), { PEER_URL: peer.url });
        const conn = await peer.connection();
        await conn.nextFrames(4);
        conn.close(1000);
        conn.end();
        const { lines, exitCode } = await child;
        const expected = [0, 1, 2, 3].map(i => `callback ${i} null`);
        expected.splice(thrower + 1, 0, 'uncaught Error "thrown by the callback"');
        expect(lines).toEqual([...expected, "close 1000"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    // node:net on Bun calls the write callbacks before the one that threw a second time, and swallows the exception.
    // Skipped on Windows because Winsock accepts everything on loopback, so nothing is ever buffered.
    test.concurrent.skipIf(!builtin || isWindows).each([1, 3])(
      "on the stream transport, when callback %i of 4 throws after terminate(), every callback still runs once",
      async thrower => {
        await using peer = await createPeer({ respond: conn => (conn.socket.pause(), withSmallReceiveBuffer(conn)) });
        const script = sendFour(thrower, { stream: true, then: "ws.terminate();" });
        const { lines, exitCode } = await runScript({ specifier }, script, { PEER_URL: peer.url });
        expect(lines.filter(line => !line.startsWith("uncaught"))).toEqual([
          ...[0, 1, 2, 3].map(i => `callback ${i} Error`),
          "close 1006",
        ]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    // node:stream drops the callbacks behind the one that throws, on Node too. The built-in fails them at 'close', and
    // has to tell them apart from the callback of a send() that was made later and has already run.
    // Skipped on Windows because Winsock accepts everything on loopback, so nothing is ever buffered.
    test.concurrent.skipIf(!builtin || isWindows)(
      "on the stream transport, a send() from a callback doesn't mix up the callbacks that a throw left behind",
      async () => {
        await using peer = await createPeer({ respond: withSmallReceiveBuffer });
        const sendLate = `ws.send("late", error => {
          console.log("late", error);
          ws.terminate();
        });`;
        const script = sendFour(1, { stream: true, inFirstCallback: sendLate });
        const { lines, exitCode } = await runScript({ specifier }, script, { PEER_URL: peer.url });
        expect(lines).toEqual([
          "callback 0 null",
          "callback 1 null",
          'uncaught Error "thrown by the callback"',
          "late null",
          "callback 2 Error",
          "callback 3 Error",
          "close 1006",
        ]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );
  });

  describe("on a socket that isn't open", () => {
    test("CONNECTING: send(), ping() and pong() throw regardless of arguments and queue nothing", async () => {
      await using client = await connectClient(implementation, {}, { respond: () => null });
      const ws: any = client.ws;
      const conn = await client.peer.connection();
      let called = 0;
      const callback = () => called++;
      expect(
        [
          () => ws.send("x", callback),
          () => ws.send("x"),
          () => ws.send({}, callback),
          () => ws.send(),
          () => ws.ping("x", undefined, callback),
          () => ws.ping(repeatA(126)),
          () => ws.ping(callback),
          () => ws.pong("x", undefined, callback),
          () => ws.pong({}),
          () => ws.pong(callback),
        ].map(tryCall),
      ).toEqual(new Array(10).fill(connecting));
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      expect(ws.bufferedAmount).toBe(0);

      conn.write(response101(conn));
      await client.opened;
      expect(await conn.roundTrip()).toEqual([]);
      expect(called).toBe(0);
    });

    test("CLOSING and CLOSED: calls back with an Error, sends nothing, grows bufferedAmount", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const run = async () => {
        const results: Record<string, string> = {};
        for (const { call, act } of closedSocketCalls) results[call] = await callOnClosedSocket(ws, act);
        return results;
      };
      const expectedWith = (callback: string) =>
        Object.fromEntries(
          closedSocketCalls.map(row => [row.call, `${row.thrown ?? callback}, +${row.bufferedBytes}`]),
        );

      ws.close();
      expect(await conn.next()).toBe("close");
      expect(await run()).toEqual(expectedWith(closing));
      expect(tryCall(() => ws.send("abcd"))).toBe("undefined");
      expect(ws.bufferedAmount).toBe(totalBufferedBytes + 4);

      conn.close(1000);
      conn.end();
      await client.closed;
      expect(await run()).toEqual(expectedWith(closed));
      expect(tryCall(() => ws.send("abcd"))).toBe("undefined");
      expect(ws.bufferedAmount).toBe(2 * (totalBufferedBytes + 4));
      expect(await conn.remainingFrames()).toEqual([]);
    });

    test("after terminate()", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      ws.terminate();
      expect(await callOnClosedSocket(ws, (ws, callback) => ws.send("abcd", callback))).toBe(`${closing}, +4`);
      await client.closed;
      expect(await callOnClosedSocket(ws, (ws, callback) => ws.ping("abcd", callback))).toBe(`${closed}, +4`);
      expect(await conn.remainingFrames()).toEqual([]);
    });

    test.each(["send", "ping", "pong"] as const)(
      "still OPEN after `_socket.destroy()`: %s() calls back with an Error and sends nothing",
      async method => {
        await using client = await openClient(implementation, { perMessageDeflate: false });
        const { ws, conn } = client;
        const events: unknown[] = [];
        ws.on("close", code => events.push(code));
        ws._socket!.destroy();
        ws[method]("abcd", (error?: NodeJS.ErrnoException | null) => events.push(error?.code));
        expect(ws.readyState).toBe(WebSocket.OPEN);
        await client.closed;
        expect(events).toEqual(["ERR_STREAM_DESTROYED", 1006]);
        expect(await conn.remainingFrames()).toEqual([]);
      },
    );

    test("after a failed connection", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      ws.on("error", () => {});
      await nextEvent(ws, "close");
      expect([
        await callOnClosedSocket(ws, (ws, callback) => ws.send("x", callback)),
        await callOnClosedSocket(ws, (ws, callback) => ws.ping("x", callback)),
        await callOnClosedSocket(ws, (ws, callback) => ws.pong("x", callback)),
      ]).toEqual([`${closed}, +1`, `${closed}, +1`, `${closed}, +1`]);
      expect(ws.bufferedAmount).toBe(3);
    });
  });
});
