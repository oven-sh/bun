// Tests how a `ws` server socket handles incoming frames, using a raw TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as harnessTls, isLinux } from "harness";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type { ServerOptions, WebSocket } from "ws";
import {
  abnormalClose,
  closePayload,
  deflate,
  deflateWithContext,
  encodeFrame,
  type FrameOptions,
  implementations,
  invalidFrame,
  invalidUTF8,
  MiB,
  nextEvent,
  OP,
  openServer,
  type Payload,
  type RequestOptions,
  runScript,
  scriptTimeout,
  serve,
  tooBig,
  tryCall,
  upgradeRequest,
} from "./ws-raw-peer";

const rsv1MustBeClear = invalidFrame("RSV1 must be clear", "WS_ERR_UNEXPECTED_RSV_1");

const offerDeflate: RequestOptions = { headers: { "Sec-WebSocket-Extensions": "permessage-deflate" } };

const hex = (digits: string) => Buffer.from(digits, "hex");

/** Encodes a masked frame, as a client would send it. */
const frame = (opcode: number, payload?: Payload, options?: FrameOptions) =>
  encodeFrame(opcode, payload, { mask: true, ...options });

/** A masked frame header that declares a `length`-byte payload, with no payload bytes after it. */
function frameHeader(opcode: number, length: number | bigint) {
  const header = Buffer.alloc(14);
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

type Connection = Pick<Awaited<ReturnType<typeof openServer>>, "client" | "events" | "closed">;

/** Expects a failed connection: 'error' while CLOSING, a Close frame with `code`, FIN, then 'close' with 1006. */
async function expectFailure({ client, events, closed }: Connection, error: string, code: number) {
  expect(await client.remainingFrames()).toEqual([`close ${code}`]);
  await closed;
  expect(events).toEqual([`error ${error} rs=2`, abnormalClose]);
}

/** For runScript(): a server and `socket`, its only client. `onConnection` is the 'connection' listener's body. */
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
const bufferLiteral = (bytes: Buffer) => `Buffer.from("${bytes.toString("hex")}", "hex")`;

describe.each(implementations)("ws server receive ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket, WebSocketServer } = implementation;

  describe("messages", () => {
    test("delivers text and binary frames as Buffers by default", async () => {
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
      "with binaryType $binaryType, a binary frame is $binary and a text frame is a Buffer",
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

    test("binaryType can change between messages, and an unknown value is ignored", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.binaryType = "arraybuffer";
      client.binary(hex("01"));
      await nextEvent(ws, "message");
      ws.binaryType = "bogus" as any;
      expect(ws.binaryType).toBe("arraybuffer");
      client.binary(hex("02"));
      await nextEvent(ws, "message");
      ws.binaryType = "nodebuffer";
      client.binary(hex("03"));
      await nextEvent(ws, "message");
      expect(events).toEqual([
        "message ArrayBuffer(0x01) binary rs=1",
        "message ArrayBuffer(0x02) binary rs=1",
        "message Buffer(0x03) binary rs=1",
      ]);
    });

    test("a Blob contains the frame's bytes and has no type", async () => {
      await using server = await openServer(implementation);
      server.ws.binaryType = "blob" as any;
      server.client.binary(hex("0908"));
      const [blob] = await nextEvent(server.ws, "message");
      expect(blob.type).toBe("");
      expect(await blob.bytes()).toEqual(new Uint8Array([9, 8]));
    });

    test("reassembles fragments into one message, and answers a Ping between them immediately", async () => {
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
        label: "a character split across two fragments",
        frames: [frame(OP.text, hex("f09f"), { fin: false }), frame(OP.continuation, hex("98b6"))],
        message: 'message Buffer("😶") text rs=1',
      },
      {
        label: "only empty fragments",
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

    test("delivers fifty frames from one write in order", async () => {
      await using server = await openServer(implementation);
      const texts = Array.from({ length: 50 }, (_, i) => "m" + i);
      server.client.write(Buffer.concat(texts.map(text => frame(OP.text, text))));
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual(texts.map(text => `message Buffer("${text}") text rs=1`));
    });

    test("parses frames that arrive one byte at a time", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.socket.setNoDelay(true);
      const frames = Buffer.concat([frame(OP.text, "hello"), frame(OP.binary, Buffer.alloc(200, 1))]);
      for (let i = 0; i < frames.length; i++) client.write(frames.subarray(i, i + 1));
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("hello") text rs=1', "message Buffer(200 bytes) binary rs=1"]);
    });

    test("skipUTF8Validation delivers a text frame with invalid UTF-8 unchanged", async () => {
      await using server = await openServer(implementation, { skipUTF8Validation: true });
      server.client.text(hex("c328"));
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual(["message Buffer(0xc328) text rs=1"]);
    });
  });

  describe("ping and pong", () => {
    test("answers a Ping with a Pong carrying the same payload, and doesn't answer a Pong", async () => {
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

    test("the payload is a Buffer for every binaryType", async () => {
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

    test("autoPong: false doesn't send a Pong automatically", async () => {
      await using server = await openServer(implementation, { autoPong: false } as ServerOptions);
      const { ws, client, events } = server;
      client.ping("hello");
      await nextEvent(ws, "ping");
      // An automatic Pong would have been sent before this.
      ws.send("marker");
      expect(await client.next()).toBe('text "marker"');
      expect(events).toEqual(['ping Buffer("hello") rs=1']);
    });
  });

  // A paused socket doesn't answer pings, so roundTrip() can't be used on it. To check that nothing was delivered,
  // these tests write to the paused socket and then round-trip on `control`, a second connection to the same server.
  describe("pause() and resume()", () => {
    test("delivers nothing between pause() and resume()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      const control = server.connect();
      await control.response;

      expect(ws.isPaused).toBe(false);
      expect([tryCall(() => ws.pause()), tryCall(() => ws.pause())]).toEqual(["undefined", "undefined"]);
      expect(ws.isPaused).toBe(true);
      client.text("one");
      client.text("two");
      expect(await control.roundTrip()).toEqual([]);
      expect(events).toEqual([]);

      expect([tryCall(() => ws.resume()), tryCall(() => ws.resume())]).toEqual(["undefined", "undefined"]);
      expect(ws.isPaused).toBe(false);
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("one") text rs=1', 'message Buffer("two") text rs=1']);
    });

    test(`pause() and resume() on the request's socket ${builtin ? "have no effect" : "work too"}`, async () => {
      await using server = await openServer(implementation);
      const { req, client, events } = server;
      const control = server.connect();
      await control.response;
      req.socket.pause();
      client.text("one");
      // The built-in reads the connection natively after the upgrade, so only ws.pause() stops it.
      if (!builtin) {
        expect(await control.roundTrip()).toEqual([]);
        expect(events).toEqual([]);
        req.socket.resume();
      }
      expect(await client.roundTrip()).toEqual([]);
      expect(events).toEqual(['message Buffer("one") text rs=1']);
    });

    test("a paused socket can still send, and answers a Ping after resume()", async () => {
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
      const allReceived = Promise.withResolvers<void>();
      let sent = 0;
      ws.on("message", () => events.length === sent && allReceived.resolve());

      ws.pause();
      // Write until the kernel buffers are full: bytes stay in the client's own write queue for a full round trip.
      do {
        client.write(message);
        sent++;
        await control.roundTrip();
      } while (client.socket.writableLength === 0 && sent < 1000);
      expect(client.socket.writableLength).toBeGreaterThan(0);
      expect(events).toEqual([]);

      ws.resume();
      await allReceived.promise;
      expect(events).toEqual(Array(sent).fill("message Buffer(100000 bytes) binary rs=1"));
    });

    test("ignores the peer's Close frame and FIN while paused, and handles them after resume()", async () => {
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
      expect(await client.remainingFrames()).toEqual(['close 1000 "bye"']);
    });

    test("terminate() on a paused socket emits 'close' 1006, and isPaused stays true", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.pause();
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await server.closed;
      expect(events).toEqual([abnormalClose]);
      expect(await client.remainingFrames()).toEqual([]);
      // resume() is a no-op on a CLOSED socket.
      expect([tryCall(() => ws.resume()), ws.isPaused]).toEqual(["undefined", true]);
    });

    test("close() on a paused socket sends the Close frame, and reads the peer's after resume()", async () => {
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
      expect(await client.remainingFrames()).toEqual([]);
    });

    test("pause() on a CLOSED socket is a no-op", async () => {
      await using server = await openServer(implementation);
      server.ws.terminate();
      await server.closed;
      expect([tryCall(() => server.ws.pause()), server.ws.isPaused]).toEqual(["undefined", false]);
    });
  });

  describe("protocol errors", () => {
    test.each([
      {
        label: "an unmasked frame",
        bytes: encodeFrame(OP.text, "x"),
        error: invalidFrame("MASK must be set", "WS_ERR_EXPECTED_MASK"),
      },
      { label: "RSV1 without an extension", bytes: frame(OP.text, "x", { rsv1: true }), error: rsv1MustBeClear },
      {
        label: "RSV2",
        bytes: frame(OP.text, "x", { rsv2: true }),
        error: invalidFrame("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3"),
      },
      {
        label: "RSV3",
        bytes: frame(OP.text, "x", { rsv3: true }),
        error: invalidFrame("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3"),
      },
      { label: "opcode 3", bytes: frame(3, "x"), error: invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE") },
      { label: "opcode 11", bytes: frame(11, "x"), error: invalidFrame("invalid opcode 11", "WS_ERR_INVALID_OPCODE") },
      {
        label: "a continuation frame with no message in progress",
        bytes: frame(OP.continuation, "x"),
        error: invalidFrame("invalid opcode 0", "WS_ERR_INVALID_OPCODE"),
      },
      {
        label: "a new message before the previous one finished",
        bytes: Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.text, "b")]),
        error: invalidFrame("invalid opcode 1", "WS_ERR_INVALID_OPCODE"),
      },
      {
        label: "a fragmented Ping",
        bytes: frame(OP.ping, "x", { fin: false }),
        error: invalidFrame("FIN must be set", "WS_ERR_EXPECTED_FIN"),
      },
      {
        label: "a 126-byte Ping",
        bytes: frame(OP.ping, Buffer.alloc(126)),
        error: invalidFrame("invalid payload length 126", "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"),
      },
      {
        label: "a 1-byte Close frame",
        bytes: frame(OP.close, hex("03")),
        error: invalidFrame("invalid payload length 1", "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"),
      },
      {
        label: "Close 999",
        bytes: frame(OP.close, closePayload(999)),
        error: invalidFrame("invalid status code 999", "WS_ERR_INVALID_CLOSE_CODE"),
      },
      {
        label: "Close 1005",
        bytes: frame(OP.close, closePayload(1005)),
        error: invalidFrame("invalid status code 1005", "WS_ERR_INVALID_CLOSE_CODE"),
      },
      {
        label: "a Close reason with invalid UTF-8",
        bytes: frame(OP.close, closePayload(1000, hex("c328"))),
        error: invalidUTF8,
        code: 1007,
      },
      { label: "text with invalid UTF-8", bytes: frame(OP.text, hex("c328")), error: invalidUTF8, code: 1007 },
      {
        label: "text truncated mid-character",
        bytes: frame(OP.text, hex("f09f")),
        error: invalidUTF8,
        code: 1007,
      },
      {
        label: "fragments that reassemble into invalid UTF-8",
        bytes: Buffer.concat([frame(OP.text, hex("f09f"), { fin: false }), frame(OP.continuation, hex("2828"))]),
        error: invalidUTF8,
        code: 1007,
      },
      {
        label: "a payload length of 2^53",
        bytes: frameHeader(OP.binary, 2n ** 53n),
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
        label: "compressed text with invalid UTF-8",
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

    // The error message comes from zlib and depends on the bytes, so only check the code.
    test("corrupt compressed data fails with Z_DATA_ERROR and Close 1007", async () => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      const { ws, client, events } = server;
      const failed = nextEvent(ws, "error");
      client.text(hex("ffffffff"), { rsv1: true });
      const [error] = await failed;
      expect({ class: error.constructor, code: error.code }).toEqual({ class: Error, code: "Z_DATA_ERROR" });
      expect(await client.remainingFrames()).toEqual(["close 1007"]);
      await server.closed;
      expect(events.slice(1)).toEqual([abnormalClose]);
    });

    test("delivers frames before the bad frame and drops the ones after it", async () => {
      await using server = await openServer(implementation);
      const { client, events } = server;
      client.write(Buffer.concat([frame(OP.text, "before"), frame(3, "x"), frame(OP.text, "after")]));
      expect(await client.remainingFrames()).toEqual(["close 1002"]);
      await server.closed;
      expect(events).toEqual([
        'message Buffer("before") text rs=1',
        `error ${invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE")} rs=2`,
        abnormalClose,
      ]);
    });

    test("close() and send() in the 'error' listener are no-ops", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const calls: string[] = [];
      ws.on("error", () =>
        calls.push(
          tryCall(() => ws.close(1000, "ignored")),
          tryCall(() => ws.send("ignored")),
        ),
      );
      client.write(frame(3, "x"));
      await expectFailure(server, invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE"), 1002);
      expect(calls).toEqual(["undefined", "undefined"]);
    });

    test.concurrent(
      "throws an uncaught exception when there's no 'error' listener",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          serverScript(`
          ws.on("close", (code, reason) => {
            console.log("close", code, show(reason));
            wss.close();
          });
          socket.write(${bufferLiteral(frame(3, "x"))});
        `),
        );
        expect(lines).toEqual([
          `uncaught ${invalidFrame("invalid opcode 3", "WS_ERR_INVALID_OPCODE")}`,
          "close 1006 Buffer()",
        ]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );
  });

  // npm ws's receiver stops for good once a listener throws.
  test.concurrent.skipIf(!builtin)(
    "a throwing 'message' listener doesn't block later messages",
    async () => {
      const { lines, exitCode } = await runScript(
        { specifier },
        serverScript(`
        ws.on("message", data => {
          console.log("message", String(data), ws.readyState);
          if (String(data) === "a") throw new Error("boom");
          if (String(data) === "b") socket.write(${bufferLiteral(frame(OP.text, "c"))});
          if (String(data) === "c") {
            ws.terminate();
            wss.close();
          }
        });
        socket.write(${bufferLiteral(Buffer.concat([frame(OP.text, "a"), frame(OP.text, "b")]))});
      `),
      );
      expect(lines).toEqual(["message a 1", 'uncaught Error "boom"', "message b 1", "message c 1"]);
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );

  describe("permessage-deflate", () => {
    test("receives and sends compressed messages", async () => {
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
        label: "an uncompressed frame (no RSV1)",
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
    ])("receives $label", async ({ bytes, message }) => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      server.client.write(bytes);
      expect(await server.client.roundTrip()).toEqual([]);
      expect(server.events).toEqual([`message ${message} rs=1`]);
    });

    test("accepts a fragmented compressed message with RSV1 on the first fragment and a Ping in between", async () => {
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

    test("keeps the inflate window across messages (context takeover)", async () => {
      await using server = await openServer(implementation, { perMessageDeflate: true }, offerDeflate);
      const { client, events } = server;
      expect(client.header("Sec-WebSocket-Extensions")).toBe("permessage-deflate");
      const [first, second] = await deflateWithContext(["the same words twice", "the same words twice"]);
      // The second payload is just a back-reference to the first.
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
      // Rejected from the header alone, without waiting for the payload.
      { label: "the length in a frame header", bytes: frameHeader(OP.binary, 101) },
      {
        label: "the total of two fragments",
        bytes: Buffer.concat([
          frame(OP.binary, Buffer.alloc(60), { fin: false }),
          frame(OP.continuation, Buffer.alloc(60)),
        ]),
      },
      {
        label: "the inflated size of a small frame",
        bytes: frame(OP.text, deflate(Buffer.alloc(1000, "a")), { rsv1: true }),
        withDeflate: true,
      },
    ])("$label over the limit sends Close 1009 and emits 'close' 1006", async ({ bytes, withDeflate = false }) => {
      await using server = await openServer(
        implementation,
        { maxPayload: 100, perMessageDeflate: withDeflate },
        withDeflate ? offerDeflate : {},
      );
      server.client.write(bytes);
      await expectFailure(server, tooBig, 1009);
    });

    test("delivers messages exactly at the limit", async () => {
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

    test("doesn't apply to Pings", async () => {
      await using server = await openServer(implementation, { maxPayload: 10 });
      server.client.ping(Buffer.alloc(100, "p"));
      expect(await server.client.next()).toBe("pong 100 bytes");
      expect(server.events).toEqual(["ping Buffer(100 bytes) rs=1"]);
    });

    test("applies with the `server` option", async () => {
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
      // Use the loose server first, and again after the strict one.
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

    // Except for the 20 MiB test, these send only a frame header, which is enough to trigger a rejection.
    describe("defaults to 100 MiB, and 0 means no limit", () => {
      test("rejects 100 MiB + 1 by default", async () => {
        await using server = await openServer(implementation);
        server.client.write(frameHeader(OP.binary, 100 * MiB + 1));
        await expectFailure(server, tooBig, 1009);
      });

      test("delivers a 20 MiB message", async () => {
        await using server = await openServer(implementation);
        const payload = Buffer.alloc(20 * MiB, 7);
        const message = nextEvent(server.ws, "message");
        server.client.binary(payload);
        await Promise.race([message, server.closed]);
        expect(server.events).toEqual(["message Buffer(20971520 bytes) binary rs=1"]);
        expect(payload.equals((await message)[0])).toBe(true);
      });

      test.each([
        { label: "100 MiB by default", options: {}, length: 100 * MiB },
        { label: "1 GiB with maxPayload: 0", options: { maxPayload: 0 }, length: 1024 * MiB },
        { label: "1 GiB with maxPayload: undefined", options: { maxPayload: undefined }, length: 1024 * MiB },
      ])("doesn't reject $label", async ({ options, length }) => {
        await using server = await openServer(implementation, options);
        const { ws, client, events } = server;
        const control = server.connect();
        await control.response;
        client.write(frameHeader(OP.binary, length));
        expect(await control.roundTrip()).toEqual([]);
        expect(events).toEqual([]);
        expect(client.frames).toEqual([]);
        expect(ws.readyState).toBe(WebSocket.OPEN);
      });

      // The declared length is untrusted until the bytes actually arrive.
      test.skipIf(!isLinux)("doesn't preallocate the 3 GiB declared by a frame header", async () => {
        const addressSpace = () =>
          Number(/^VmSize:\s*(\d+) kB$/m.exec(readFileSync("/proc/self/status", "utf8"))![1]) * 1024;
        await using server = await openServer(implementation, { maxPayload: 0 });
        const control = server.connect();
        await control.response;
        const before = addressSpace();
        server.client.write(frameHeader(OP.binary, 3 * 1024 * MiB));
        expect(await control.roundTrip()).toEqual([]);
        expect(addressSpace() - before).toBeLessThan(1024 * MiB);
        expect(server.events).toEqual([]);
      });
    });
  });
});
