// send(), ping() and pong() of a `ws` server socket, against a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { constants, inflateRawSync } from "node:zlib";
import type { WebSocket as Socket } from "ws";
import {
  attempt,
  createServer,
  event,
  type Frame,
  implementations,
  openServer,
  type RawClient,
  show,
  showFrame,
  upgradeRequest,
} from "./ws-raw-peer";

const MiB = 1024 * 1024;
const a = (count: number) => Buffer.alloc(count, "a").toString();
const invalidData = (received: string) =>
  'throws TypeError "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an ' +
  `Array-like Object. Received ${received}" ERR_INVALID_ARG_TYPE`;
const tooLong = 'throws RangeError "The data size must not be greater than 125 bytes"';
const notOpen = (state: string) => `Error "WebSocket is not open: readyState ${state}"`;
// Gives each row of a table of payloads its name.
const named = <Row extends { data: unknown }>(rows: (Row & { label?: string })[]) =>
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

/** Records each run of a callback as `[name, ...arguments]`. `count(n)` waits until `n` have run. */
function recorder() {
  const calls: unknown[][] = [];
  let wake = () => {};
  return {
    calls,
    /** `0 null`, `send Error "WebSocket is not open: readyState 3 (CLOSED)"`. */
    get lines() {
      return calls.map(call => call.map(value => (typeof value === "string" ? value : show(value))).join(" "));
    },
    callback:
      (name: string | number) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
        wake();
      },
    async count(wanted: number) {
      while (calls.length < wanted) await new Promise<void>(resolve => (wake = resolve));
    },
  };
}

// `binary 1048576 bytes of 7`: a large frame and its first byte.
const showLarge = (frame: Frame | undefined) => (frame ? `${showFrame(frame)} of ${frame.payload[0]}` : "EOF");

async function takeLarge(client: RawClient, count: number) {
  const lines: string[] = [];
  while (lines.length < count) lines.push(showLarge(await client.nextFrame()));
  return lines;
}

describe.each(implementations)("ws server, sending ($name)", ({ ws: implementation, builtin }) => {
  const { OPEN, CLOSING, CLOSED } = implementation.WebSocket;

  describe("send(data)", () => {
    test.each(
      named([
        { data: "abc", frame: 'text "abc"' },
        { data: "", frame: "text" },
        { data: "café", frame: 'text "café"' },
        { data: "é世😶", frame: 'text "é世😶"' },
        { data: a(125), frame: "text 125 bytes" },
        { data: a(126), frame: "text 126 bytes" },
        { data: a(65535), frame: "text 65535 bytes" },
        { data: a(65536), frame: "text 65536 bytes" },
        // A number goes out as its digits.
        { data: 42, frame: 'text "42"' },
        { data: 0, frame: 'text "0"' },
        { data: NaN, frame: 'text "NaN"' },
        { data: Buffer.from("buf"), frame: 'binary "buf"' },
        { data: Buffer.alloc(0), frame: "binary" },
        { data: Buffer.from("0123456789").subarray(2, 5), label: "a part of a Buffer", frame: 'binary "234"' },
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
        // Any other falsy value is an empty binary message.
        { data: null, frame: "binary" },
        { data: undefined, frame: "binary" },
        { data: false, frame: "binary" },
        // The rest is what Buffer.from() makes of it.
        { data: [1, 2], frame: "binary 0x0102" },
        { data: { length: 2, 0: 104, 1: 105 }, label: "an array-like object", frame: 'binary "hi"' },
      ]),
    )("send($label) sends $frame", async ({ data, frame }) => {
      await using server = await openServer(implementation);
      expect(attempt(() => server.ws.send(data as any))).toBe("undefined");
      expect(await server.client.roundTrip()).toEqual([frame]);
    });

    test.each(
      named([
        { data: {}, label: "{}", thrown: invalidData("an instance of Object") },
        { data: true, thrown: invalidData("type boolean (true)") },
        { data: 10n, label: "10n", thrown: invalidData("type bigint (10n)") },
        { data: Symbol("s"), thrown: invalidData("type symbol (Symbol(s))") },
      ]),
    )("send($label) throws, sends nothing and leaves the socket as it was", async ({ data, thrown }) => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const ran = recorder();
      expect(attempt(() => ws.send(data as any, { fin: false }, ran.callback("send")))).toBe(thrown);
      expect(await client.roundTrip()).toEqual([]);
      expect(ws.readyState).toBe(OPEN);
      expect(ws.bufferedAmount).toBe(0);
      // The call that threw did not start a fragmented message.
      ws.send("next");
      expect(await client.roundTrip()).toEqual(['text "next"']);
      expect(ran.calls).toEqual([]);
    });

    test.each([
      { label: "a detached ArrayBuffer", data: () => detached().buffer },
      { label: "a view of a detached ArrayBuffer", data: detached },
    ])("send($label) throws a TypeError and sends nothing", async ({ data }) => {
      await using server = await openServer(implementation);
      expect(() => server.ws.send(data())).toThrow(TypeError);
      expect(await server.client.roundTrip()).toEqual([]);
    });
  });

  describe("send(data, { binary })", () => {
    const values = [true, false, undefined, 0, 1, null, "", NaN, "yes", {}];
    const types = ["binary", "text", "text", "text", "binary", "text", "text", "text", "binary", "binary"];

    test.each([
      { label: "a string", data: "hi", payload: ' "hi"' },
      { label: "a string that is not ASCII", data: "café", payload: ' "café"' },
      { label: "a number", data: 12, payload: ' "12"' },
      { label: "a Buffer", data: Buffer.from("hi"), payload: ' "hi"' },
      { label: "a Uint16Array", data: new Uint16Array([0x6968]), payload: ' "hi"' },
      { label: "an ArrayBuffer", data: new Uint8Array([104, 105]).buffer, payload: ' "hi"' },
      { label: "a Blob", data: new Blob(["hi"]), payload: ' "hi"' },
      { label: "bytes that are not UTF-8", data: Buffer.from([0xff, 0x68]), payload: " 0xff68" },
      { label: "an empty Buffer", data: Buffer.alloc(0), payload: "" },
      { label: "an empty string", data: "", payload: "" },
    ])("$label: the truth of `binary` picks the frame type, the bytes stay as they are", async ({ data, payload }) => {
      await using server = await openServer(implementation);
      for (const binary of values) server.ws.send(data as any, { binary: binary as boolean });
      expect(await server.client.roundTrip()).toEqual(types.map(type => type + payload));
    });

    test.each(["nodebuffer", "arraybuffer", "blob"] as const)(
      "send(data, { binary: isBinary }) in a 'message' listener echoes both frame types, binaryType %s",
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
    test("fin: false starts a fragmented message, which the first send() with fin ends", async () => {
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

    test("the first fragment has the frame type, `binary` and the type of the data do not count after it", async () => {
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

    test("only the truth of `fin` counts", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      ws.send("a", { fin: 0 as any });
      ws.send("b", { fin: undefined });
      ws.send("c", { fin: 1 as any });
      expect(await client.roundTrip()).toEqual(['text "a" !fin', 'continuation "b" !fin', 'continuation "c"']);
    });

    test("a ping goes out between two fragments", async () => {
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
      "$call returns undefined and calls back later, with null",
      async ({ act, frame }) => {
        await using server = await openServer(implementation);
        const ran = recorder();
        expect(attempt(() => act(server.ws, ran.callback("cb")))).toBe("undefined");
        expect(ran.calls).toEqual([]);
        await ran.count(1);
        expect(await server.client.roundTrip()).toEqual([frame]);
        expect(ran.calls).toEqual([["cb", null]]);
      },
    );

    test("empty messages call back like any other, in the order of the calls", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const ran = recorder();
      ws.send("", ran.callback(0));
      ws.send(Buffer.alloc(0), ran.callback(1));
      ws.ping(ran.callback(2));
      ws.send("after", ran.callback(3));
      await ran.count(4);
      expect(await client.roundTrip()).toEqual(["text", "binary", "ping", 'text "after"']);
      expect(ran.lines).toEqual(["0 null", "1 null", "2 null", "3 null"]);
      expect(ws.bufferedAmount).toBe(0);
    });
  });

  describe("ping(data) and pong(data)", () => {
    test.each(
      named([
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
        { data: a(125), payload: " 125 bytes" },
        { data: Buffer.alloc(125), payload: " 125 bytes" },
      ]),
    )("$label goes out as ping$payload, pong$payload", async ({ data, payload }) => {
      await using server = await openServer(implementation);
      expect(attempt(() => server.ws.ping(data))).toBe("undefined");
      expect(attempt(() => server.ws.pong(data))).toBe("undefined");
      expect(await server.client.roundTrip()).toEqual(["ping" + payload, "pong" + payload]);
    });

    test.each(
      named([
        { data: {}, label: "{}", thrown: invalidData("an instance of Object") },
        { data: true, thrown: invalidData("type boolean (true)") },
        { data: a(126), thrown: tooLong },
        { data: Buffer.alloc(126), thrown: tooLong },
        { data: new Blob([a(126)]), thrown: tooLong },
        { data: Buffer.alloc(126, "é").toString(), label: "63 characters of 2 bytes", thrown: tooLong },
      ]),
    )("$label: both throw, send nothing and leave the socket open", async ({ data, thrown }) => {
      await using server = await openServer(implementation);
      const ran = recorder();
      expect(attempt(() => server.ws.ping(data, undefined, ran.callback("ping")))).toBe(thrown);
      expect(attempt(() => server.ws.pong(data, undefined, ran.callback("pong")))).toBe(thrown);
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.ws.readyState).toBe(OPEN);
      expect(ran.calls).toEqual([]);
    });
  });

  describe.each(["send", "ping", "pong"] as const)("%s() on a socket that is not open", method => {
    const call = (ws: Socket, data: unknown, cb?: (error?: Error | null) => void) =>
      (ws as any)[method](data, undefined, cb);

    test("sends nothing, and the callback gets an error later", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const ran = recorder();
      ws.close(1000);
      expect(ws.readyState).toBe(CLOSING);
      expect(attempt(() => call(ws, "late"))).toBe("undefined");
      expect(attempt(() => call(ws, "late", ran.callback("closing")))).toBe("undefined");
      expect(ran.calls).toEqual([]);
      await ran.count(1);

      client.close(1000);
      await server.closed;
      expect(ws.readyState).toBe(CLOSED);
      expect(attempt(() => call(ws, "late"))).toBe("undefined");
      expect(attempt(() => call(ws, "late", ran.callback("closed")))).toBe("undefined");
      expect(ran.calls.length).toBe(1);
      await ran.count(2);

      expect(ran.lines).toEqual([`closing ${notOpen("2 (CLOSING)")}`, `closed ${notOpen("3 (CLOSED)")}`]);
      expect(await client.rest()).toEqual(["close 1000"]);
      expect(events).toEqual(["close 1000 Buffer() rs=3"]);
    });

    test("bufferedAmount grows by the size of the payload", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const payloads = named([
        { data: "four", counted: 4 },
        { data: "éé", counted: 4 },
        { data: 1234, counted: 4 },
        { data: 0, counted: 1 },
        { data: Buffer.from("four"), counted: 4 },
        { data: new ArrayBuffer(4), counted: 4 },
        { data: new DataView(new ArrayBuffer(4)), counted: 4 },
        { data: new Blob(["four"]), counted: 4 },
        { data: [1, 2, 3, 4], counted: 4 },
        // Too long for a control frame, which nobody checks here.
        { data: Buffer.alloc(126), counted: 126 },
        { data: "", counted: 0 },
        { data: null, counted: 0 },
        { data: undefined, counted: 0 },
        { data: false, counted: 0 },
      ]);
      const count = () =>
        payloads.map(({ label, data }) => {
          const before = ws.bufferedAmount;
          call(ws, data);
          return [label, ws.bufferedAmount - before];
        });
      const expected = payloads.map(({ label, counted }) => [label, counted]);

      ws.close(1000);
      expect(ws.bufferedAmount).toBe(0);
      expect(count()).toEqual(expected);
      client.close(1000);
      await server.closed;
      expect(count()).toEqual(expected);
      expect(ws.bufferedAmount).toBe(2 * 159);
      expect(await client.rest()).toEqual(["close 1000"]);
    });

    test("a payload of a wrong type throws all the same, and the callback does not run", async () => {
      await using server = await openServer(implementation);
      const { ws } = server;
      const ran = recorder();
      ws.terminate();
      expect(ws.readyState).toBe(CLOSING);
      expect(attempt(() => call(ws, {}, ran.callback("closing")))).toBe(invalidData("an instance of Object"));
      await server.closed;
      expect(attempt(() => call(ws, true, ran.callback("closed")))).toBe(invalidData("type boolean (true)"));
      // A callback that does run comes after any that was due.
      call(ws, "x", ran.callback("last"));
      await ran.count(1);
      expect(ran.lines).toEqual([`last ${notOpen("3 (CLOSED)")}`]);
      expect(ws.bufferedAmount).toBe(1);
    });
  });

  // The second half of the message repeats the first, 3000 bytes back. A compressor with a larger window than it
  // promised refers to that, and an inflater of the promised size fails with "invalid distance too far back".
  describe("permessage-deflate: a peer can inflate with the window the 101 promised", () => {
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
          // Without context takeover each message stands alone, else it continues the stream of those before it.
          if (serverNoContextTakeover) [stream, inflated] = [Buffer.alloc(0), 0];
          stream = Buffer.concat([stream, frame.payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
          // Small chunks of output, so that zlib has to look back through its window.
          const all = inflateRawSync(stream, { windowBits, chunkSize: 64, finishFlush: constants.Z_SYNC_FLUSH });
          expect(all.subarray(inflated).equals(message)).toBe(true);
          inflated = all.length;
        }
      },
    );
  });

  test("after terminate() the callbacks get their errors in the order of the calls", async () => {
    await using server = await openServer(implementation);
    const { ws } = server;
    const ran = recorder();
    ws.on("close", ran.callback("close"));
    ws.terminate();
    ws.send("x", ran.callback("send"));
    ws.ping(ran.callback("ping"));
    ws.pong("x", ran.callback("pong") as any);
    ws.send("x", { binary: true }, ran.callback("send"));
    expect(ran.calls).toEqual([]);
    await ran.count(5);
    const error = notOpen("2 (CLOSING)");
    const callbacks = [`send ${error}`, `ping ${error}`, `pong ${error}`, `send ${error}`];
    // On the built-in 'close' is queued by terminate() itself, so it is ahead of what is queued after it.
    expect(ran.lines).toEqual(builtin ? ["close 1006 Buffer()", ...callbacks] : [...callbacks, "close 1006 Buffer()"]);
  });

  // Winsock takes all of it on loopback, so nothing ever waits there.
  describe.skipIf(isWindows)("a peer that does not read", () => {
    // The peer decides how many Pings there are, so a flood of them must not fill the memory of the server.
    // RFC 6455 5.5.3 lets a Pong answer only the latest Ping. npm ws queues an answer to each.
    test.skipIf(!builtin)("Pings are not answered while more than 16 MiB wait for the socket", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      let sent = 0;
      const send = (size: number) => (ws.send(Buffer.alloc(size, sent)), sent++, size);
      client.socket.pause();
      const sizes = [send(17 * MiB)];
      // The kernel has taken a part of it.
      while (ws.bufferedAmount <= 16 * MiB && sent < 32) sizes.push(send(MiB));
      expect(ws.bufferedAmount).toBeGreaterThan(16 * MiB);

      const pings = 100;
      const { promise: heard, resolve } = Promise.withResolvers<void>();
      let count = 0;
      ws.on("ping", () => ++count === pings && resolve());
      for (let i = 0; i < pings; i++) client.ping("flood");
      await heard;

      client.socket.resume();
      expect(await takeLarge(client, sizes.length)).toEqual(sizes.map((size, i) => `binary ${size} bytes of ${i}`));
      // The Pong of the round trip itself shows that Pings are answered again.
      expect(await client.roundTrip()).toEqual([]);
    });

    // A send() flushes what waits before it, so it can be the first to find the socket free again. The client reads
    // in another process, while this one does not return to its event loop. npm ws only writes from the event loop.
    test.skipIf(!builtin)(
      "callbacks run in the order of the calls when a later send() finds the socket free",
      async () => {
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
          send(Buffer.alloc(8 * MiB));
          expect(ws.bufferedAmount).toBeGreaterThan(0);
          const one = Buffer.alloc(1);
          // The pause is for the other process. It does not return to the event loop.
          for (let turns = 0; ws.bufferedAmount > 0; turns++) {
            if (turns === 10_000) throw new Error("the client does not read");
            Bun.sleepSync(1);
            send(one);
          }
          await done;
          expect(order).toEqual(Array.from({ length: calls }, (_, call) => call));
        } finally {
          for (const client of wss.clients) client.terminate();
          wss.close();
        }
      },
    );

    // Bun.serve() drops a message when 16 MiB wait for the socket already. A `ws` socket has no such limit.
    test("messages and their callbacks wait, past 16 MiB, then each message arrives once, whole and in order", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const ran = recorder();
      const sizes: number[] = [];
      const send = (size: number) => {
        ws.send(Buffer.alloc(size, sizes.length), ran.callback(sizes.length));
        sizes.push(size);
      };
      client.socket.pause();
      expect(ws.bufferedAmount).toBe(0);
      send(17 * MiB);
      // The kernel has taken a part of it.
      while (ws.bufferedAmount <= 16 * MiB && sizes.length < 32) send(MiB);
      expect(ws.bufferedAmount).toBeGreaterThan(16 * MiB);
      for (let i = 0; i < 4; i++) send(MiB);

      // Behind them, one of each kind.
      const kinds = ["ArrayBuffer", "Blob", "ping", "pong", "empty", "first", "last"];
      ws.send(new Uint8Array([104, 105]).buffer, { binary: false }, ran.callback("ArrayBuffer"));
      ws.send(new Blob(["blob"]) as any, ran.callback("Blob"));
      ws.ping("p", undefined, ran.callback("ping"));
      ws.pong("q", undefined, ran.callback("pong"));
      ws.send("", ran.callback("empty"));
      ws.send("a", { fin: false }, ran.callback("first"));
      ws.send("b", ran.callback("last"));

      // The peer can write while it does not read. Its message gives the server a turn of the event loop.
      client.text("turn");
      await event(ws, "message");
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      expect(ran.calls.length).toBeLessThan(sizes.length + kinds.length);

      client.socket.resume();
      expect(await takeLarge(client, sizes.length)).toEqual(sizes.map((size, i) => `binary ${size} bytes of ${i}`));
      expect(await client.roundTrip()).toEqual([
        'text "hi"',
        'binary "blob"',
        'ping "p"',
        'pong "q"',
        "text",
        'text "a" !fin',
        'continuation "b"',
      ]);
      await ran.count(sizes.length + kinds.length);
      expect(await client.roundTrip()).toEqual([]);
      expect(ran.lines).toEqual([...sizes.keys(), ...kinds].map(name => `${name} null`));
      expect(ws.bufferedAmount).toBe(0);
      expect(events).toEqual(['message Buffer("turn") text rs=1']);
    });

    test.each([
      { how: "terminate()", act: ({ ws }) => ws.terminate() },
      { how: "a reset by the peer", act: ({ client }) => client.reset() },
    ] as { how: string; act(server: Awaited<ReturnType<typeof openServer>>): void }[])(
      "$how gives each waiting callback an error, once, before 'close'",
      async ({ act }) => {
        await using server = await openServer(implementation);
        const { ws, client, events } = server;
        const ran = recorder();
        client.socket.pause();
        // More than the kernel takes, so this write cannot end.
        ws.send(Buffer.alloc(12 * MiB), ran.callback("large"));
        ws.send("x", ran.callback("small"));
        ws.ping(ran.callback("ping"));
        expect(ws.bufferedAmount).toBeGreaterThan(0);

        ws.on("close", ran.callback("close"));
        act(server);
        await server.closed;
        expect(ran.calls).toEqual([
          ["large", expect.any(Error)],
          ["small", expect.any(Error)],
          ["ping", expect.any(Error)],
          ["close", 1006, Buffer.alloc(0)],
        ]);
        expect(ws.bufferedAmount).toBe(0);
        // The failed writes are not an 'error' of the WebSocket.
        expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      },
    );
  });

  // Whether the write fails depends on how fast the reset travels, so the argument of the callback is not looked at.
  test("send() after the peer's reset, before the server has seen it: one callback, then 'close' 1006, no 'error'", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    const order: string[] = [];
    ws.on("close", () => order.push("close"));
    client.reset();
    expect(ws.readyState).toBe(OPEN);
    expect(attempt(() => ws.send("x", () => order.push("callback")))).toBe("undefined");
    await server.closed;
    expect(order).toEqual(["callback", "close"]);
    expect(events).toEqual(["close 1006 Buffer() rs=3"]);
  });

  test("a burst sent in the 'connection' listener follows the 101, in order", async () => {
    await using server = await createServer(implementation);
    const ran = recorder();
    server.wss.on("connection", ws => {
      for (let i = 0; i < 8; i++) ws.send(Buffer.alloc(100_000, i), ran.callback(i));
      ws.send("end", ran.callback("end"));
    });
    const client = server.connect();
    expect((await client.response).status).toBe("HTTP/1.1 101 Switching Protocols");
    expect(await takeLarge(client, 8)).toEqual(Array.from({ length: 8 }, (_, i) => `binary 100000 bytes of ${i}`));
    expect(await client.roundTrip()).toEqual(['text "end"']);
    await ran.count(9);
    expect(ran.lines).toEqual([...Array(8).keys(), "end"].map(name => `${name} null`));
  });

  test("50 connections: each gets its own echo, and a broadcast calls back once per socket", async () => {
    await using server = await createServer(implementation);
    const { wss } = server;
    wss.on("connection", ws => ws.on("message", data => ws.send("echo:" + data)));
    const clients = Array.from({ length: 50 }, () => server.connect());
    await Promise.all(clients.map(client => client.response));
    clients.forEach((client, i) => client.text("n" + i));
    expect(await Promise.all(clients.map(client => client.next()))).toEqual(clients.map((_, i) => `text "echo:n${i}"`));
    expect(wss.clients.size).toBe(50);

    const ran = recorder();
    for (const ws of wss.clients) ws.send("to all", ran.callback("sent"));
    await ran.count(50);
    expect(await Promise.all(clients.map(client => client.roundTrip()))).toEqual(clients.map(() => ['text "to all"']));
    expect(ran.lines).toEqual(clients.map(() => "sent null"));
  });
});
