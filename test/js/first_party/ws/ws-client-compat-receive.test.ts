// Tests how a `ws` client handles the frames it receives from a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { on, once } from "node:events";
import zlib from "node:zlib";
import {
  abnormalClose,
  type ClientOptions,
  closePayload,
  createPeer,
  deflate,
  encodeFrame,
  type FrameOptions,
  implementations,
  nextEvent,
  OP,
  openClient,
  openEvents,
  type Payload,
  type PeerOptions,
  runScript,
  scriptTimeout,
  show,
  showFrame,
} from "./ws-raw-peer";

const bytes = (...values: number[]) => Buffer.from(values);
const repeatA = (count: number) => Buffer.alloc(count, "a");

// Peer options for a server that accepts permessage-deflate.
const withDeflate: PeerOptions = { headers: ["Sec-WebSocket-Extensions: permessage-deflate"] };

// @types/ws is missing "blob" and `autoPong`.
const blob = "blob" as any;
const noAutoPong = { autoPong: false } as ClientOptions;

const binaryTypes = [
  { binaryType: "nodebuffer", binary: "Buffer(0x010203)", empty: "Buffer()" },
  { binaryType: "arraybuffer", binary: "ArrayBuffer(0x010203)", empty: "ArrayBuffer()" },
  { binaryType: "fragments", binary: "[Buffer(0x010203)]", empty: "[]" },
  { binaryType: blob, binary: "Blob(3)", empty: "Blob(0)" },
] as const;

describe.each(implementations)("ws client receive ($name)", ({ ws: implementation, builtin, specifier }) => {
  // `binaryType` only changes the type of binary messages.
  describe.each(binaryTypes)("binaryType $binaryType", ({ binaryType, binary, empty }) => {
    test(`delivers text as a Buffer and binary as ${binary}`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("hi");
      conn.binary(bytes(1, 2, 3));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, 'message Buffer("hi") text rs=1', `message ${binary} binary rs=1`]);
    });

    test(`delivers empty text as an empty Buffer and empty binary as ${empty}`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("");
      conn.binary("");
      conn.binary("", { fin: false });
      conn.send(OP.continuation, "");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        "message Buffer() text rs=1",
        `message ${empty} binary rs=1`,
        `message ${empty} binary rs=1`,
      ]);
    });

    test("joins the fragments of a text message", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("a", { fin: false });
      conn.send(OP.continuation, "b");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, 'message Buffer("ab") text rs=1']);
    });

    // In "fragments" mode npm ws delivers one Buffer per frame. The built-in delivers a single Buffer.
    test.skipIf(binaryType === "fragments")("joins the fragments of a binary message", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.binary(bytes(1), { fin: false });
      conn.send(OP.continuation, bytes(2), { fin: false });
      conn.send(OP.continuation, bytes(3));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, `message ${binary} binary rs=1`]);
    });

    test("delivers compressed messages as the same types", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text(deflate("compressed-😶"), { rsv1: true });
      conn.binary(deflate(bytes(1, 2, 3)), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        'message Buffer("compressed-😶") text rs=1',
        `message ${binary} binary rs=1`,
      ]);
    });

    test(`MessageEvent.data is a string for text and ${binary} for binary`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      ws.binaryType = binaryType;
      const seen: string[] = [];
      ws.addEventListener("message", event =>
        seen.push(`${event.constructor.name} ${event.type} ${show(event.data)} target=${event.target === ws}`),
      );
      ws.onmessage = event => seen.push(`onmessage ${show(event.data)}`);
      conn.text("hi");
      conn.binary(bytes(1, 2, 3));
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual([
        'MessageEvent message "hi" target=true',
        'onmessage "hi"',
        `MessageEvent message ${binary} target=true`,
        `onmessage ${binary}`,
      ]);
    });

    test("'ping' and 'pong' payloads are Buffers", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.ping("p");
      conn.pong("q");
      expect(await conn.roundTrip()).toEqual(['pong "p"']);
      expect(events).toEqual([...openEvents, 'ping Buffer("p") rs=1', 'pong Buffer("q") rs=1']);
    });
  });

  describe("messages", () => {
    test("a Blob message has the right bytes and an empty type", async () => {
      await using client = await openClient(implementation);
      client.ws.binaryType = blob;
      client.conn.binary(bytes(1, 2, 3));
      const [data] = await nextEvent(client.ws, "message");
      expect(data).toBeInstanceOf(Blob);
      expect(data.type).toBe("");
      expect(Buffer.from(await data.arrayBuffer())).toEqual(bytes(1, 2, 3));
    });

    test("binaryType set in a 'message' listener applies to the next binary message in the same packet", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      const nextTypes = ["arraybuffer", blob, "nodebuffer"] as const;
      let changes = 0;
      ws.binaryType = "fragments";
      ws.on("message", (_, isBinary) => {
        if (isBinary && changes < nextTypes.length) ws.binaryType = nextTypes[changes++];
      });
      conn.write(
        Buffer.concat([1, 2, 3, 4].flatMap(n => [conn.frame(OP.text, "text " + n), conn.frame(OP.binary, bytes(n))])),
      );
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        'message Buffer("text 1") text rs=1',
        "message [Buffer(0x01)] binary rs=1",
        'message Buffer("text 2") text rs=1',
        "message ArrayBuffer(0x02) binary rs=1",
        'message Buffer("text 3") text rs=1',
        "message Blob(1) binary rs=1",
        'message Buffer("text 4") text rs=1',
        "message Buffer(0x04) binary rs=1",
      ]);
    });

    test("a text message is a Buffer no matter how the listener was added", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      ws.binaryType = "arraybuffer";
      const seen: Record<string, string[]> = {};
      const listener = (name: string) => {
        const lines: string[] = (seen[name] = []);
        return (data: unknown, isBinary: boolean) => void lines.push(`${show(data)} ${isBinary}`);
      };
      ws.on("message", listener("on"));
      ws.addListener("message", listener("addListener"));
      ws.prependListener("message", listener("prependListener"));
      ws.once("message", listener("once"));
      ws.prependOnceListener("message", listener("prependOnceListener"));
      const viaOnce = once(ws, "message").then(([data, isBinary]) => listener("events.once")(data, isBinary));
      const viaOn = (async () => {
        const push = listener("events.on");
        for await (const [data, isBinary] of on(ws, "message")) {
          push(data, isBinary);
          if (seen["events.on"].length === 2) break;
        }
      })();
      conn.text("1");
      conn.text("2");
      await Promise.all([viaOnce, viaOn]);
      const firstOnly = ['Buffer("1") false'];
      const bothMessages = ['Buffer("1") false', 'Buffer("2") false'];
      expect(seen).toEqual({
        on: bothMessages,
        addListener: bothMessages,
        prependListener: bothMessages,
        once: firstOnly,
        prependOnceListener: firstOnly,
        "events.once": firstOnly,
        "events.on": bothMessages,
      });
    });

    test("delivers text unmodified, including a BOM and a NUL", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.text(bytes(0xef, 0xbb, 0xbf, 0x68, 0x00, 0x69));
      for (const text of ["latin1-©", "bmp-€", "é😀"]) conn.text(text);
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        "message Buffer(0xefbbbf680069) text rs=1",
        'message Buffer("latin1-©") text rs=1',
        'message Buffer("bmp-€") text rs=1',
        'message Buffer("é😀") text rs=1',
      ]);
    });

    test("accepts a UTF-8 character split across two fragments", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      const character = Buffer.from("😀");
      conn.text(character.subarray(0, 2), { fin: false });
      conn.send(OP.continuation, character.subarray(2));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, 'message Buffer("😀") text rs=1']);
    });

    test("doesn't validate binary messages as UTF-8", async () => {
      await using client = await openClient(implementation);
      client.conn.binary(bytes(0xff, 0xfe));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...openEvents, "message Buffer(0xfffe) binary rs=1"]);
    });

    // 125 is the largest length that fits in the 7-bit field, 65535 the largest that fits in 16 bits.
    test.each([125, 126, 65535, 65536])("receives a %d-byte message", async length => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const seen: unknown[] = [];
      ws.on("message", (data, isBinary) => seen.push(data, isBinary));
      conn.binary(repeatA(length));
      conn.text(repeatA(length));
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual([repeatA(length), true, repeatA(length), false]);
    });

    test.each([
      { label: "a text frame", frame: encodeFrame(OP.text, "hé"), line: 'message Buffer("hé") text rs=1' },
      {
        label: "a frame with a 16-bit length",
        frame: encodeFrame(OP.binary, repeatA(126)),
        line: "message Buffer(126 bytes) binary rs=1",
      },
      {
        label: "a frame with a 64-bit length",
        frame: encodeFrame(OP.binary, repeatA(65536)),
        line: "message Buffer(65536 bytes) binary rs=1",
      },
      { label: "a Pong", frame: encodeFrame(OP.pong, "pp"), line: 'pong Buffer("pp") rs=1' },
    ])("parses $label split across two writes, at every offset in its first 12 bytes", async ({ frame, line }) => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      const splits = Math.min(frame.length, 12) - 1;
      for (let split = 1; split <= splits; split++) {
        // Wait for the Pong so the client has read the first part before the second part is sent.
        conn.write(Buffer.concat([conn.frame(OP.ping, "cut"), frame.subarray(0, split)]));
        expect(await conn.next()).toBe('pong "cut"');
        conn.write(frame.subarray(split));
      }
      expect(await conn.roundTrip()).toEqual([]);
      expect(events.slice(2).filter(event => !event.startsWith("ping"))).toEqual(Array(splits).fill(line));
    });

    test.each([
      { label: "2 in 16 bits", sent: bytes(0x81, 126, 0, 2, 0x68, 0x69), line: 'message Buffer("hi") text rs=1' },
      {
        label: "2 in 64 bits",
        sent: bytes(0x81, 127, 0, 0, 0, 0, 0, 0, 0, 2, 0x68, 0x69),
        line: 'message Buffer("hi") text rs=1',
      },
      { label: "0 in 16 bits", sent: bytes(0x81, 126, 0, 0), line: "message Buffer() text rs=1" },
      { label: "0 in 64 bits", sent: bytes(0x82, 127, 0, 0, 0, 0, 0, 0, 0, 0), line: "message Buffer() binary rs=1" },
    ])("accepts a non-minimal length encoding: $label", async ({ sent, line }) => {
      await using client = await openClient(implementation);
      client.conn.write(sent);
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...openEvents, line]);
    });

    test("delivers the messages in one packet in order", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const names = Array.from({ length: 50 }, (_, i) => "m" + i);
      const seen: string[] = [];
      ws.on("message", data => seen.push(String(data)));
      conn.write(Buffer.concat(names.map(name => conn.frame(OP.text, name))));
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual(names);
    });

    test("mutating one message's Buffer doesn't affect the next message", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const seen: Buffer[] = [];
      ws.on("message", data => seen.push(data as Buffer));
      conn.binary(bytes(1, 2));
      conn.binary(bytes(3, 4));
      expect(await conn.roundTrip()).toEqual([]);
      seen[0][0] = 9;
      expect(seen.map(show)).toEqual(["Buffer(0x0902)", "Buffer(0x0304)"]);
    });

    // npm ws's receiver stops reading after the exception. Bun's keeps going.
    test.concurrent.skipIf(!builtin)(
      "still delivers later messages after a 'message' listener throws",
      async () => {
        await using peer = await createPeer();
        const script = runScript(
          { specifier },
          `
          const ws = new WebSocket(process.env.PEER_URL);
          ws.on("message", data => {
            console.log("message " + data);
            if (String(data) === "1") throw new Error("boom in listener");
          });
          ws.on("close", code => console.log("close " + code));
        `,
          { PEER_URL: peer.url },
        );
        const conn = await peer.connection();
        conn.write(
          Buffer.concat([conn.frame(OP.text, "1"), conn.frame(OP.text, "2"), conn.frame(OP.close, closePayload(1000))]),
        );
        conn.end();
        const { lines, exitCode } = await script;
        expect(lines).toEqual(["message 1", 'uncaught Error "boom in listener"', "message 2", "close 1000"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );
  });

  describe("ping and pong", () => {
    test.each([
      { payload: "hello", pong: 'pong "hello"', event: 'ping Buffer("hello") rs=1' },
      { payload: "", pong: "pong", event: "ping Buffer() rs=1" },
      { payload: bytes(0xff, 0x00), pong: "pong 0xff00", event: "ping Buffer(0xff00) rs=1" },
      { payload: repeatA(125), pong: "pong 125 bytes", event: "ping Buffer(125 bytes) rs=1" },
    ])("replies to a Ping with $pong", async ({ payload, pong, event }) => {
      await using client = await openClient(implementation);
      client.conn.ping(payload);
      const sent = (await client.conn.nextFrame())!;
      expect(showFrame(sent)).toBe(pong);
      expect(sent.payload).toEqual(Buffer.from(payload));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...openEvents, event]);
    });

    test("sends the Pong before anything the 'ping' listener sends", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      client.ws.on("ping", () => client.ws.send("from the listener"));
      client.conn.ping("hello");
      expect(await client.conn.nextFrames(2)).toEqual(['pong "hello"', 'text "from the listener"']);
    });

    test("autoPong: false emits 'ping' without sending a Pong", async () => {
      await using client = await openClient(implementation, noAutoPong);
      const { conn, events } = client;
      conn.ping("hello");
      conn.close(1000);
      conn.end();
      await client.closed;
      expect(events).toEqual([...openEvents, 'ping Buffer("hello") rs=1', "close 1000 Buffer() rs=3"]);
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
    });

    test("autoPong: false lets the 'ping' listener send the Pong", async () => {
      await using client = await openClient(implementation, noAutoPong);
      const { ws, conn } = client;
      ws.on("ping", data => ws.pong(data));
      conn.ping("hello");
      conn.close(1000);
      expect(await conn.remainingFrames()).toEqual(['pong "hello"', "close 1000"]);
    });

    test("an unsolicited Pong emits 'pong' and gets no reply", async () => {
      await using client = await openClient(implementation);
      client.conn.pong("q");
      client.conn.pong();
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...openEvents, 'pong Buffer("q") rs=1', "pong Buffer() rs=1"]);
    });

    test("handles a Ping between two fragments immediately", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.text("a", { fin: false });
      conn.ping("mid");
      expect(await conn.next()).toBe('pong "mid"');
      expect(events).toEqual([...openEvents, 'ping Buffer("mid") rs=1']);
      conn.send(OP.continuation, "b");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events.slice(3)).toEqual(['message Buffer("ab") text rs=1']);
    });
  });

  describe("permessage-deflate", () => {
    test.each([
      { response: "no extension", headers: [], extensions: "" },
      { response: "permessage-deflate", headers: withDeflate.headers!, extensions: "permessage-deflate" },
      {
        response: "permessage-deflate with parameters",
        headers: [
          "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_max_window_bits=10",
        ],
        extensions: "permessage-deflate",
      },
    ])("`extensions` when the server responds with $response", async ({ headers, extensions }) => {
      await using client = await openClient(implementation, {}, { headers: [...headers] });
      expect(client.ws.extensions).toBe(extensions);
    });

    test("accepts a mix of compressed and uncompressed messages", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { conn, events } = client;
      conn.text("plain");
      conn.text(deflate("compressed hello"), { rsv1: true });
      conn.text("plain again");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        'message Buffer("plain") text rs=1',
        'message Buffer("compressed hello") text rs=1',
        'message Buffer("plain again") text rs=1',
      ]);
    });

    test("inflates a fragmented message with a Ping between its fragments", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { conn, events } = client;
      const payload = deflate("fragmented and compressed");
      conn.text(payload.subarray(0, 5), { fin: false, rsv1: true });
      conn.ping("mid");
      conn.send(OP.continuation, payload.subarray(5, 9), { fin: false });
      conn.send(OP.continuation, payload.subarray(9));
      expect(await conn.roundTrip()).toEqual(['pong "mid"']);
      expect(events).toEqual([
        ...openEvents,
        'ping Buffer("mid") rs=1',
        'message Buffer("fragmented and compressed") text rs=1',
      ]);
    });

    test("inflates an empty message, with and without its empty deflate block", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { conn, events } = client;
      expect(deflate("")).toEqual(bytes(0));
      conn.text(deflate(""), { rsv1: true });
      conn.text("", { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, "message Buffer() text rs=1", "message Buffer() text rs=1"]);
    });

    test("keeps the inflate window between messages (context takeover)", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { conn, events } = client;
      const text = "the same words again";
      // Using the first message as the dictionary produces what a compressor with context takeover would send next.
      const first = deflate(text);
      const second = deflate(text, { dictionary: Buffer.from(text) });
      expect(second.length).toBeLessThan(first.length / 2);
      conn.text(first, { rsv1: true });
      conn.text(second, { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        `message Buffer("${text}") text rs=1`,
        `message Buffer("${text}") text rs=1`,
      ]);
    });

    test("inflates the message after one whose last deflate block has BFINAL set", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { conn, events } = client;
      conn.text(zlib.deflateRawSync("final block"), { rsv1: true });
      conn.text(deflate("next"), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...openEvents,
        'message Buffer("final block") text rs=1',
        'message Buffer("next") text rs=1',
      ]);
    });
  });

  describe("maxPayload", () => {
    test("accepts a message of exactly maxPayload bytes: unfragmented, fragmented or compressed", async () => {
      await using client = await openClient(implementation, { maxPayload: 100 }, withDeflate);
      const { conn, events } = client;
      conn.binary(repeatA(100));
      conn.binary(repeatA(60), { fin: false });
      conn.send(OP.continuation, repeatA(40));
      conn.binary(deflate(repeatA(100)), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      const message = "message Buffer(100 bytes) binary rs=1";
      expect(events).toEqual([...openEvents, message, message, message]);
    });

    test("doesn't apply to control frames", async () => {
      await using client = await openClient(implementation, { maxPayload: 2 });
      client.conn.ping("hello");
      expect(await client.conn.roundTrip()).toEqual(['pong "hello"']);
      expect(client.events).toEqual([...openEvents, 'ping Buffer("hello") rs=1']);
    });

    test("0 means no limit", async () => {
      await using client = await openClient(implementation, { maxPayload: 0 });
      client.conn.binary(repeatA(70000));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...openEvents, "message Buffer(70000 bytes) binary rs=1"]);
    });
  });

  describe("skipUTF8Validation", () => {
    test("delivers invalid UTF-8 text unmodified", async () => {
      await using client = await openClient(implementation, { skipUTF8Validation: true });
      const { ws, conn, events } = client;
      const data: unknown[] = [];
      ws.onmessage = event => data.push(event.data);
      conn.text(bytes(0x61, 0xff));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...openEvents, "message Buffer(0x61ff) text rs=1"]);
      expect(data).toEqual(["a\ufffd"]);

      conn.close(1000);
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
    });
  });

  describe("protocol errors", () => {
    // The expected 'error', and the Close frame the client sends to the peer.
    const invalidFrame = (text: string, code: string) => ({
      error: `RangeError "Invalid WebSocket frame: ${text}" ${code}`,
      close: "close 1002",
    });
    const invalidOpcode = (value: number) => invalidFrame(`invalid opcode ${value}`, "WS_ERR_INVALID_OPCODE");
    const unexpectedMask = invalidFrame("MASK must be clear", "WS_ERR_UNEXPECTED_MASK");
    const unexpectedRsv1 = invalidFrame("RSV1 must be clear", "WS_ERR_UNEXPECTED_RSV_1");
    const unexpectedRsv23 = invalidFrame("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3");
    const expectedFin = invalidFrame("FIN must be set", "WS_ERR_EXPECTED_FIN");
    const invalidControlLength = (value: number) =>
      invalidFrame(`invalid payload length ${value}`, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
    const invalidCloseCode = (value: number) =>
      invalidFrame(`invalid status code ${value}`, "WS_ERR_INVALID_CLOSE_CODE");
    const invalidUtf8 = {
      error: 'Error "Invalid WebSocket frame: invalid UTF-8 sequence" WS_ERR_INVALID_UTF8',
      close: "close 1007",
    };
    const payloadTooBig = {
      error: 'RangeError "Max payload size exceeded" WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
      close: "close 1009",
    };
    const lengthOver53Bits = {
      error:
        'RangeError "Unsupported WebSocket frame: payload length > 2^53 - 1" WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH',
      close: "close 1009",
    };

    const frame = encodeFrame;
    const text = (payload: Payload, options?: FrameOptions) => frame(OP.text, payload, options);
    const binary = (payload: Payload, options?: FrameOptions) => frame(OP.binary, payload, options);
    const continuation = (payload: Payload, options?: FrameOptions) => frame(OP.continuation, payload, options);
    const max100 = { maxPayload: 100 };

    type Row = {
      label: string;
      sent: Buffer[];
      error: string;
      close: string;
      options?: ClientOptions;
      peer?: PeerOptions;
    };
    const rows: Row[] = [
      { label: "opcode 3", sent: [frame(3, "x")], ...invalidOpcode(3) },
      { label: "opcode 11", sent: [frame(11, "x")], ...invalidOpcode(11) },
      { label: "a continuation frame with no message in progress", sent: [continuation("x")], ...invalidOpcode(0) },
      {
        label: "a new message in the middle of a fragmented one",
        sent: [text("a", { fin: false }), text("b")],
        ...invalidOpcode(1),
      },
      { label: "a masked frame", sent: [text("hi", { mask: true })], ...unexpectedMask },
      {
        label: "RSV1 when permessage-deflate wasn't negotiated",
        sent: [text("hi", { rsv1: true })],
        ...unexpectedRsv1,
      },
      {
        label: "RSV1 with perMessageDeflate: false",
        sent: [text("hi", { rsv1: true })],
        options: { perMessageDeflate: false },
        ...unexpectedRsv1,
      },
      {
        label: "RSV1 on a continuation frame",
        sent: [text(deflate("ab"), { fin: false, rsv1: true }), continuation("x", { rsv1: true })],
        peer: withDeflate,
        ...unexpectedRsv1,
      },
      { label: "RSV1 on a Ping", sent: [frame(OP.ping, "x", { rsv1: true })], peer: withDeflate, ...unexpectedRsv1 },
      { label: "RSV2", sent: [text("hi", { rsv2: true })], ...unexpectedRsv23 },
      { label: "RSV3", sent: [text("hi", { rsv3: true })], ...unexpectedRsv23 },
      { label: "a fragmented Ping", sent: [frame(OP.ping, "x", { fin: false })], ...expectedFin },
      {
        label: "a fragmented Close frame",
        sent: [frame(OP.close, closePayload(1000), { fin: false })],
        ...expectedFin,
      },
      { label: "a 126-byte Ping", sent: [frame(OP.ping, repeatA(126))], ...invalidControlLength(126) },
      { label: "a 126-byte Pong", sent: [frame(OP.pong, repeatA(126))], ...invalidControlLength(126) },
      {
        label: "a 126-byte Close frame",
        sent: [frame(OP.close, closePayload(1000, repeatA(124)))],
        ...invalidControlLength(126),
      },
      { label: "a 1-byte Close frame", sent: [frame(OP.close, bytes(3))], ...invalidControlLength(1) },
      ...[0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535].map(code => ({
        label: `a Close frame with code ${code}`,
        sent: [frame(OP.close, closePayload(code))],
        ...invalidCloseCode(code),
      })),

      {
        label: "a Close frame with an invalid UTF-8 reason",
        sent: [frame(OP.close, closePayload(1000, bytes(0xff)))],
        ...invalidUtf8,
      },
      { label: "a text message with invalid UTF-8", sent: [text(bytes(0xff, 0xfe))], ...invalidUtf8 },
      {
        label: "a text message truncated mid-character",
        sent: [text(Buffer.from("😀").subarray(0, 3))],
        ...invalidUtf8,
      },
      { label: "a text message with an encoded surrogate", sent: [text(bytes(0xed, 0xa0, 0x80))], ...invalidUtf8 },
      { label: "a text message with an overlong NUL", sent: [text(bytes(0xc0, 0x80))], ...invalidUtf8 },
      {
        label: "a text message with invalid UTF-8 in its second fragment",
        sent: [text("a", { fin: false }), continuation(bytes(0xff))],
        ...invalidUtf8,
      },
      {
        label: "a compressed text message with invalid UTF-8",
        sent: [text(deflate(bytes(0xff, 0xfe)), { rsv1: true })],
        peer: withDeflate,
        ...invalidUtf8,
      },

      { label: "a message of maxPayload + 1 bytes", sent: [binary(repeatA(101))], options: max100, ...payloadTooBig },
      {
        label: "a frame header over maxPayload, before any payload arrives",
        sent: [binary(repeatA(200)).subarray(0, 4)],
        options: max100,
        ...payloadTooBig,
      },
      {
        label: "fragments that add up to more than maxPayload",
        sent: [binary(repeatA(60), { fin: false }), continuation(repeatA(60))],
        options: max100,
        ...payloadTooBig,
      },
      {
        label: "a compressed message that inflates to more than maxPayload",
        sent: [binary(deflate(repeatA(200)), { rsv1: true })],
        options: max100,
        peer: withDeflate,
        ...payloadTooBig,
      },
      // The default maxPayload is 100 MiB.
      { label: "a length of 256 MiB", sent: [bytes(0x82, 127, 0, 0, 0, 0, 0x10, 0, 0, 0)], ...payloadTooBig },
      { label: "a length of 2^53", sent: [bytes(0x82, 127, 0, 0x20, 0, 0, 0, 0, 0, 0)], ...lengthOver53Bits },
      {
        label: "a length of 2^64 - 1",
        sent: [bytes(0x82, 127, 255, 255, 255, 255, 255, 255, 255, 255)],
        ...lengthOver53Bits,
      },
    ];

    test.each(rows)(
      "$label: emits 'error', sends $close and FIN, then emits 'close' 1006",
      async ({ sent, error, close, options, peer }) => {
        await using client = await openClient(implementation, options, peer);
        const { conn, events } = client;
        conn.write(Buffer.concat(sent));
        expect(await conn.remainingFrames()).toEqual([close]);
        expect(conn.socketEvents).toEqual(["end"]);
        conn.end();
        await client.closed;
        expect(events).toEqual([...openEvents, `error ${error} rs=2`, abnormalClose]);
      },
    );

    // npm ws forwards zlib's own error ("invalid block type"), so the message isn't compared.
    test("corrupt compressed data: emits Z_DATA_ERROR, sends close 1007 and FIN, then emits 'close' 1006", async () => {
      await using client = await openClient(implementation, {}, withDeflate);
      const { ws, conn, events } = client;
      const errorEvent = nextEvent(ws, "error");
      conn.text(bytes(0xff, 0xff, 0xff, 0xff, 0xff), { rsv1: true });
      const [error] = await errorEvent;
      expect({ class: error.constructor.name, code: error.code }).toEqual({ class: "Error", code: "Z_DATA_ERROR" });
      expect(await conn.remainingFrames()).toEqual(["close 1007"]);
      expect(conn.socketEvents).toEqual(["end"]);
      conn.end();
      await client.closed;
      expect(events).toHaveLength(4);
      expect(events[3]).toBe(abnormalClose);
    });

    test("stays CLOSING after 'error' until the server sends FIN", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      conn.send(3, "x");
      await conn.ended;
      expect(ws.readyState).toBe(implementation.CLOSING);
      expect(events).toEqual([...openEvents, `error ${invalidOpcode(3).error} rs=2`]);
      conn.end();
      await client.closed;
      expect(events.slice(3)).toEqual([abnormalClose]);
    });

    // ws added the `closeTimeout` option in 8.19. The version in node_modules hardcodes 30 s.
    test.skipIf(!builtin)("`closeTimeout` applies after 'error' if the server never sends FIN", async () => {
      await using client = await openClient(implementation, { closeTimeout: 50 } as {});
      const { conn, events } = client;
      conn.send(3, "x");
      await client.closed;
      expect(events).toEqual([...openEvents, `error ${invalidOpcode(3).error} rs=2`, abnormalClose]);
      expect(await conn.remainingFrames()).toEqual(["close 1002"]);
    });

    test("the error stores the Close frame's status code under Symbol(status-code)", async () => {
      await using client = await openClient(implementation);
      client.conn.send(3, "x");
      const [error] = await nextEvent(client.ws, "error");
      expect(error).toBeInstanceOf(RangeError);
      expect(error.name).toBe("RangeError");
      expect(Object.keys(error)).toEqual(["code"]);
      expect(Object.getOwnPropertySymbols(error).map(symbol => `${String(symbol)} ${error[symbol]}`)).toEqual([
        "Symbol(status-code) 1002",
      ]);
    });

    test("delivers frames before the invalid frame and ignores frames after it", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.write(
        Buffer.concat([
          conn.frame(OP.text, "before"),
          conn.frame(3, "x"),
          conn.frame(4, "y"),
          conn.frame(OP.text, "after"),
          conn.frame(OP.ping, "after"),
        ]),
      );
      expect(await conn.remainingFrames()).toEqual(["close 1002"]);
      conn.end();
      await client.closed;
      expect(events).toEqual([
        ...openEvents,
        'message Buffer("before") text rs=1',
        `error ${invalidOpcode(3).error} rs=2`,
        abnormalClose,
      ]);
    });

    test("ignores the peer's reply to the Close frame, so 'close' is 1006", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.send(3, "x");
      expect(await conn.remainingFrames()).toEqual(["close 1002"]);
      conn.close(1002, "echo");
      conn.end();
      await client.closed;
      expect(events).toEqual([...openEvents, `error ${invalidOpcode(3).error} rs=2`, abnormalClose]);
    });

    test("an invalid frame after close() emits 'error' and 'close' 1006 without a second Close frame", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.close(1000);
      expect(await conn.next()).toBe("close 1000");
      conn.send(3, "x");
      expect(await conn.remainingFrames()).toEqual([]);
      expect(conn.socketEvents).toEqual(["end"]);
      conn.end();
      await client.closed;
      expect(events).toEqual([...openEvents, `error ${invalidOpcode(3).error} rs=2`, abnormalClose]);
    });
  });
});
