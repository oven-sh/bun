// What a `ws` server socket does with the frames it receives, from a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as harnessTls } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type { ServerOptions, WebSocket, WebSocketServer } from "ws";
import {
  attempt,
  closePayload,
  encodeFrame,
  event,
  type FrameOptions,
  implementations,
  OP,
  openServer,
  type Payload,
  type RequestOptions,
  runScript,
  scriptTimeout,
  serve,
  upgradeRequest,
} from "./ws-raw-peer";

const MiB = 1024 * 1024;
const lost = "close 1006 Buffer() rs=3";
const tooBig = 'RangeError "Max payload size exceeded" WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
const invalid = (what: string, code: string) => `RangeError "Invalid WebSocket frame: ${what}" ${code}`;
const invalidUTF8 = 'Error "Invalid WebSocket frame: invalid UTF-8 sequence" WS_ERR_INVALID_UTF8';
const rsv1MustBeClear = invalid("RSV1 must be clear", "WS_ERR_UNEXPECTED_RSV_1");

const offerDeflate: RequestOptions = { headers: { "Sec-WebSocket-Extensions": "permessage-deflate" } };

const hex = (digits: string) => Buffer.from(digits, "hex");

/** A frame as a client sends it. */
const frame = (opcode: number, payload?: Payload, options?: FrameOptions) =>
  encodeFrame(opcode, payload, { mask: true, ...options });

/** The head of a client's frame that announces `length` bytes, and none of them. */
function frameHead(opcode: number, length: number | bigint) {
  const head = Buffer.alloc(14);
  head[0] = 0x80 | opcode;
  head[1] = 0x80 | 127;
  head.writeBigUInt64BE(BigInt(length), 2);
  return head;
}

/** The payload of a compressed message that does not need the messages before it. */
function deflate(data: Payload) {
  return zlib.deflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, -4);
}

/** The payloads of compressed messages that share one window: a later one refers to the text of an earlier one. */
async function deflateWithContext(messages: string[]) {
  const stream = zlib.createDeflateRaw();
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const payloads: Buffer[] = [];
  for (const message of messages) {
    stream.write(message);
    await new Promise<void>(resolve => stream.flush(zlib.constants.Z_SYNC_FLUSH, resolve));
    payloads.push(Buffer.concat(chunks.splice(0)).subarray(0, -4));
  }
  stream.destroy();
  return payloads;
}

type Connection = Pick<Awaited<ReturnType<typeof openServer>>, "client" | "events" | "closed">;

/** The server fails the connection: 'error' while CLOSING, a Close frame with `code`, FIN, then 'close' with 1006. */
async function expectFailure({ client, events, closed }: Connection, error: string, code: number) {
  expect(await client.rest()).toEqual([`close ${code}`]);
  await closed;
  expect(events).toEqual([`error ${error} rs=2`, lost]);
}

/** For runScript(): a server and `socket`, its one client. `onConnection` is the body of the 'connection' listener. */
const serverScript = (onConnection: string) => `
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => {
    const socket = require("node:net").connect(wss.address().port, "127.0.0.1");
    socket.resume();
    socket.write(${JSON.stringify(upgradeRequest())});
    wss.on("connection", ws => {
      ${onConnection}
    });
  });
`;
const inScript = (bytes: Buffer) => `Buffer.from("${bytes.toString("hex")}", "hex")`;

describe.each(implementations)("ws server, receiving ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket, WebSocketServer } = implementation;

  describe("messages", () => {
    test("text and binary frames are Buffers by default", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      expect(ws.binaryType).toBe("nodebuffer");
      client.text("héllo");
      client.binary(hex("010203"));
      client.text("");
      client.binary("");
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual([
        'message Buffer("héllo") text rs=1',
        "message Buffer(0x010203) binary rs=1",
        "message Buffer() text rs=1",
        "message Buffer() binary rs=1",
      ]);
    });

    test.each([
      { binaryType: "nodebuffer", binary: "Buffer(0x0908)" },
      { binaryType: "arraybuffer", binary: "ArrayBuffer(0x0908)" },
      { binaryType: "fragments", binary: "[Buffer(0x0908)]" },
      { binaryType: "blob", binary: "Blob(2)" },
    ])(
      "binaryType $binaryType: a binary frame is $binary, a text frame is a Buffer",
      async ({ binaryType, binary }) => {
        await using server = await openServer(implementation);
        const { ws, client, events } = server;
        ws.binaryType = binaryType as WebSocket["binaryType"];
        expect<string>(ws.binaryType).toBe(binaryType);
        client.text("hello-©-🦞");
        client.text("");
        client.binary(hex("0908"));
        expect(await client.roundTrip()).toEqual([]);
        expect(events).toEqual([
          'message Buffer("hello-©-🦞") text rs=1',
          "message Buffer() text rs=1",
          `message ${binary} binary rs=1`,
        ]);
      },
    );

    test("binaryType can change between two messages, and an unknown value is ignored", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.binaryType = "arraybuffer";
      client.binary(hex("01"));
      await event(ws, "message");
      ws.binaryType = "bogus" as any;
      expect(ws.binaryType).toBe("arraybuffer");
      client.binary(hex("02"));
      await event(ws, "message");
      ws.binaryType = "nodebuffer";
      client.binary(hex("03"));
      await event(ws, "message");
      expect(events).toEqual([
        "message ArrayBuffer(0x01) binary rs=1",
        "message ArrayBuffer(0x02) binary rs=1",
        "message Buffer(0x03) binary rs=1",
      ]);
    });

    test("a Blob has the bytes of the frame and no type", async () => {
      await using server = await openServer(implementation);
      server.ws.binaryType = "blob" as any;
      server.client.binary(hex("0908"));
      const [blob] = await event(server.ws, "message");
      expect(blob.type).toBe("");
      expect(await blob.bytes()).toEqual(new Uint8Array([9, 8]));
    });

    test("fragments make one message, and a Ping between them is answered at once", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.text("ab", { fin: false });
      client.ping("mid");
      client.send(OP.continuation, "cd", { fin: false });
      client.send(OP.continuation, "ef");
      expect(await client.roundTrip()).toEqual(['pong "mid"']);
      expect(events).toEqual(['ping Buffer("mid") rs=1', 'message Buffer("abcdef") text rs=1']);
    });

    test.each([
      {
        label: "a character cut in two",
        frames: [frame(OP.text, hex("f09f"), { fin: false }), frame(OP.continuation, hex("98b6"))],
        message: 'message Buffer("😶") text rs=1',
      },
      {
        label: "nothing but empty fragments",
        frames: [
          frame(OP.text, "", { fin: false }),
          frame(OP.continuation, "", { fin: false }),
          frame(OP.continuation),
        ],
        message: "message Buffer() text rs=1",
      },
      {
        label: "binary fragments",
        frames: [
          frame(OP.binary, hex("01"), { fin: false }),
          frame(OP.continuation, "", { fin: false }),
          frame(OP.continuation, hex("0203")),
        ],
        message: "message Buffer(0x010203) binary rs=1",
      },
    ])("fragments: $label", async ({ frames, message }) => {
      await using server = await openServer(implementation);
      for (const fragment of frames) server.client.write(fragment);
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual([message]);
    });

    test("fifty frames in one write arrive in order", async () => {
      await using server = await openServer(implementation);
      const texts = Array.from({ length: 50 }, (_, i) => "m" + i);
      server.client.write(Buffer.concat(texts.map(text => frame(OP.text, text))));
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual(texts.map(text => `message Buffer("${text}") text rs=1`));
    });

    test("frames that arrive one byte at a time", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.socket.setNoDelay(true);
      const frames = Buffer.concat([frame(OP.text, "hello"), frame(OP.binary, Buffer.alloc(200, 1))]);
      for (let i = 0; i < frames.length; i++) client.write(frames.subarray(i, i + 1));
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("hello") text rs=1', "message Buffer(200 bytes) binary rs=1"]);
    });

    test("skipUTF8Validation: a text frame that is not UTF-8 is delivered as it is", async () => {
      await using server = await openServer(implementation, { skipUTF8Validation: true });
      server.client.text(hex("c328"));
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual(["message Buffer(0xc328) text rs=1"]);
    });
  });

  describe("ping and pong", () => {
    test("a Ping is answered with its payload, a Pong is not answered", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.ping("hello");
      expect(await client.next()).toBe('pong "hello"');
      client.ping();
      expect(await client.next()).toBe("pong");
      client.ping(Buffer.alloc(125, "p"));
      expect(await client.next()).toBe("pong 125 bytes");
      client.pong("unsolicited");
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual([
        'ping Buffer("hello") rs=1',
        "ping Buffer() rs=1",
        "ping Buffer(125 bytes) rs=1",
        'pong Buffer("unsolicited") rs=1',
      ]);
    });

    test("their payload is a Buffer in every binaryType", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      for (const binaryType of ["arraybuffer", "fragments", "blob"]) {
        ws.binaryType = binaryType as WebSocket["binaryType"];
        client.ping("i");
        client.pong("o");
        expect(await client.roundTrip()).toEqual(['pong "i"']);
      }
      expect(events).toEqual(Array(3).fill(['ping Buffer("i") rs=1', 'pong Buffer("o") rs=1']).flat());
    });

    test("autoPong: false leaves the answer to the 'ping' listener", async () => {
      await using server = await openServer(implementation, { autoPong: false } as ServerOptions);
      const { ws, client, events } = server;
      client.ping("hello");
      await event(ws, "ping");
      // A Pong would have gone out before this.
      ws.send("marker");
      expect(await client.next()).toBe('text "marker"');
      expect(events).toEqual(['ping Buffer("hello") rs=1']);
    });
  });

  // A paused socket answers nothing, so "nothing was delivered" is read after a round trip on a second connection
  // to the same server, made after the bytes for the paused one went out.
  describe("pause() and resume()", () => {
    test("nothing is delivered between pause() and resume()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const control = server.connect();
      await control.response;

      expect(ws.isPaused).toBe(false);
      expect([attempt(() => ws.pause()), attempt(() => ws.pause())]).toEqual(["undefined", "undefined"]);
      expect(ws.isPaused).toBe(true);
      client.text("one");
      client.text("two");
      expect(await control.roundTrip()).toEqual([]);
      expect(events).toEqual([]);

      expect([attempt(() => ws.resume()), attempt(() => ws.resume())]).toEqual(["undefined", "undefined"]);
      expect(ws.isPaused).toBe(false);
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("one") text rs=1', 'message Buffer("two") text rs=1']);
    });

    test(`pause() and resume() of the request's socket ${builtin ? "do nothing" : "do the same"}`, async () => {
      await using server = await openServer(implementation);
      const { req, client, events } = server;
      const control = server.connect();
      await control.response;
      req.socket.pause();
      client.text("one");
      // On the built-in the connection is read natively after the upgrade: only ws.pause() stops that.
      if (!builtin) {
        expect(await control.roundTrip()).toEqual([]);
        expect(events).toEqual([]);
        req.socket.resume();
      }
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("one") text rs=1']);
    });

    test("a paused socket still sends, and answers a Ping after resume()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const control = server.connect();
      await control.response;
      ws.pause();
      client.ping("p");
      expect(await control.roundTrip()).toEqual([]);
      ws.send("still sends");
      expect(await client.next()).toBe('text "still sends"');
      expect(events).toEqual([]);
      ws.resume();
      expect(await client.next()).toBe('pong "p"');
      expect(events).toEqual(['ping Buffer("p") rs=1']);
    });

    test.each([
      { transport: "TCP", secure: false },
      { transport: "TLS", secure: true },
    ])("a paused socket stops reading, so the peer's writes stall ($transport)", async ({ secure }) => {
      await using httpServer = await serve(secure ? https.createServer(harnessTls) : http.createServer());
      const wss = new WebSocketServer({ server: httpServer.server });
      const { ws, client, events } = await httpServer.open(wss);
      const { client: control } = await httpServer.open(wss);
      const message = frame(OP.binary, Buffer.alloc(100_000));
      const all = Promise.withResolvers<void>();
      let sent = 0;
      ws.on("message", () => events.length === sent && all.resolve());

      ws.pause();
      // Until the kernel's buffers are full: bytes stay in the client's own queue for a whole round trip.
      do {
        client.write(message);
        sent++;
        await control.roundTrip();
      } while (client.socket.writableLength === 0 && sent < 1000);
      expect(client.socket.writableLength).toBeGreaterThan(0);
      expect(events).toEqual([]);

      ws.resume();
      await all.promise;
      expect(events).toEqual(Array(sent).fill("message Buffer(100000 bytes) binary rs=1"));
    });

    test("the peer closes while the socket is paused: nothing happens until resume()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const control = server.connect();
      await control.response;
      ws.pause();
      client.text("last");
      client.close(1000, "bye");
      client.end();
      expect(await control.roundTrip()).toEqual([]);
      expect(events).toEqual([]);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.resume();
      await server.closed;
      expect(events).toEqual(['message Buffer("last") text rs=1', 'close 1000 Buffer("bye") rs=3']);
      expect(await client.rest()).toEqual(['close 1000 "bye"']);
    });

    test("terminate() on a paused socket: 'close' 1006, and isPaused stays true", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.pause();
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await server.closed;
      expect(events).toEqual([lost]);
      expect(await client.rest()).toEqual([]);
      // resume() does nothing on a CLOSED socket.
      expect([attempt(() => ws.resume()), ws.isPaused]).toEqual(["undefined", true]);
    });

    test("close() on a paused socket: the Close frame goes out, the peer's is read after resume()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const control = server.connect();
      await control.response;
      ws.pause();
      ws.close(1000, "mine");
      expect(ws.isPaused).toBe(true);
      expect(await client.next()).toBe('close 1000 "mine"');
      client.text("late");
      client.close(1000, "theirs");
      expect(await control.roundTrip()).toEqual([]);
      expect(events).toEqual([]);
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      ws.resume();
      await server.closed;
      expect(events).toEqual(['message Buffer("late") text rs=2', 'close 1000 Buffer("theirs") rs=3']);
      expect(await client.rest()).toEqual([]);
    });

    test("pause() on a CLOSED socket does nothing", async () => {
      await using server = await openServer(implementation);
      server.ws.terminate();
      await server.closed;
      expect([attempt(() => server.ws.pause()), server.ws.isPaused]).toEqual(["undefined", false]);
    });
  });

  describe("protocol errors", () => {
    test.each([
      {
        label: "a frame without a mask",
        bytes: encodeFrame(OP.text, "x"),
        error: invalid("MASK must be set", "WS_ERR_EXPECTED_MASK"),
      },
      { label: "RSV1 without an extension", bytes: frame(OP.text, "x", { rsv1: true }), error: rsv1MustBeClear },
      {
        label: "RSV2",
        bytes: frame(OP.text, "x", { rsv2: true }),
        error: invalid("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3"),
      },
      {
        label: "RSV3",
        bytes: frame(OP.text, "x", { rsv3: true }),
        error: invalid("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3"),
      },
      { label: "opcode 3", bytes: frame(3, "x"), error: invalid("invalid opcode 3", "WS_ERR_INVALID_OPCODE") },
      { label: "opcode 11", bytes: frame(11, "x"), error: invalid("invalid opcode 11", "WS_ERR_INVALID_OPCODE") },
      {
        label: "a continuation frame with nothing to continue",
        bytes: frame(OP.continuation, "x"),
        error: invalid("invalid opcode 0", "WS_ERR_INVALID_OPCODE"),
      },
      {
        label: "a new message in the middle of another",
        bytes: Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.text, "b")]),
        error: invalid("invalid opcode 1", "WS_ERR_INVALID_OPCODE"),
      },
      {
        label: "a Ping in fragments",
        bytes: frame(OP.ping, "x", { fin: false }),
        error: invalid("FIN must be set", "WS_ERR_EXPECTED_FIN"),
      },
      {
        label: "a Ping of 126 bytes",
        bytes: frame(OP.ping, Buffer.alloc(126)),
        error: invalid("invalid payload length 126", "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"),
      },
      {
        label: "a Close frame of one byte",
        bytes: frame(OP.close, hex("03")),
        error: invalid("invalid payload length 1", "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"),
      },
      {
        label: "Close 999",
        bytes: frame(OP.close, closePayload(999)),
        error: invalid("invalid status code 999", "WS_ERR_INVALID_CLOSE_CODE"),
      },
      {
        label: "Close 1005",
        bytes: frame(OP.close, closePayload(1005)),
        error: invalid("invalid status code 1005", "WS_ERR_INVALID_CLOSE_CODE"),
      },
      {
        label: "a Close reason that is not UTF-8",
        bytes: frame(OP.close, closePayload(1000, hex("c328"))),
        error: invalidUTF8,
        code: 1007,
      },
      { label: "text that is not UTF-8", bytes: frame(OP.text, hex("c328")), error: invalidUTF8, code: 1007 },
      {
        label: "text that ends inside a character",
        bytes: frame(OP.text, hex("f09f")),
        error: invalidUTF8,
        code: 1007,
      },
      {
        label: "fragments that are not UTF-8 together",
        bytes: Buffer.concat([frame(OP.text, hex("f09f"), { fin: false }), frame(OP.continuation, hex("2828"))]),
        error: invalidUTF8,
        code: 1007,
      },
      {
        label: "a length of 2^53",
        bytes: frameHead(OP.binary, 2n ** 53n),
        error:
          'RangeError "Unsupported WebSocket frame: payload length > 2^53 - 1" WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH',
        code: 1009,
      },
      {
        label: "RSV1 on a continuation frame",
        bytes: Buffer.concat([
          frame(OP.text, deflate("hello").subarray(0, 2), { rsv1: true, fin: false }),
          frame(OP.continuation, deflate("hello").subarray(2), { rsv1: true }),
        ]),
        error: rsv1MustBeClear,
        withDeflate: true,
      },
      {
        label: "RSV1 on a Ping",
        bytes: frame(OP.ping, "x", { rsv1: true }),
        error: rsv1MustBeClear,
        withDeflate: true,
      },
      {
        label: "RSV1 on a Close frame",
        bytes: frame(OP.close, "", { rsv1: true }),
        error: rsv1MustBeClear,
        withDeflate: true,
      },
      {
        label: "compressed text that is not UTF-8",
        bytes: frame(OP.text, deflate(hex("c328")), { rsv1: true }),
        error: invalidUTF8,
        code: 1007,
        withDeflate: true,
      },
    ])("$label", async ({ bytes, error, code = 1002, withDeflate = false }) => {
      await using server = await openServer(
        implementation,
        { perMessageDeflate: withDeflate },
        withDeflate ? offerDeflate : {},
      );
      server.client.write(bytes);
      await expectFailure(server, error, code);
    });

    // The text of the error is zlib's own and depends on the bytes.
    test("compressed data that does not inflate: Z_DATA_ERROR and Close 1007", async () => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      const { ws, client, events } = server;
      const failed = event(ws, "error");
      client.text(hex("ffffffff"), { rsv1: true });
      const [error] = await failed;
      expect({ class: error.constructor, code: error.code }).toEqual({ class: Error, code: "Z_DATA_ERROR" });
      expect(await client.rest()).toEqual(["close 1007"]);
      await server.closed;
      expect(events.slice(1)).toEqual([lost]);
    });

    test("what came before the bad frame is delivered, what follows it is not", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.write(Buffer.concat([frame(OP.text, "before"), frame(3, "x"), frame(OP.text, "after")]));
      expect(await client.rest()).toEqual(["close 1002"]);
      await server.closed;
      expect(events).toEqual([
        'message Buffer("before") text rs=1',
        `error ${invalid("invalid opcode 3", "WS_ERR_INVALID_OPCODE")} rs=2`,
        lost,
      ]);
    });

    test("close() and send() in the 'error' listener do nothing", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const calls: string[] = [];
      ws.on("error", () =>
        calls.push(
          attempt(() => ws.close(1000, "ignored")),
          attempt(() => ws.send("ignored")),
        ),
      );
      client.write(frame(3, "x"));
      await expectFailure(server, invalid("invalid opcode 3", "WS_ERR_INVALID_OPCODE"), 1002);
      expect(calls).toEqual(["undefined", "undefined"]);
    });

    test.concurrent(
      "without an 'error' listener the error is an uncaught exception",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          serverScript(`
          ws.on("close", (code, reason) => {
            console.log("close", code, show(reason));
            wss.close();
          });
          socket.write(${inScript(frame(3, "x"))});
        `),
        );
        expect(lines).toEqual([
          `uncaught ${invalid("invalid opcode 3", "WS_ERR_INVALID_OPCODE")}`,
          "close 1006 Buffer()",
        ]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );
  });

  // npm ws's receiver never goes on after a listener threw.
  test.concurrent.skipIf(!builtin)(
    "a 'message' listener that throws does not stop later messages",
    async () => {
      const { lines, exitCode } = await runScript(
        { specifier },
        serverScript(`
        ws.on("message", data => {
          console.log("message", String(data), ws.readyState);
          if (String(data) === "a") throw new Error("boom");
          if (String(data) === "b") socket.write(${inScript(frame(OP.text, "c"))});
          if (String(data) === "c") {
            ws.terminate();
            wss.close();
          }
        });
        socket.write(${inScript(Buffer.concat([frame(OP.text, "a"), frame(OP.text, "b")]))});
      `),
      );
      expect(lines).toEqual(["message a 1", 'uncaught Error "boom"', "message b 1", "message c 1"]);
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );

  describe("permessage-deflate", () => {
    test("a compressed message in, a compressed message out", async () => {
      const parameters = "permessage-deflate; client_no_context_takeover; server_no_context_takeover";
      await using server = await openServer(
        implementation,
        { perMessageDeflate: { threshold: 0 } },
        { headers: { "Sec-WebSocket-Extensions": parameters } },
      );
      const { ws, client, events } = server;
      expect(client.header("Sec-WebSocket-Extensions")).toBe(parameters);
      expect(ws.extensions).toBe("permessage-deflate");

      client.text(deflate("compressed hello compressed hello"), { rsv1: true });
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("compressed hello compressed hello") text rs=1']);

      const text = Buffer.alloc(50, "a").toString();
      ws.send(text);
      const sent = (await client.nextFrame())!;
      expect({ opcode: sent.opcode, rsv: sent.rsv, fin: sent.fin }).toEqual({ opcode: OP.text, rsv: 4, fin: true });
      expect(sent.length).toBeLessThan(text.length);
      expect(zlib.inflateRawSync(sent.payload, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString()).toBe(text);

      ws.send("not compressed", { compress: false });
      expect(await client.next()).toBe('text "not compressed"');
    });

    test.each([
      {
        label: "a frame without RSV1 is taken as it is",
        bytes: frame(OP.text, "plain"),
        message: 'Buffer("plain") text',
      },
      { label: "an empty message", bytes: frame(OP.text, hex("00"), { rsv1: true }), message: "Buffer() text" },
      {
        label: "a binary message",
        bytes: frame(OP.binary, deflate(hex("010203")), { rsv1: true }),
        message: "Buffer(0x010203) binary",
      },
      {
        label: "a message that inflates to 1 MiB",
        bytes: frame(OP.binary, deflate(Buffer.alloc(MiB, 1)), { rsv1: true }),
        message: "Buffer(1048576 bytes) binary",
      },
    ])("$label", async ({ bytes, message }) => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      server.client.write(bytes);
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual([`message ${message} rs=1`]);
    });

    test("a compressed message in fragments has RSV1 on the first, and a Ping may come between them", async () => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      const { client, events } = server;
      const payload = deflate("fragmented and compressed");
      client.text(payload.subarray(0, 5), { rsv1: true, fin: false });
      client.ping("mid");
      client.send(OP.continuation, payload.subarray(5, 9), { fin: false });
      client.send(OP.continuation, payload.subarray(9));
      expect(await client.roundTrip()).toEqual(['pong "mid"']);
      expect(events).toEqual(['ping Buffer("mid") rs=1', 'message Buffer("fragmented and compressed") text rs=1']);
    });

    test("the window is kept from one message to the next", async () => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      const { client, events } = server;
      expect(client.header("Sec-WebSocket-Extensions")).toBe("permessage-deflate");
      const [first, second] = await deflateWithContext(["the same words twice", "the same words twice"]);
      // The second is only a reference to the first.
      expect(second.length).toBeLessThan(first.length / 2);
      client.text(first, { rsv1: true });
      client.text(second, { rsv1: true });
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(Array(2).fill('message Buffer("the same words twice") text rs=1'));
    });
  });

  describe("maxPayload", () => {
    test.each([
      { label: "a binary frame", bytes: frame(OP.binary, Buffer.alloc(101)) },
      { label: "a text frame", bytes: frame(OP.text, Buffer.alloc(101, "a")) },
      // The payload is not waited for.
      { label: "the head of a frame", bytes: frameHead(OP.binary, 101) },
      {
        label: "the sum of two fragments",
        bytes: Buffer.concat([
          frame(OP.binary, Buffer.alloc(60), { fin: false }),
          frame(OP.continuation, Buffer.alloc(60)),
        ]),
      },
      {
        label: "a small frame that inflates to more",
        bytes: frame(OP.text, deflate(Buffer.alloc(1000, "a")), { rsv1: true }),
        withDeflate: true,
      },
    ])("$label over the limit: Close 1009 on the wire, 'close' 1006", async ({ bytes, withDeflate = false }) => {
      await using server = await openServer(
        implementation,
        { maxPayload: 100, perMessageDeflate: withDeflate },
        withDeflate ? offerDeflate : {},
      );
      server.client.write(bytes);
      await expectFailure(server, tooBig, 1009);
    });

    test("messages of exactly the limit are delivered", async () => {
      await using server = await openServer(implementation, { maxPayload: 100, perMessageDeflate: true }, offerDeflate);
      const { client, events } = server;
      client.binary(Buffer.alloc(100, 1));
      client.binary(Buffer.alloc(60), { fin: false });
      client.send(OP.continuation, Buffer.alloc(40));
      client.text(deflate(Buffer.alloc(100, "a")), { rsv1: true });
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual([
        "message Buffer(100 bytes) binary rs=1",
        "message Buffer(100 bytes) binary rs=1",
        "message Buffer(100 bytes) text rs=1",
      ]);
    });

    test("a Ping does not count", async () => {
      await using server = await openServer(implementation, { maxPayload: 10 });
      server.client.ping(Buffer.alloc(100, "p"));
      expect(await server.client.next()).toBe("pong 100 bytes");
      expect(server.events).toEqual(["ping Buffer(100 bytes) rs=1"]);
    });

    test("with the `server` option", async () => {
      await using httpServer = await serve(http.createServer());
      const connection = await httpServer.open(new WebSocketServer({ server: httpServer.server, maxPayload: 100 }));
      connection.client.binary(Buffer.alloc(101));
      await expectFailure(connection, tooBig, 1009);
    });

    test("two `noServer` servers on one http.Server keep their own limits", async () => {
      await using httpServer = await serve(http.createServer());
      const strict = new WebSocketServer({ noServer: true, maxPayload: 100 });
      const loose = new WebSocketServer({ noServer: true, maxPayload: 1000 });
      httpServer.server.on("upgrade", (request, socket, head) => {
        const wss = request.url === "/loose" ? loose : strict;
        wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
      });
      // The looser one is used first, and again after the stricter one.
      for (const [wss, path] of [
        [loose, "/loose"],
        [strict, "/strict"],
        [loose, "/loose"],
      ] as const) {
        const connection = await httpServer.open(wss, { path });
        connection.client.binary(Buffer.alloc(500));
        if (wss === strict) {
          await expectFailure(connection, tooBig, 1009);
        } else {
          expect(await connection.client.roundTrip()).toEqual([]);
          expect(connection.events).toEqual(["message Buffer(500 bytes) binary rs=1"]);
        }
      }
    });

    // But for the 20 MiB, only the head of a frame is sent: that is enough to be refused.
    describe("the default is 100 MiB, 0 is no limit", () => {
      test("100 MiB + 1 is refused by default", async () => {
        await using server = await openServer(implementation);
        server.client.write(frameHead(OP.binary, 100 * MiB + 1));
        await expectFailure(server, tooBig, 1009);
      });

      test("a message of 20 MiB is delivered", async () => {
        await using server = await openServer(implementation);
        const payload = Buffer.alloc(20 * MiB, 7);
        const message = event(server.ws, "message");
        server.client.binary(payload);
        await Promise.race([message, server.closed]);
        expect(server.events).toEqual(["message Buffer(20971520 bytes) binary rs=1"]);
        expect(payload.equals((await message)[0])).toBe(true);
      });

      test.each([
        { label: "100 MiB by default", options: {}, length: 100 * MiB },
        { label: "1 GiB with maxPayload: 0", options: { maxPayload: 0 }, length: 1024 * MiB },
        { label: "1 GiB with maxPayload: undefined", options: { maxPayload: undefined }, length: 1024 * MiB },
      ])("$label is not refused", async ({ options, length }) => {
        await using server = await openServer(implementation, options);
        const { ws, client, events } = server;
        const control = server.connect();
        await control.response;
        client.write(frameHead(OP.binary, length));
        expect(await control.roundTrip()).toEqual([]);
        expect(events).toEqual([]);
        expect(client.frames).toEqual([]);
        expect(ws.readyState).toBe(WebSocket.OPEN);
      });
    });
  });
});
