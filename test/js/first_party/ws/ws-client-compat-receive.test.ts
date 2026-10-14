// What a `ws` client does with the frames it receives, against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { on, once } from "node:events";
import zlib from "node:zlib";
import {
  type ClientOptions,
  closePayload,
  createPeer,
  encodeFrame,
  event,
  type FrameOptions,
  implementations,
  OP,
  openClient,
  type Payload,
  type PeerOptions,
  runScript,
  scriptTimeout,
  show,
  showFrame,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const lost = "close 1006 Buffer() rs=3";
const bytes = (...values: number[]) => Buffer.from(values);
const a = (count: number) => Buffer.alloc(count, "a");

// The server accepts permessage-deflate.
const deflate: PeerOptions = { headers: ["Sec-WebSocket-Extensions: permessage-deflate"] };
// The payload of a compressed message: raw deflate with a sync flush, without the 00 00 ff ff at its end.
const compress = (data: Payload, options: zlib.ZlibOptions = {}) =>
  zlib.deflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH, ...options }).subarray(0, -4);

// @types/ws knows neither "blob" nor `autoPong`.
const blob = "blob" as any;
const noAutoPong = { autoPong: false } as ClientOptions;

const binaryTypes = [
  { binaryType: "nodebuffer", binary: "Buffer(0x010203)", empty: "Buffer()" },
  { binaryType: "arraybuffer", binary: "ArrayBuffer(0x010203)", empty: "ArrayBuffer()" },
  { binaryType: "fragments", binary: "[Buffer(0x010203)]", empty: "[]" },
  { binaryType: blob, binary: "Blob(3)", empty: "Blob(0)" },
] as const;

describe.each(implementations)("ws client, receiving ($name)", ({ ws: implementation, builtin, specifier }) => {
  // `binaryType` chooses the shape of a binary message and of nothing else.
  describe.each(binaryTypes)("binaryType $binaryType", ({ binaryType, binary, empty }) => {
    test(`a text message is a Buffer, a binary message ${binary}`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("hi");
      conn.binary(bytes(1, 2, 3));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, 'message Buffer("hi") text rs=1', `message ${binary} binary rs=1`]);
    });

    test(`an empty text message is an empty Buffer, an empty binary message ${empty}`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("");
      conn.binary("");
      conn.binary("", { fin: false });
      conn.send(OP.continuation, "");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        "message Buffer() text rs=1",
        `message ${empty} binary rs=1`,
        `message ${empty} binary rs=1`,
      ]);
    });

    test("the fragments of a text message are joined", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text("a", { fin: false });
      conn.send(OP.continuation, "b");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, 'message Buffer("ab") text rs=1']);
    });

    // In "fragments" mode npm ws gives one Buffer per frame, the built-in one Buffer.
    test.skipIf(binaryType === "fragments")("the fragments of a binary message are joined", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.binary(bytes(1), { fin: false });
      conn.send(OP.continuation, bytes(2), { fin: false });
      conn.send(OP.continuation, bytes(3));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, `message ${binary} binary rs=1`]);
    });

    test("compressed messages have the same shapes", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.text(compress("compressed-😶"), { rsv1: true });
      conn.binary(compress(bytes(1, 2, 3)), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        'message Buffer("compressed-😶") text rs=1',
        `message ${binary} binary rs=1`,
      ]);
    });

    test(`MessageEvent.data is a string for a text message, ${binary} for a binary one`, async () => {
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

    test("the payloads of 'ping' and 'pong' are Buffers", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.binaryType = binaryType;
      conn.ping("p");
      conn.pong("q");
      expect(await conn.roundTrip()).toEqual(['pong "p"']);
      expect(events).toEqual([...opening, 'ping Buffer("p") rs=1', 'pong Buffer("q") rs=1']);
    });
  });

  describe("messages", () => {
    test("a Blob has the bytes of the message and no type", async () => {
      await using client = await openClient(implementation);
      client.ws.binaryType = blob;
      client.conn.binary(bytes(1, 2, 3));
      const [data] = await event(client.ws, "message");
      expect(data).toBeInstanceOf(Blob);
      expect(data.type).toBe("");
      expect(Buffer.from(await data.arrayBuffer())).toEqual(bytes(1, 2, 3));
    });

    test("binaryType set in a 'message' listener applies to the next binary message of the same packet", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      const next = ["arraybuffer", blob, "nodebuffer"] as const;
      let changes = 0;
      ws.binaryType = "fragments";
      ws.on("message", (_, isBinary) => {
        if (isBinary && changes < next.length) ws.binaryType = next[changes++];
      });
      conn.write(
        Buffer.concat([1, 2, 3, 4].flatMap(n => [conn.frame(OP.text, "text " + n), conn.frame(OP.binary, bytes(n))])),
      );
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
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

    test("a text message is a Buffer however the listener was added", async () => {
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
      const first = once(ws, "message").then(([data, isBinary]) => listener("events.once")(data, isBinary));
      const both = (async () => {
        const push = listener("events.on");
        for await (const [data, isBinary] of on(ws, "message")) {
          push(data, isBinary);
          if (seen["events.on"].length === 2) break;
        }
      })();
      conn.text("1");
      conn.text("2");
      await Promise.all([first, both]);
      const one = ['Buffer("1") false'];
      const two = ['Buffer("1") false', 'Buffer("2") false'];
      expect(seen).toEqual({
        on: two,
        addListener: two,
        prependListener: two,
        once: one,
        prependOnceListener: one,
        "events.once": one,
        "events.on": two,
      });
    });

    test("text arrives byte for byte: a BOM and a NUL are kept", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.text(bytes(0xef, 0xbb, 0xbf, 0x68, 0x00, 0x69));
      for (const text of ["latin1-©", "bmp-€", "é😀"]) conn.text(text);
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        "message Buffer(0xefbbbf680069) text rs=1",
        'message Buffer("latin1-©") text rs=1',
        'message Buffer("bmp-€") text rs=1',
        'message Buffer("é😀") text rs=1',
      ]);
    });

    test("a character may be split over two fragments", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      const character = Buffer.from("😀");
      conn.text(character.subarray(0, 2), { fin: false });
      conn.send(OP.continuation, character.subarray(2));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, 'message Buffer("😀") text rs=1']);
    });

    test("a binary message does not have to be UTF-8", async () => {
      await using client = await openClient(implementation);
      client.conn.binary(bytes(0xff, 0xfe));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...opening, "message Buffer(0xfffe) binary rs=1"]);
    });

    // 125 is the last length that fits the second byte of the header, 65535 the last that fits 16 bits.
    test.each([125, 126, 65535, 65536])("a message of %d bytes", async length => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const seen: unknown[] = [];
      ws.on("message", (data, isBinary) => seen.push(data, isBinary));
      conn.binary(a(length));
      conn.text(a(length));
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual([a(length), true, a(length), false]);
    });

    test.each([
      { label: "a text frame", frame: encodeFrame(OP.text, "hé"), line: 'message Buffer("hé") text rs=1' },
      {
        label: "a frame with a 16-bit length",
        frame: encodeFrame(OP.binary, a(126)),
        line: "message Buffer(126 bytes) binary rs=1",
      },
      {
        label: "a frame with a 64-bit length",
        frame: encodeFrame(OP.binary, a(65536)),
        line: "message Buffer(65536 bytes) binary rs=1",
      },
      { label: "a Pong", frame: encodeFrame(OP.pong, "pp"), line: 'pong Buffer("pp") rs=1' },
    ])("$label that arrives in two pieces, cut after each of its first bytes", async ({ frame, line }) => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      const cuts = Math.min(frame.length, 12) - 1;
      for (let cut = 1; cut <= cuts; cut++) {
        // The Pong shows that the client has read the first piece before the second one is sent.
        conn.write(Buffer.concat([conn.frame(OP.ping, "cut"), frame.subarray(0, cut)]));
        expect(await conn.next()).toBe('pong "cut"');
        conn.write(frame.subarray(cut));
      }
      expect(await conn.roundTrip()).toEqual([]);
      expect(events.slice(2).filter(event => !event.startsWith("ping"))).toEqual(Array(cuts).fill(line));
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
    ])("a length may be written in more bytes than it needs: $label", async ({ sent, line }) => {
      await using client = await openClient(implementation);
      client.conn.write(sent);
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...opening, line]);
    });

    test("the messages of one packet arrive in order", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const names = Array.from({ length: 50 }, (_, i) => "m" + i);
      const seen: string[] = [];
      ws.on("message", data => seen.push(String(data)));
      conn.write(Buffer.concat(names.map(name => conn.frame(OP.text, name))));
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual(names);
    });

    test("writing to the Buffer of one message leaves the next one alone", async () => {
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

    // After the exception npm ws's receiver never reads on. Bun's goes on.
    test.concurrent.skipIf(!builtin)(
      "a 'message' listener that throws does not stop later messages",
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
      { payload: a(125), pong: "pong 125 bytes", event: "ping Buffer(125 bytes) rs=1" },
    ])("a Ping is answered with $pong", async ({ payload, pong, event }) => {
      await using client = await openClient(implementation);
      client.conn.ping(payload);
      const sent = (await client.conn.nextFrame())!;
      expect(showFrame(sent)).toBe(pong);
      expect(sent.payload).toEqual(Buffer.from(payload));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...opening, event]);
    });

    test("the Pong goes out before anything the 'ping' listener sends", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      client.ws.on("ping", () => client.ws.send("from the listener"));
      client.conn.ping("hello");
      expect(await client.conn.take(2)).toEqual(['pong "hello"', 'text "from the listener"']);
    });

    test("autoPong: false emits 'ping' and sends nothing", async () => {
      await using client = await openClient(implementation, noAutoPong);
      const { conn, events } = client;
      conn.ping("hello");
      conn.close(1000);
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, 'ping Buffer("hello") rs=1', "close 1000 Buffer() rs=3"]);
      expect(await conn.rest()).toEqual(["close 1000"]);
    });

    test("autoPong: false leaves the Pong to the 'ping' listener", async () => {
      await using client = await openClient(implementation, noAutoPong);
      const { ws, conn } = client;
      ws.on("ping", data => ws.pong(data));
      conn.ping("hello");
      conn.close(1000);
      expect(await conn.rest()).toEqual(['pong "hello"', "close 1000"]);
    });

    test("a Pong nobody asked for emits 'pong' and is not answered", async () => {
      await using client = await openClient(implementation);
      client.conn.pong("q");
      client.conn.pong();
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...opening, 'pong Buffer("q") rs=1', "pong Buffer() rs=1"]);
    });

    test("a Ping between two fragments is handled at once", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.text("a", { fin: false });
      conn.ping("mid");
      expect(await conn.next()).toBe('pong "mid"');
      expect(events).toEqual([...opening, 'ping Buffer("mid") rs=1']);
      conn.send(OP.continuation, "b");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events.slice(3)).toEqual(['message Buffer("ab") text rs=1']);
    });
  });

  describe("permessage-deflate", () => {
    test.each([
      { answer: "no extension", headers: [], extensions: "" },
      { answer: "permessage-deflate", headers: deflate.headers!, extensions: "permessage-deflate" },
      {
        answer: "permessage-deflate with parameters",
        headers: [
          "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_max_window_bits=10",
        ],
        extensions: "permessage-deflate",
      },
    ])("`extensions` when the server answers with $answer", async ({ headers, extensions }) => {
      await using client = await openClient(implementation, {}, { headers: [...headers] });
      expect(client.ws.extensions).toBe(extensions);
    });

    test("compressed and plain messages may alternate", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { conn, events } = client;
      conn.text("plain");
      conn.text(compress("compressed hello"), { rsv1: true });
      conn.text("plain again");
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        'message Buffer("plain") text rs=1',
        'message Buffer("compressed hello") text rs=1',
        'message Buffer("plain again") text rs=1',
      ]);
    });

    test("a compressed message in fragments, with a Ping between them", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { conn, events } = client;
      const payload = compress("fragmented and compressed");
      conn.text(payload.subarray(0, 5), { fin: false, rsv1: true });
      conn.ping("mid");
      conn.send(OP.continuation, payload.subarray(5, 9), { fin: false });
      conn.send(OP.continuation, payload.subarray(9));
      expect(await conn.roundTrip()).toEqual(['pong "mid"']);
      expect(events).toEqual([
        ...opening,
        'ping Buffer("mid") rs=1',
        'message Buffer("fragmented and compressed") text rs=1',
      ]);
    });

    test("an empty compressed message, with and without its empty block", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { conn, events } = client;
      expect(compress("")).toEqual(bytes(0));
      conn.text(compress(""), { rsv1: true });
      conn.text("", { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, "message Buffer() text rs=1", "message Buffer() text rs=1"]);
    });

    test("a message may refer back to the one before it", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { conn, events } = client;
      const text = "the same words again";
      // With the first message as the dictionary, the second one is what a compressor that keeps its window writes.
      const first = compress(text);
      const second = compress(text, { dictionary: Buffer.from(text) });
      expect(second.length).toBeLessThan(first.length / 2);
      conn.text(first, { rsv1: true });
      conn.text(second, { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        `message Buffer("${text}") text rs=1`,
        `message Buffer("${text}") text rs=1`,
      ]);
    });

    test("a message whose last block is marked final, then another message", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { conn, events } = client;
      conn.text(zlib.deflateRawSync("final block"), { rsv1: true });
      conn.text(compress("next"), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([
        ...opening,
        'message Buffer("final block") text rs=1',
        'message Buffer("next") text rs=1',
      ]);
    });
  });

  describe("maxPayload", () => {
    test("a message of exactly that size passes: in one frame, in fragments, inflated", async () => {
      await using client = await openClient(implementation, { maxPayload: 100 }, deflate);
      const { conn, events } = client;
      conn.binary(a(100));
      conn.binary(a(60), { fin: false });
      conn.send(OP.continuation, a(40));
      conn.binary(compress(a(100)), { rsv1: true });
      expect(await conn.roundTrip()).toEqual([]);
      const message = "message Buffer(100 bytes) binary rs=1";
      expect(events).toEqual([...opening, message, message, message]);
    });

    test("control frames do not count", async () => {
      await using client = await openClient(implementation, { maxPayload: 2 });
      client.conn.ping("hello");
      expect(await client.conn.roundTrip()).toEqual(['pong "hello"']);
      expect(client.events).toEqual([...opening, 'ping Buffer("hello") rs=1']);
    });

    test("0 is no limit", async () => {
      await using client = await openClient(implementation, { maxPayload: 0 });
      client.conn.binary(a(70000));
      expect(await client.conn.roundTrip()).toEqual([]);
      expect(client.events).toEqual([...opening, "message Buffer(70000 bytes) binary rs=1"]);
    });
  });

  describe("skipUTF8Validation", () => {
    test("a text message that is not UTF-8 is delivered as it is", async () => {
      await using client = await openClient(implementation, { skipUTF8Validation: true });
      const { ws, conn, events } = client;
      const data: unknown[] = [];
      ws.onmessage = event => data.push(event.data);
      conn.text(bytes(0x61, 0xff));
      expect(await conn.roundTrip()).toEqual([]);
      expect(events).toEqual([...opening, "message Buffer(0x61ff) text rs=1"]);
      expect(data).toEqual(["a\ufffd"]);

      conn.close(1000);
      expect(await conn.rest()).toEqual(["close 1000"]);
    });
  });

  describe("protocol errors", () => {
    // What 'error' gets, and the Close frame that tells the peer.
    const invalid = (text: string, code: string) => ({
      error: `RangeError "Invalid WebSocket frame: ${text}" ${code}`,
      close: "close 1002",
    });
    const opcode = (value: number) => invalid(`invalid opcode ${value}`, "WS_ERR_INVALID_OPCODE");
    const masked = invalid("MASK must be clear", "WS_ERR_UNEXPECTED_MASK");
    const rsv1 = invalid("RSV1 must be clear", "WS_ERR_UNEXPECTED_RSV_1");
    const rsv23 = invalid("RSV2 and RSV3 must be clear", "WS_ERR_UNEXPECTED_RSV_2_3");
    const noFin = invalid("FIN must be set", "WS_ERR_EXPECTED_FIN");
    const length = (value: number) =>
      invalid(`invalid payload length ${value}`, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
    const status = (value: number) => invalid(`invalid status code ${value}`, "WS_ERR_INVALID_CLOSE_CODE");
    const utf8 = {
      error: 'Error "Invalid WebSocket frame: invalid UTF-8 sequence" WS_ERR_INVALID_UTF8',
      close: "close 1007",
    };
    const tooBig = {
      error: 'RangeError "Max payload size exceeded" WS_ERR_UNSUPPORTED_MESSAGE_LENGTH',
      close: "close 1009",
    };
    const over53Bits = {
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
      { label: "opcode 3", sent: [frame(3, "x")], ...opcode(3) },
      { label: "opcode 11", sent: [frame(11, "x")], ...opcode(11) },
      { label: "a continuation frame with nothing to continue", sent: [continuation("x")], ...opcode(0) },
      { label: "a new message inside a fragmented one", sent: [text("a", { fin: false }), text("b")], ...opcode(1) },
      { label: "a masked frame", sent: [text("hi", { mask: true })], ...masked },
      { label: "RSV1 when the server did not accept permessage-deflate", sent: [text("hi", { rsv1: true })], ...rsv1 },
      {
        label: "RSV1 with perMessageDeflate: false",
        sent: [text("hi", { rsv1: true })],
        options: { perMessageDeflate: false },
        ...rsv1,
      },
      {
        label: "RSV1 on a continuation frame",
        sent: [text(compress("ab"), { fin: false, rsv1: true }), continuation("x", { rsv1: true })],
        peer: deflate,
        ...rsv1,
      },
      { label: "RSV1 on a Ping", sent: [frame(OP.ping, "x", { rsv1: true })], peer: deflate, ...rsv1 },
      { label: "RSV2", sent: [text("hi", { rsv2: true })], ...rsv23 },
      { label: "RSV3", sent: [text("hi", { rsv3: true })], ...rsv23 },
      { label: "a fragmented Ping", sent: [frame(OP.ping, "x", { fin: false })], ...noFin },
      { label: "a fragmented Close frame", sent: [frame(OP.close, closePayload(1000), { fin: false })], ...noFin },
      { label: "a Ping of 126 bytes", sent: [frame(OP.ping, a(126))], ...length(126) },
      { label: "a Pong of 126 bytes", sent: [frame(OP.pong, a(126))], ...length(126) },
      { label: "a Close frame of 126 bytes", sent: [frame(OP.close, closePayload(1000, a(124)))], ...length(126) },
      { label: "a Close frame of one byte", sent: [frame(OP.close, bytes(3))], ...length(1) },
      ...[0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535].map(code => ({
        label: `a Close frame with the code ${code}`,
        sent: [frame(OP.close, closePayload(code))],
        ...status(code),
      })),

      {
        label: "a Close frame whose reason is not UTF-8",
        sent: [frame(OP.close, closePayload(1000, bytes(0xff)))],
        ...utf8,
      },
      { label: "a text message that is not UTF-8", sent: [text(bytes(0xff, 0xfe))], ...utf8 },
      { label: "a text message that ends inside a character", sent: [text(Buffer.from("😀").subarray(0, 3))], ...utf8 },
      { label: "a text message with a surrogate", sent: [text(bytes(0xed, 0xa0, 0x80))], ...utf8 },
      { label: "a text message with an overlong NUL", sent: [text(bytes(0xc0, 0x80))], ...utf8 },
      {
        label: "a text message whose second fragment is not UTF-8",
        sent: [text("a", { fin: false }), continuation(bytes(0xff))],
        ...utf8,
      },
      {
        label: "a compressed text message that is not UTF-8",
        sent: [text(compress(bytes(0xff, 0xfe)), { rsv1: true })],
        peer: deflate,
        ...utf8,
      },

      { label: "a message of maxPayload + 1 bytes", sent: [binary(a(101))], options: max100, ...tooBig },
      {
        label: "the header of a message over maxPayload, before any of its payload",
        sent: [binary(a(200)).subarray(0, 4)],
        options: max100,
        ...tooBig,
      },
      {
        label: "fragments that add up to more than maxPayload",
        sent: [binary(a(60), { fin: false }), continuation(a(60))],
        options: max100,
        ...tooBig,
      },
      {
        label: "a compressed message that inflates to more than maxPayload",
        sent: [binary(compress(a(200)), { rsv1: true })],
        options: max100,
        peer: deflate,
        ...tooBig,
      },
      // The default maxPayload is 100 MiB.
      { label: "a length of 256 MiB", sent: [bytes(0x82, 127, 0, 0, 0, 0, 0x10, 0, 0, 0)], ...tooBig },
      { label: "a length of 2^53", sent: [bytes(0x82, 127, 0, 0x20, 0, 0, 0, 0, 0, 0)], ...over53Bits },
      {
        label: "a length of 2^64 - 1",
        sent: [bytes(0x82, 127, 255, 255, 255, 255, 255, 255, 255, 255)],
        ...over53Bits,
      },
    ];

    test.each(rows)("$label: 'error', $close and FIN, 'close' 1006", async ({ sent, error, close, options, peer }) => {
      await using client = await openClient(implementation, options, peer);
      const { conn, events } = client;
      conn.write(Buffer.concat(sent));
      expect(await conn.rest()).toEqual([close]);
      expect(conn.tcp).toEqual(["end"]);
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, `error ${error} rs=2`, lost]);
    });

    // npm ws passes zlib's own error on ("invalid block type"), so the text is not compared.
    test("a compressed message that does not inflate: 'error' Z_DATA_ERROR, close 1007 and FIN, 'close' 1006", async () => {
      await using client = await openClient(implementation, {}, deflate);
      const { ws, conn, events } = client;
      const failed = event(ws, "error");
      conn.text(bytes(0xff, 0xff, 0xff, 0xff, 0xff), { rsv1: true });
      const [error] = await failed;
      expect({ class: error.constructor.name, code: error.code }).toEqual({ class: "Error", code: "Z_DATA_ERROR" });
      expect(await conn.rest()).toEqual(["close 1007"]);
      expect(conn.tcp).toEqual(["end"]);
      conn.end();
      await client.closed;
      expect(events).toHaveLength(4);
      expect(events[3]).toBe(lost);
    });

    test("after the 'error' the socket is CLOSING, and 'close' waits for the server's FIN", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      conn.send(3, "x");
      await conn.ended;
      expect(ws.readyState).toBe(implementation.CLOSING);
      expect(events).toEqual([...opening, `error ${opcode(3).error} rs=2`]);
      conn.end();
      await client.closed;
      expect(events.slice(3)).toEqual([lost]);
    });

    // `closeTimeout` is an option of ws 8.19 and later. The package in node_modules has a constant 30 s.
    test.skipIf(!builtin)("after the 'error', a server that never ends the connection: `closeTimeout`", async () => {
      await using client = await openClient(implementation, { closeTimeout: 50 } as {});
      const { conn, events } = client;
      conn.send(3, "x");
      await client.closed;
      expect(events).toEqual([...opening, `error ${opcode(3).error} rs=2`, lost]);
      expect(await conn.rest()).toEqual(["close 1002"]);
    });

    test("the error has the status code of the Close frame under Symbol(status-code)", async () => {
      await using client = await openClient(implementation);
      client.conn.send(3, "x");
      const [error] = await event(client.ws, "error");
      expect(error).toBeInstanceOf(RangeError);
      expect(error.name).toBe("RangeError");
      expect(Object.keys(error)).toEqual(["code"]);
      expect(Object.getOwnPropertySymbols(error).map(symbol => `${String(symbol)} ${error[symbol]}`)).toEqual([
        "Symbol(status-code) 1002",
      ]);
    });

    test("what came before the bad frame is delivered, what comes after it is not read", async () => {
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
      expect(await conn.rest()).toEqual(["close 1002"]);
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, 'message Buffer("before") text rs=1', `error ${opcode(3).error} rs=2`, lost]);
    });

    test("the peer's answer to the Close frame is not read either: 'close' is 1006", async () => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.send(3, "x");
      expect(await conn.rest()).toEqual(["close 1002"]);
      conn.close(1002, "echo");
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, `error ${opcode(3).error} rs=2`, lost]);
    });

    test("a bad frame after close(): 'error', no second Close frame, FIN, 'close' 1006", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.close(1000);
      expect(await conn.next()).toBe("close 1000");
      conn.send(3, "x");
      expect(await conn.rest()).toEqual([]);
      expect(conn.tcp).toEqual(["end"]);
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, `error ${opcode(3).error} rs=2`, lost]);
    });
  });
});
