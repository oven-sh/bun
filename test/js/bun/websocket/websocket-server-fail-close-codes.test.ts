// RFC 6455 7.1.7: before failing the connection, the server sends a Close frame
// with 1002 (protocol error), 1007 (invalid data) or 1009 (too big) and the
// error message as the reason. The close handler gets 1006 with the same
// message. A peer can't send 1006, so it always means the server aborted.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as cert, isASAN } from "harness";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  closePayload,
  encodeFrame,
  type FrameOptions,
  OP,
  type Payload,
  RawClient,
  showFullFrame,
} from "../../web/websocket/raw-peer";

// Builds a client frame.
function frame(opcode: number, payload?: Payload, options?: FrameOptions): Buffer {
  return encodeFrame(opcode, payload, { mask: true, ...options });
}

describe.concurrent.each(["ws", "wss"] as const)("%s: failing the connection", scheme => {
  // Upgrades over a raw socket, writes `bytes` in one write, and reads until the server's FIN ("end").
  // The server echoes every message.
  async function probe(bytes: Buffer, options: { maxPayloadLength?: number } = {}) {
    const events: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(scheme === "wss" ? { tls: cert } : {}),
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        maxPayloadLength: options.maxPayloadLength ?? 1024,
        message(ws, message) {
          events.push(`message ${JSON.stringify(message.toString())}`);
          ws.send(message);
        },
        close(ws, code, reason) {
          events.push(`close ${code} ${JSON.stringify(reason)}`);
          serverClosed.resolve();
        },
      },
    });

    using client = await RawClient.upgrade(server.port!, { secure: scheme === "wss" });
    client.write(bytes);
    await client.ended;
    await serverClosed.promise;
    expect(client.unparsedBytes).toBe(0);
    return { wire: [...client.frames.map(showFullFrame), client.socketEvents[0]], events };
  }

  function failed(code: number, diagnostic: string) {
    return {
      wire: [`close ${code} ${JSON.stringify(diagnostic)}`, "end"],
      events: [`close 1006 ${JSON.stringify(diagnostic)}`],
    };
  }

  const interleaved = "Received new message inside a fragmented message";
  const violations: [name: string, bytes: Buffer, code: number, diagnostic: string][] = [
    ["an unmasked frame", frame(OP.text, "hi", { mask: false }), 1002, "Received an incorrectly masked frame"],
    ["RSV1 without permessage-deflate", frame(OP.text, "hi", { rsv1: true }), 1002, "Received unexpected RSV1 bit"],
    ["RSV2", frame(OP.text, "hi", { rsv2: true }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["RSV3 on a ping", frame(OP.ping, "hi", { rsv3: true }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["opcode 3", frame(3), 1002, "Received invalid opcode"],
    ["opcode 7", frame(7, "hi"), 1002, "Received invalid opcode"],
    ["opcode 11", frame(11), 1002, "Received invalid opcode"],
    ["opcode 15", frame(15, "hi"), 1002, "Received invalid opcode"],
    ["a ping without FIN", frame(OP.ping, "hi", { fin: false }), 1002, "Received fragmented control frame"],
    [
      "a Close without FIN",
      frame(OP.close, closePayload(1000), { fin: false }),
      1002,
      "Received fragmented control frame",
    ],
    ["a 126-byte ping", frame(OP.ping, Buffer.alloc(126, "a")), 1002, "Received too big control frame"],
    [
      "a 126-byte Close",
      frame(OP.close, closePayload(1000, Buffer.alloc(124, "a").toString())),
      1002,
      "Received too big control frame",
    ],
    [
      "a continuation frame outside a fragmented message",
      frame(OP.continuation, "hi"),
      1002,
      "Received continuation frame outside a fragmented message",
    ],
    [
      "TEXT inside a fragmented TEXT",
      Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.text, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented BINARY",
      Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.binary, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented TEXT",
      Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.binary, "b")]),
      1002,
      interleaved,
    ],
    [
      "TEXT inside a fragmented BINARY",
      Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.text, "b")]),
      1002,
      interleaved,
    ],
    ["invalid UTF-8 in a TEXT frame", frame(OP.text, Buffer.from([0xff, 0xfe, 0xfd])), 1007, "Received invalid UTF-8"],
    [
      "invalid UTF-8 across fragments",
      Buffer.concat([
        frame(OP.text, Buffer.from([0xf4, 0x90]), { fin: false }),
        frame(OP.continuation, Buffer.from([0x80, 0x80])),
      ]),
      1007,
      "Received invalid UTF-8",
    ],
    ["a frame over maxPayloadLength", frame(OP.binary, Buffer.alloc(1025)), 1009, "Received too big message"],
    [
      "a frame header declaring 1 GiB",
      frame(OP.binary, "", { declaredLength: 1024 * 1024 * 1024 }),
      1009,
      "Received too big message",
    ],
    [
      "fragments totaling more than maxPayloadLength",
      Buffer.concat([frame(OP.binary, Buffer.alloc(600), { fin: false }), frame(OP.continuation, Buffer.alloc(600))]),
      1009,
      "Received too big message",
    ],
    ["a Close with a 1-byte body", frame(OP.close, Buffer.from([0x03])), 1002, "Received invalid close payload"],
    ...[999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535].map(
      code =>
        [`a Close with code ${code}`, frame(OP.close, closePayload(code)), 1002, "Received invalid close code"] as [
          string,
          Buffer,
          number,
          string,
        ],
    ),
    [
      "a Close with invalid UTF-8 in the reason",
      frame(OP.close, closePayload(1000, Buffer.from([0xff, 0xfe]))),
      1007,
      "Received invalid UTF-8",
    ],
  ];

  // Sent after each invalid frame. A server that wrongly accepts the frame echoes this Close
  // instead of leaving the test hanging.
  const normalClose = frame(OP.close, closePayload(1000));

  test.each(violations)("rejects %s", async (_name, bytes, code, diagnostic) => {
    expect(await probe(Buffer.concat([bytes, normalClose]))).toEqual(failed(code, diagnostic));
  });

  test("rejects a new message after a ping inside a fragmented message", async () => {
    expect(
      await probe(
        Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.ping, "p"), frame(OP.binary, "b"), normalClose]),
      ),
    ).toEqual({
      wire: ['pong "p"', `close 1002 ${JSON.stringify(interleaved)}`, "end"],
      events: [`close 1006 ${JSON.stringify(interleaved)}`],
    });
  });

  test("replies to an earlier valid frame in the same read before sending the Close frame", async () => {
    expect(
      await probe(Buffer.concat([frame(OP.text, "Hello"), frame(OP.text, "hi", { rsv2: true }), frame(OP.ping)])),
    ).toEqual({
      wire: ['text "Hello"', 'close 1002 "Received unexpected RSV2 or RSV3 bit"', "end"],
      events: ['message "Hello"', 'close 1006 "Received unexpected RSV2 or RSV3 bit"'],
    });
  });

  describe("accepts valid frames", () => {
    test("a message, then Close 1000", async () => {
      expect(await probe(Buffer.concat([frame(OP.text, "ok"), frame(OP.close, closePayload(1000, "bye"))]))).toEqual({
        wire: ['text "ok"', 'close 1000 "bye"', "end"],
        events: ['message "ok"', 'close 1000 "bye"'],
      });
    });

    test("a ping inside a fragmented message", async () => {
      expect(
        await probe(
          Buffer.concat([
            frame(OP.binary, "he", { fin: false }),
            frame(OP.ping, "p"),
            frame(OP.continuation, "llo"),
            frame(OP.close, closePayload(1000)),
          ]),
        ),
      ).toEqual({
        wire: ['pong "p"', 'binary "hello"', "close 1000", "end"],
        events: ['message "hello"', 'close 1000 ""'],
      });
    });

    // maxPayloadLength only applies to messages. RFC 6455 5.5 caps control frames at 125 bytes.
    test("a ping and a Close longer than maxPayloadLength", async () => {
      const payload = Buffer.alloc(100, "p").toString();
      expect(
        await probe(
          Buffer.concat([
            frame(OP.ping, payload),
            frame(OP.text, "1234"),
            frame(OP.close, closePayload(1000, "goodbye")),
          ]),
          {
            maxPayloadLength: 4,
          },
        ),
      ).toEqual({
        wire: [`pong "${payload}"`, 'text "1234"', 'close 1000 "goodbye"', "end"],
        events: ['message "1234"', 'close 1000 "goodbye"'],
      });
    });

    test("echoes an empty Close as an empty Close", async () => {
      expect(await probe(frame(OP.close))).toEqual({ wire: ["close", "end"], events: ['close 1005 ""'] });
    });

    test.each([1000, 1001, 1003, 1007, 1014, 3000, 4999])("echoes Close %d", async code => {
      expect(await probe(frame(OP.close, closePayload(code, "why")))).toEqual({
        wire: [`close ${code} "why"`, "end"],
        events: [`close ${code} "why"`],
      });
    });
  });
});

// ASAN's per-allocation cap makes each allocation failure deterministic. `Malloc=1` routes WebKit's
// allocations through the same capped allocator, which the text case needs.
describe.skipIf(!isASAN)("when a receive buffer can't grow", () => {
  const MiB = 1024 * 1024;
  const CAP_MB = 4;
  const diagnostic = "Received message that does not fit in memory";
  const failed = `close 1011 ${JSON.stringify(diagnostic)}`;
  const deflate = { "Sec-WebSocket-Extensions": "permessage-deflate" };
  const deflated = (size: number) => deflateRawSync(Buffer.alloc(size, 7));
  const tooBig = Buffer.alloc(CAP_MB * MiB + 2 * MiB);
  // Fills a buffer to exactly the cap, so appending one more byte has to grow it past the cap.
  const full = Buffer.alloc(CAP_MB * MiB);
  // For messages that are delivered. The fixture replies with a hash of what its handler received, and the
  // 37-byte period isn't a power of two, so a growth that loses or moves bytes changes the reply.
  const patterned = (size: number) => Buffer.alloc(size, "0123456789abcdefghijklmnopqrstuvwxyz+");
  const got = (message: Buffer) => `text "got ${message.length} ${Bun.hash(message)}"`;
  const intact = patterned(2 * MiB);
  // What the `error` handler receives when the message handler's copy can't be allocated.
  const copyFailed = { error: "RangeError", message: "Out of memory" };

  type Mode = "ws" | "wss" | "ws-package";
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  let lines: AsyncGenerator<any>;
  let stderr: Promise<string>;
  let ports: Record<Mode, number>;

  async function* jsonLines(stream: ReadableStream<Uint8Array>) {
    let pending = "";
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      for (let end; (end = pending.indexOf("\n")) !== -1; pending = pending.slice(end + 1)) {
        yield JSON.parse(pending.slice(0, end));
      }
    }
  }

  // Returns the fixture's next output line. It prints one per close handler call, one per `error` handler call
  // and one per `ws` 'error' event.
  async function nextEvent() {
    const { value, done } = await lines.next();
    if (done) throw new Error(`the server exited:\n${await stderr}`);
    return value;
  }

  const connect = (mode: Mode, headers?: Record<string, string>) =>
    RawClient.upgrade(ports[mode], { headers, secure: mode === "wss" });

  // All rows share one server process, because it has to keep serving after it rejects a message.
  beforeAll(async () => {
    proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "websocket-server-oom-fixture.ts")],
      env: {
        ...bunEnv,
        Malloc: "1",
        WS_OOM_TLS: JSON.stringify(cert),
        // With `Malloc=1`, LeakSanitizer would report WebKit's never-freed startup allocations.
        ASAN_OPTIONS: [
          bunEnv.ASAN_OPTIONS,
          "allocator_may_return_null=1",
          `max_allocation_size_mb=${CAP_MB}`,
          "detect_leaks=0",
        ]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      // ASAN prints a warning for every failed allocation. stderr is drained and only shown if the server dies.
      stderr: "pipe",
    });
    stderr = proc.stderr.text();
    lines = jsonLines(proc.stdout);
    ports = await nextEvent();
  }, 30_000);
  afterAll(() => proc?.kill());

  const rejected: [name: string, headers: Record<string, string> | undefined, send: (client: RawClient) => void][] = [
    // Fails to grow the fragment buffer.
    ["a message larger than the cap", undefined, client => client.binary(tooBig)],
    [
      "a fragmented message larger than the cap",
      undefined,
      client => {
        client.binary(Buffer.alloc(3 * MiB), { fin: false });
        client.send(OP.continuation, Buffer.alloc(3 * MiB));
      },
    ],
    // The fragment buffer also stores inflate's 9 bytes of padding and control frames split across reads.
    ["a compressed message with no room left for its padding", deflate, client => client.binary(full, { rsv1: true })],
    [
      "a split control frame after a fragment that fills the buffer",
      undefined,
      client => {
        client.binary(full, { fin: false });
        client.write(client.frame(OP.ping, Buffer.alloc(100)).subarray(0, 50));
      },
    ],
    // Fails to grow the inflate buffer, which all connections on the loop share.
    [
      "a compressed message that inflates past the cap",
      deflate,
      client => client.binary(deflated(tooBig.length), { rsv1: true }),
    ],
    [
      "a compressed message whose last inflated chunk doesn't fit",
      deflate,
      client => client.binary(deflated(full.length + 1024), { rsv1: true }),
    ],
  ];

  // Fails to allocate the message handler's copy. One non-ASCII character makes the string 16-bit. An 8-bit
  // string of exactly the cap is over it by the string's header.
  const copyRejected: [name: string, send: (client: RawClient) => void][] = [
    [
      "a text message whose UTF-16 copy is over the cap",
      client => client.text("\u00e9" + Buffer.alloc(3 * MiB - 2, "a").toString("latin1")),
    ],
    [
      "a text message whose 8-bit copy is over the cap",
      client => client.text(Buffer.alloc(full.length, "a").toString("latin1")),
    ],
  ];

  // Checks that the server still accepts connections and the shared inflate buffer still works.
  async function expectStillServing(scheme: "ws" | "wss") {
    using client = await connect(scheme, deflate);
    client.binary(intact);
    client.binary(deflateRawSync(intact), { rsv1: true });
    client.close(1000);
    expect(await client.remainingFrames()).toEqual([got(intact), got(intact), "close 1000"]);
    expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
  }

  describe.each(["ws", "wss"] as const)("%s", scheme => {
    test.each(rejected)("%s fails that connection with 1011", async (_name, headers, send) => {
      using client = await connect(scheme, headers);
      send(client);
      expect(await client.remainingFrames()).toEqual([failed]);
      expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
      await expectStillServing(scheme);
    });

    // The `error` handler is called with the failed copy before the connection is closed.
    test.each(copyRejected)("%s fails that connection with 1011", async (_name, send) => {
      using client = await connect(scheme);
      send(client);
      expect(await client.remainingFrames()).toEqual([failed]);
      expect([await nextEvent(), await nextEvent()]).toEqual([copyFailed, { close: 1006, reason: diagnostic }]);
      await expectStillServing(scheme);
    });
  });

  // Appending 1 MiB to 2.5 MiB first tries to double to 5 MiB, which fails, then falls back to exactly 3.5 MiB.
  test("delivers a message when only an exact-size allocation succeeds", async () => {
    using client = await connect("ws");
    const message = patterned(3.5 * MiB);
    client.binary(message.subarray(0, 2.5 * MiB), { fin: false });
    client.send(OP.continuation, message.subarray(2.5 * MiB));
    client.close(1000);
    expect(await client.remainingFrames()).toEqual([got(message), "close 1000"]);
    expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
  });

  // A buffered compressed message gets 9 bytes of padding appended before it is inflated in place.
  test("delivers a buffered compressed message", async () => {
    using client = await connect("ws", deflate);
    const message = patterned(3 * MiB);
    client.binary(deflateRawSync(message, { level: 0 }), { rsv1: true });
    client.close(1000);
    expect(await client.remainingFrames()).toEqual([got(message), "close 1000"]);
    expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
  });

  // The ping is stored after the first fragment until its second half arrives, then removed again, and the
  // message continues in the same buffer.
  test("delivers a fragmented message intact around a ping that arrives in two reads", async () => {
    using client = await connect("ws");
    using other = await connect("ws");
    const message = patterned(MiB);
    const ping = client.frame(OP.ping, "0123456789");
    client.binary(message.subarray(0, MiB / 2), { fin: false });
    client.write(ping.subarray(0, 10));
    // After two round trips on another connection, the server has read the first half.
    expect([await other.roundTrip(), await other.roundTrip()]).toEqual([[], []]);
    client.write(ping.subarray(10));
    client.send(OP.continuation, message.subarray(MiB / 2));
    client.close(1000);
    expect(await client.remainingFrames()).toEqual(['pong "0123456789"', got(message), "close 1000"]);
    expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
    other.close(1000);
    expect(await other.remainingFrames()).toEqual(["close 1000"]);
    expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
  });

  // Nothing is unsent yet, so the Close frame is queued and goes out once the socket is writable.
  test.skipIf(!fault.available())("still sends the Close frame to a socket that can't write yet", async () => {
    using client = await connect("ws");
    client.text("hold");
    client.binary(tooBig);
    expect(await client.remainingFrames()).toEqual([failed]);
    expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
    await expectStillServing("ws");
  });

  // A Close frame would be queued behind the 3 MiB, in a buffer that would have to grow for it.
  test.skipIf(!fault.available())("closes the connection without a Close frame when data is still unsent", async () => {
    using client = await connect("ws");
    client.text("stall");
    client.binary(tooBig);
    expect(await client.remainingFrames()).toEqual([]);
    expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
    await expectStillServing("ws");
  });

  // The close is the same one that follows a Close frame: the server ends its side and reads until the peer ends
  // too. A socket that is closed with input unread, or with TLS data the kernel hasn't taken, is reset instead,
  // and the peer loses what the kernel had accepted.
  describe.each(["ws", "wss"] as const)("%s: a paused peer of a socket with unsent data", scheme => {
    const rejections: [name: string, send: (client: RawClient) => void][] = [
      ["was read in full", client => client.binary(deflated(tooBig.length), { rsv1: true })],
      ["is still partly unread", client => client.binary(tooBig)],
    ];

    test.skipIf(!fault.available()).each(rejections)(
      "receives the frames the kernel accepted and then FIN, if the rejected message %s",
      async (_name, send) => {
        using client = await connect(scheme, deflate);
        client.socket.pause();
        client.text("flood");
        const { flooded } = await nextEvent();
        expect(flooded).toBeGreaterThan(0);
        send(client);
        expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
        client.socket.resume();
        const frames = await client.remainingFrames();
        await client.closed;
        expect({ frames: frames.length, socketEvents: client.socketEvents }).toEqual({
          frames: flooded,
          socketEvents: ["end", "close"],
        });
        await expectStillServing(scheme);
      },
    );
  });

  // Failing the connection unsubscribes the socket without writing its queued publishes. Every socket in the
  // fixture subscribes to one topic, and a "publish" message publishes to it.
  describe("a socket with a queued publish", () => {
    // Both frames go out in one write, so the publish is still queued when the second frame is rejected.
    const publishThenRejected = (client: RawClient) =>
      client.write(
        Buffer.concat([
          client.frame(OP.text, "publish"),
          client.frame(OP.binary, deflated(tooBig.length), { rsv1: true }),
        ]),
      );

    // The other subscriber received that publish, and the topic still works for the next one.
    async function expectTopicIntact(bystander: RawClient) {
      bystander.text("publish");
      bystander.close(1000);
      expect(await bystander.remainingFrames()).toEqual(['text "published"', 'text "published"', "close 1000"]);
      expect(await nextEvent()).toEqual({ close: 1000, reason: "" });
    }

    test("gets the 1011 without the publish", async () => {
      using bystander = await connect("ws");
      using victim = await connect("ws", deflate);
      publishThenRejected(victim);
      expect(await victim.remainingFrames()).toEqual([failed]);
      expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
      await expectTopicIntact(bystander);
    });

    test.skipIf(!fault.available())("is also unsubscribed when data is still unsent", async () => {
      using bystander = await connect("ws");
      using victim = await connect("ws", deflate);
      victim.text("stall");
      publishThenRejected(victim);
      expect(await victim.remainingFrames()).toEqual([]);
      expect(await nextEvent()).toEqual({ close: 1006, reason: diagnostic });
      await expectTopicIntact(bystander);
    });
  });

  // The `ws` package's server sockets use the same parser, but report the failure as an 'error' event.
  describe("the ws package", () => {
    const error = { error: "RangeError", message: "Failed to allocate memory", code: "ERR_MEMORY_ALLOCATION_FAILED" };
    const hi = Buffer.from("hi");

    async function expectStillServing() {
      using client = await connect("ws-package");
      client.text(hi);
      client.close(1000);
      expect(await client.remainingFrames()).toEqual([got(hi), "close 1000"]);
      expect(await nextEvent()).toEqual({ close: 1000 });
    }

    test("emits 'error' and sends 1011", async () => {
      using client = await connect("ws-package");
      client.binary(tooBig);
      expect(await client.remainingFrames()).toEqual(["close 1011"]);
      expect([await nextEvent(), await nextEvent()]).toEqual([error, { close: 1006 }]);
      await expectStillServing();
    });

    test.skipIf(!fault.available())("also emits 'error' when data is still unsent", async () => {
      using client = await connect("ws-package");
      client.text("stall");
      client.binary(tooBig);
      expect(await client.remainingFrames()).toEqual([]);
      expect([await nextEvent(), await nextEvent()]).toEqual([error, { close: 1006 }]);
      await expectStillServing();
    });
  });
});
