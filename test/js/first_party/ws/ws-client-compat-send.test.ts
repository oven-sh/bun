// send(), ping() and pong() of a `ws` client, against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tls } from "harness";
import { constants, inflateRawSync } from "node:zlib";
import {
  attempt,
  closedPort,
  dial,
  event,
  Frame,
  implementations,
  OP,
  openClient,
  response101,
  show,
  showFrame,
} from "./ws-raw-peer";

type Client = Awaited<ReturnType<typeof openClient>>;
type Callback = (...args: unknown[]) => void;

const MiB = 1024 * 1024;
const a = (count: number) => Buffer.alloc(count, "a").toString();
const connecting = 'throws Error "WebSocket is not open: readyState 0 (CONNECTING)"';
const closing = 'callback(Error "WebSocket is not open: readyState 2 (CLOSING)")';
const closed = 'callback(Error "WebSocket is not open: readyState 3 (CLOSED)")';
const tooLong = 'throws RangeError "The data size must not be greater than 125 bytes"';
const invalidData = (received: string) =>
  'throws TypeError "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an ' +
  `Array-like Object. Received ${received}" ERR_INVALID_ARG_TYPE`;

const bytes = (...values: number[]) => new Uint8Array(values);
// npm ws masks a SharedArrayBuffer in place, so each send() gets its own.
const shared = (...values: number[]) => {
  const buffer = new SharedArrayBuffer(values.length);
  new Uint8Array(buffer).set(values);
  return buffer;
};
const resizable = (...values: number[]) => {
  const buffer = new ArrayBuffer(values.length, { maxByteLength: 64 });
  new Uint8Array(buffer).set(values);
  return buffer;
};
const detached = () => {
  const view = new Uint8Array(4);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
};

/** Runs `act(callback)`. `returned` is `attempt()` of it, `callback` the line `callback(<arguments>)` once it has run. */
function invoke(act: (callback: Callback) => unknown) {
  const { promise, resolve } = Promise.withResolvers<string>();
  let inside = true;
  let ran = false;
  const returned = attempt(() =>
    act((...args) => {
      ran = true;
      resolve(`${inside ? "synchronous " : ""}callback(${args.map(show).join(", ")})`);
    }),
  );
  inside = false;
  return { returned, callback: promise, ran: () => ran };
}

/**
 * One call on an OPEN socket: `<frame>, callback(<arguments>)`, or `throws <error>`. The frames are all that went out
 * up to the end of a round trip, which also shows that the socket is still open.
 */
async function wire({ conn }: Client, act: (callback: Callback) => unknown) {
  const call = invoke(act);
  if (call.returned === "undefined") {
    const callback = await call.callback;
    return [...(await conn.roundTrip()), callback].join(", ");
  }
  return [call.returned, ...(await conn.roundTrip()), ...(call.ran() ? ["the callback ran"] : [])].join(", ");
}

/** One call on a socket that is not open: what `invoke()` saw, and by how much `bufferedAmount` grew. */
async function discard(ws: Client["ws"], act: (ws: any, callback: Callback) => unknown) {
  const before = ws.bufferedAmount;
  const call = invoke(callback => act(ws, callback));
  const counted = ws.bufferedAmount - before;
  return `${call.returned === "undefined" ? await call.callback : call.returned}, +${counted}`;
}

/** `text`, `binary rsv1`, `continuation !fin`: a frame without its payload. */
const head = (frame: Frame) =>
  showFrame(new Frame(frame.fin, frame.rsv, frame.opcode, frame.wrongMask, Buffer.alloc(0), undefined));

/** The compressed messages of a connection are one deflate stream: each is inflated behind those before it. */
function inflater() {
  let stream = Buffer.alloc(0);
  let done = 0;
  return (payload: Buffer) => {
    stream = Buffer.concat([stream, payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
    const all = inflateRawSync(stream, { finishFlush: constants.Z_SYNC_FLUSH });
    const message = all.subarray(done);
    done = all.length;
    return message;
  };
}

/**
 * Sends 1 MiB messages to a peer that has stopped reading until the client has to keep some of it, then two small
 * ones, which wait behind that. `results` gets `<index> null` or `<index> Error` from each callback.
 */
async function fill({ ws, conn }: Client) {
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
  do {
    for (let i = 0; i < 4; i++) send(Buffer.alloc(MiB, sent));
    // A message from the peer gives the client's event loop a turn, in which it writes what the kernel takes.
    conn.text("turn");
    await event(ws, "message");
  } while (ws.bufferedAmount === 0 && sent < 64);
  expect(ws.bufferedAmount).toBeGreaterThan(0);
  send("x");
  send("y");
  return {
    results,
    sent,
    /** Every callback has run. */
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
  { label: "string of 8-bit characters", data: "café", sent: 'text "café"' },
  { label: "string of 16-bit characters", data: "世 😶", sent: 'text "世 😶"' },
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

// `sent` is the payload of the frame.
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
  { label: "string of 125 bytes", data: a(125), sent: "125 bytes" },
  { label: "string of 126 bytes", data: a(126), thrown: tooLong },
  { label: "string of 63 characters, 126 bytes", data: Buffer.alloc(126, "é").toString(), thrown: tooLong },
  { label: "Buffer of 126 bytes", data: Buffer.alloc(126), thrown: tooLong },
  { label: "Blob of 126 bytes", data: new Blob([a(126)]), thrown: tooLong },
];

// `shown` is the payload as `showFrame` prints it. The first five meet every value of `binary`, the rest true and false.
const framed = [
  { kind: "string", data: () => "hi", shown: '"hi"' },
  { kind: "Buffer", data: () => Buffer.from("hi"), shown: '"hi"' },
  { kind: "ArrayBuffer", data: () => bytes(104, 105).buffer, shown: '"hi"' },
  { kind: "Blob", data: () => new Blob(["hi"]), shown: '"hi"' },
  { kind: "Buffer that is not UTF-8", data: () => Buffer.from([0xff, 0x68]), shown: "0xff68" },
  { kind: "Buffer that ends inside a character", data: () => Buffer.from("世").subarray(0, 2), shown: "0xe4b8" },
  { kind: "number", data: () => 12, shown: '"12"' },
  { kind: "string of 8-bit characters", data: () => "café", shown: '"café"' },
  { kind: "string of 16-bit characters", data: () => "世 😶", shown: '"世 😶"' },
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
// A `binary` that is there decides, undefined too. Only its truth counts.
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
const binaryRows = framed.flatMap(({ kind, data, shown }, i) =>
  binaryValues.slice(0, i < 5 ? binaryValues.length : 2).map(({ binary, type }) => ({
    label: `${kind}, binary: ${show(binary)}`,
    data,
    binary,
    sent: shown ? `${type} ${shown}` : type,
  })),
);

// What a socket that is not open does with a call, and what it adds to `bufferedAmount`: the bytes of the payload.
const discarded: { call: string; act(ws: any, callback: Callback): void; counted: number; thrown?: string }[] = [
  { call: 'send("abcd")', act: (ws, cb) => ws.send("abcd", cb), counted: 4 },
  { call: 'ping("abcd")', act: (ws, cb) => ws.ping("abcd", undefined, cb), counted: 4 },
  { call: 'pong("abcd")', act: (ws, cb) => ws.pong("abcd", undefined, cb), counted: 4 },
  { call: 'send("abcd", { binary: true })', act: (ws, cb) => ws.send("abcd", { binary: true }, cb), counted: 4 },
  { call: 'send("é")', act: (ws, cb) => ws.send("é", cb), counted: 2 },
  { call: "send(7)", act: (ws, cb) => ws.send(7, cb), counted: 1 },
  { call: "send(0)", act: (ws, cb) => ws.send(0, cb), counted: 1 },
  { call: "send(Buffer)", act: (ws, cb) => ws.send(Buffer.alloc(10), cb), counted: 10 },
  {
    call: "send(Buffer, { binary: false })",
    act: (ws, cb) => ws.send(Buffer.alloc(10), { binary: false }, cb),
    counted: 10,
  },
  { call: "send(ArrayBuffer)", act: (ws, cb) => ws.send(new ArrayBuffer(4), cb), counted: 4 },
  { call: "send(DataView)", act: (ws, cb) => ws.send(new DataView(new ArrayBuffer(8), 2, 4), cb), counted: 4 },
  { call: "send(SharedArrayBuffer)", act: (ws, cb) => ws.send(new SharedArrayBuffer(3), cb), counted: 3 },
  { call: "send(Blob)", act: (ws, cb) => ws.send(new Blob(["12345"]), cb), counted: 5 },
  { call: "send([1, 2])", act: (ws, cb) => ws.send([1, 2], cb), counted: 2 },
  { call: 'send("")', act: (ws, cb) => ws.send("", cb), counted: 0 },
  { call: "send(null)", act: (ws, cb) => ws.send(null, cb), counted: 0 },
  { call: "ping()", act: (ws, cb) => ws.ping(cb), counted: 0 },
  // There is no frame, so no limit.
  { call: "ping(126 bytes)", act: (ws, cb) => ws.ping(a(126), cb), counted: 126 },
  { call: "send({})", act: (ws, cb) => ws.send({}, cb), counted: 0, thrown: invalidData("an instance of Object") },
  { call: "send(true)", act: (ws, cb) => ws.send(true, cb), counted: 0, thrown: invalidData("type boolean (true)") },
];
const discardedTotal = discarded.reduce((sum, row) => sum + row.counted, 0);

describe.each(implementations)("ws client, sending ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket } = implementation;

  describe("send(data)", () => {
    test("the type of the data decides the frame type, and what is not a payload throws", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const results: Record<string, string> = {};
      for (const { label, data } of payloads) {
        results[label] = await wire(client, callback => client.ws.send(data as any, callback));
      }
      expect(results).toEqual(expected(payloads));
    });

    test("a detached ArrayBuffer or view throws a TypeError, a detached Buffer is empty", async () => {
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

    test.each([125, 126, 65535, 65536])("a payload of %d bytes", async length => {
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

    test("the caller's buffer is copied at the call and left as it is", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const buffer = Buffer.from("aaaa");
      const arrayBuffer = bytes(1, 2, 3, 4).buffer;
      ws.send(buffer);
      ws.send(arrayBuffer);
      expect([show(buffer), show(arrayBuffer)]).toEqual(['Buffer("aaaa")', "ArrayBuffer(0x01020304)"]);
      buffer.fill("b");
      new Uint8Array(arrayBuffer).fill(9);
      expect(await conn.take(2)).toEqual(['binary "aaaa"', "binary 0x01020304"]);
    });

    test("a Blob keeps its place among the other frames", async () => {
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
      expect(await conn.take(6)).toEqual(['text "a"', 'binary "b"', 'text "c"', 'ping "d"', 'ping "e"', 'text "f"']);
      await last.promise;
      expect(order).toEqual(["a", "b", "c", "d", "e"]);
    });

    test("in the 'open' listener", async () => {
      await using client = await dial(implementation);
      const called = new Promise(resolve => client.ws.on("open", () => client.ws.send("first", resolve)));
      expect(await (await client.peer.connection()).next()).toBe('text "first"');
      expect(await called).toBeNull();
    });
  });

  describe("send(data, options)", () => {
    test.each([
      { transport: "TCP", secure: false },
      { transport: "TLS", secure: true },
    ])("`binary` decides the frame type and the payload goes out as it is, over $transport", async ({ secure }) => {
      await using client = await openClient(implementation, { perMessageDeflate: false, ca: tls.cert }, { secure });
      const results: Record<string, string> = {};
      for (const { label, data, binary } of binaryRows) {
        results[label] = await wire(client, callback => client.ws.send(data() as any, { binary } as {}, callback));
      }
      expect(results).toEqual(expected(binaryRows));
    });

    // The relay of the README: send(data, { binary: isBinary }) with the arguments of 'message'. In "fragments" mode a
    // binary message is an array, which is not a payload.
    test.each(["nodebuffer", "arraybuffer", "blob", "fragments"] as const)(
      "a message goes back with its frame type when binaryType is %s",
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
        // The first fragment has the frame type. `binary` means nothing after it.
        [Buffer.from("e"), { fin: false, binary: false }],
        [Buffer.from("f"), { fin: 0, binary: true }],
        ["g", undefined],
        // As with `binary`: a `fin` that is there decides.
        [Buffer.from("h"), { fin: undefined }],
        ["i", { fin: 1 }],
      ] as [string | Buffer, object | undefined][]) {
        results.push(await wire(client, callback => client.ws.send(data, options as {}, callback)));
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

    test("a ping goes out between two fragments", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      client.ws.send("a", { fin: false });
      client.ws.ping("p");
      client.ws.send("b");
      expect(await client.conn.take(3)).toEqual(['text "a" !fin', 'ping "p"', 'continuation "b"']);
    });

    test("options that are no object, and a missing callback, are ignored", async () => {
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
        // The peer did not accept permessage-deflate.
        'send("j", { compress: true })': () => ws.send("j", { compress: true }),
      })) {
        results[call] = [attempt(act), ...(await client.conn.roundTrip())].join(", ");
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
      expect(await wire(client, callback => ws.send("k", null, callback))).toBe('text "k", callback(null)');
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
      const inflate = inflater();
      const results: Record<string, string> = {};
      for (const { label, data, options } of rows) {
        client.ws.send(data as Buffer, options as {});
        const frame = (await client.conn.nextFrame())!;
        const message = frame.rsv & 4 ? inflate(frame.payload) : frame.payload;
        const sent = data instanceof Blob ? await data.bytes() : Buffer.from(data as string);
        results[label] = `${head(frame)}, ${message.equals(sent) ? "intact" : show(message)}`;
      }
      return results;
    };

    test("every message is compressed unless `compress` is false", async () => {
      expect(
        await run("permessage-deflate", [
          { label: "2048 bytes", data: a(2048) },
          { label: "2048 bytes, compress: false", data: a(2048), options: { compress: false } },
          { label: "2048 bytes, compress: true", data: a(2048), options: { compress: true } },
          { label: "10 bytes", data: a(10) },
          { label: "10 bytes, compress: true", data: a(10), options: { compress: true } },
          { label: "1023 bytes", data: a(1023) },
          { label: "1024 bytes", data: a(1024) },
          { label: "Buffer", data: Buffer.alloc(2048, "世 ") },
          { label: "Buffer, binary: false", data: Buffer.alloc(2048, "世 "), options: { binary: false } },
          { label: "string, binary: true", data: Buffer.alloc(2048, "世 ").toString(), options: { binary: true } },
          { label: "Blob", data: new Blob([a(100)]) },
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

    test("with client_no_context_takeover only messages of 1024 bytes and more are compressed", async () => {
      expect(
        await run("permessage-deflate; client_no_context_takeover", [
          { label: "1023 bytes", data: a(1023) },
          { label: "1024 bytes", data: a(1024) },
          { label: "511 characters, 1022 bytes", data: Buffer.alloc(1022, "é").toString() },
          { label: "512 characters, 1024 bytes", data: Buffer.alloc(1024, "é").toString() },
          { label: "Buffer of 1023 bytes", data: Buffer.alloc(1023) },
          { label: "Buffer of 1024 bytes", data: Buffer.alloc(1024) },
          { label: "Blob of 1023 bytes", data: new Blob([a(1023)]) },
          { label: "Blob of 1024 bytes", data: new Blob([a(1024)]) },
          { label: "4 bytes, compress: true", data: a(4), options: { compress: true } },
          { label: "2048 bytes, compress: false", data: a(2048), options: { compress: false } },
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

    // npm ws compresses the fragments, the native client does not. A receiver needs what is asserted here: RSV1 on the
    // first frame at most, and one message.
    test("a fragmented message arrives whole", async () => {
      await using client = await openClient(
        implementation,
        {},
        { headers: ["Sec-WebSocket-Extensions: permessage-deflate"] },
      );
      const { ws, conn } = client;
      ws.send(a(100), { fin: false });
      ws.send(a(100), { fin: false });
      ws.send(a(100));
      const frames = [(await conn.nextFrame())!, (await conn.nextFrame())!, (await conn.nextFrame())!];
      const compressed = (frames[0].rsv & 4) !== 0;
      expect(frames.map(head)).toEqual([
        compressed ? "text !fin rsv1" : "text !fin",
        "continuation !fin",
        "continuation",
      ]);
      const payload = Buffer.concat(frames.map(frame => frame.payload));
      expect((compressed ? inflater()(payload) : payload).toString()).toBe(a(300));
    });
  });

  describe.each(["ping", "pong"] as const)("%s()", method => {
    test("what is falsy is an empty payload, a payload has 125 bytes at most", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const rows = controlPayloads.map(row => ({
        ...row,
        label: `${method}(${row.label})`,
        sent: row.sent ? `${method} ${row.sent}` : method,
      }));
      const results: Record<string, string> = {};
      for (const { label, data } of rows) {
        results[label] = await wire(client, callback => client.ws[method](data, undefined, callback));
      }
      expect(results).toEqual(expected(rows));
    });

    test("the callback may be the first, the second or the third argument", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { conn } = client;
      const ws: any = client.ws;
      expect([
        await wire(client, callback => ws[method](callback)),
        await wire(client, callback => ws[method]("a", callback)),
        await wire(client, callback => ws[method]("b", true, callback)),
      ]).toEqual([`${method}, callback(null)`, `${method} "a", callback(null)`, `${method} "b", callback(null)`]);
      expect(attempt(() => ws[method]())).toBe("undefined");
      expect(await conn.next()).toBe(method);
    });
  });

  test("a callback runs after the call has returned, once, with null, in the order of the calls", async () => {
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

  // The peer decides how many Pings there are, so a flood of them must not fill the memory of the client.
  // RFC 6455 5.5.3 lets a Pong answer only the latest Ping. npm ws queues an answer to each.
  // Winsock takes all of it on loopback, so nothing ever waits there.
  test.skipIf(!builtin || isWindows)("Pings are not answered while more than 16 MiB wait for the socket", async () => {
    await using client = await openClient(implementation, { perMessageDeflate: false });
    const { ws, conn } = client;
    conn.socket.pause();
    let sent = 1;
    // Far more than the limit: the kernel has taken a part of it, and its buffers grow while the Pings arrive.
    ws.send(Buffer.alloc(33 * MiB));
    for (; ws.bufferedAmount <= 32 * MiB && sent < 16; sent++) ws.send(Buffer.alloc(MiB));
    expect(ws.bufferedAmount).toBeGreaterThan(32 * MiB);

    const pings = 100;
    const { promise: heard, resolve } = Promise.withResolvers<void>();
    let count = 0;
    ws.on("ping", () => ++count === pings && resolve());
    for (let i = 0; i < pings; i++) conn.ping("flood");
    await heard;

    conn.socket.resume();
    const opcodes: (number | undefined)[] = [];
    while (opcodes.length < sent) opcodes.push((await conn.nextFrame())?.opcode);
    expect(opcodes).toEqual(opcodes.map(() => OP.binary));
    // Nothing waits any more. The Pong of the round trip itself shows that Pings are answered again.
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

    test("while it is not 0 the callbacks of what waits do not run; they run when the peer reads", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const { results, sent, settled } = await fill(client);
      // At least one large message and the two small ones.
      expect(results.length).toBeLessThanOrEqual(sent - 3);

      conn.socket.resume();
      await settled();
      expect(ws.bufferedAmount).toBe(0);
      expect(await conn.roundTrip()).toEqual([
        ...Array.from({ length: sent - 2 }, () => `binary ${MiB} bytes`),
        'text "x"',
        'text "y"',
      ]);
      expect(conn.frames[sent - 3].payload.equals(Buffer.alloc(MiB, sent - 3))).toBe(true);
      expect(results).toEqual(Array.from({ length: sent }, (_, index) => `${index} null`));
    });

    test("terminate() gives an Error to the callbacks of what waits", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { results, sent, settled } = await fill(client);
      const written = results.length;
      expect(written).toBeLessThanOrEqual(sent - 3);
      client.ws.terminate();
      await Promise.all([settled(), client.closed]);
      expect(results).toEqual(
        Array.from({ length: sent }, (_, index) => `${index} ${index < written ? "null" : "Error"}`),
      );
    });
  });

  describe("on a socket that is not open", () => {
    test("CONNECTING: send(), ping() and pong() throw, whatever the arguments, and nothing is queued", async () => {
      await using client = await dial(implementation, {}, { respond: () => null });
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
          () => ws.ping(a(126)),
          () => ws.ping(callback),
          () => ws.pong("x", undefined, callback),
          () => ws.pong({}),
          () => ws.pong(callback),
        ].map(attempt),
      ).toEqual(new Array(10).fill(connecting));
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      expect(ws.bufferedAmount).toBe(0);

      conn.write(response101(conn));
      await client.opened;
      expect(await conn.roundTrip()).toEqual([]);
      expect(called).toBe(0);
    });

    test("CLOSING and CLOSED: the callback gets an Error, nothing is sent, bufferedAmount counts the payload", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      const run = async () => {
        const results: Record<string, string> = {};
        for (const { call, act } of discarded) results[call] = await discard(ws, act);
        return results;
      };
      const all = (callback: string) =>
        Object.fromEntries(discarded.map(row => [row.call, `${row.thrown ?? callback}, +${row.counted}`]));

      ws.close();
      expect(await conn.next()).toBe("close");
      expect(await run()).toEqual(all(closing));
      expect(attempt(() => ws.send("abcd"))).toBe("undefined");
      expect(ws.bufferedAmount).toBe(discardedTotal + 4);

      conn.close(1000);
      conn.end();
      await client.closed;
      expect(await run()).toEqual(all(closed));
      expect(attempt(() => ws.send("abcd"))).toBe("undefined");
      expect(ws.bufferedAmount).toBe(2 * (discardedTotal + 4));
      expect(await conn.rest()).toEqual([]);
    });

    test("after terminate()", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn } = client;
      ws.terminate();
      expect(await discard(ws, (ws, callback) => ws.send("abcd", callback))).toBe(`${closing}, +4`);
      await client.closed;
      expect(await discard(ws, (ws, callback) => ws.ping("abcd", callback))).toBe(`${closed}, +4`);
      expect(await conn.rest()).toEqual([]);
    });

    test("after a connection that failed", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      ws.on("error", () => {});
      await event(ws, "close");
      expect([
        await discard(ws, (ws, callback) => ws.send("x", callback)),
        await discard(ws, (ws, callback) => ws.ping("x", callback)),
        await discard(ws, (ws, callback) => ws.pong("x", callback)),
      ]).toEqual([`${closed}, +1`, `${closed}, +1`, `${closed}, +1`]);
      expect(ws.bufferedAmount).toBe(3);
    });
  });
});
