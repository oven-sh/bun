// Tests RFC 7692 negotiation and the dedicated compressor sizes of Bun.serve's
// `perMessageDeflate`. The client is a raw TCP socket that does its own framing.
import { serve } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import path from "node:path";
import { constants, createInflateRaw, deflateRawSync, inflateRawSync } from "node:zlib";
import { type Frame, RawClient } from "../../web/websocket/raw-peer";

type Compress = "shared" | "dedicated" | "3KB" | "32KB" | "256KB";

// Deterministic pseudo-random text: the same `n` always returns the same text.
// When it's sent twice, the second copy needs an LZ77 distance of `n` to back-reference the first.
function pseudoRandomText(n: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let state = 777;
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = alphabet.charCodeAt(state >>> 26);
  }
  return out.toString("latin1");
}

// Inflates one permessage-deflate payload with no prior context. Throws if the
// payload back-references an earlier message.
function inflateWithoutContext(payload: Buffer): Buffer {
  return inflateRawSync(Buffer.concat([payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]), {
    finishFlush: constants.Z_SYNC_FLUSH,
  });
}

// Inflates one payload and reports whether the deflate stream ended. Only a BFINAL=1 block ends it.
function inflateAndCheckEnd(payload: Buffer): { text: string; ended: boolean } {
  const input = Buffer.concat([payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]);
  const { buffer, engine } = inflateRawSync(input, { finishFlush: constants.Z_SYNC_FLUSH, info: true });
  // zlib stops reading at the end of the stream, so it leaves the trailing bytes unread.
  return { text: buffer.toString(), ended: engine.bytesWritten < input.length };
}

interface Peer {
  extensions: string | undefined;
  // Asks the server to send pseudoRandomText(n) compressed and returns the frame.
  request(n: number): Promise<Frame>;
  // Same, but sends an already compressed request.
  requestCompressed(payload: Buffer): Promise<Frame>;
  // Asks the server to publish pseudoRandomText(n) compressed to every peer.
  publish(n: number): void;
  readFrame(): Promise<Frame>;
  close(): void;
}

// On the message "n" the server replies with pseudoRandomText(n), compressed.
// On "publish n" it publishes that text to every subscriber.
function startServer(perMessageDeflate: boolean | { compress: Compress; decompress: boolean | "dedicated" }) {
  const server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate,
      open(ws) {
        ws.subscribe("all");
      },
      message(ws, message) {
        const text = String(message);
        if (text.startsWith("publish ")) {
          server.publish("all", pseudoRandomText(Number(text.slice("publish ".length))), true);
          return;
        }
        ws.send(pseudoRandomText(Number(text)), true);
      },
    },
  });
  return server;
}

async function connect(server: ReturnType<typeof startServer>, offer: string): Promise<Peer> {
  const client = await RawClient.upgrade(server.port, { headers: { "Sec-WebSocket-Extensions": offer } });
  async function readFrame() {
    const frame = await client.nextFrame();
    if (!frame) throw new Error("the server closed the socket");
    return frame;
  }
  return {
    extensions: client.header("sec-websocket-extensions"),
    request(n) {
      client.text(String(n));
      return readFrame();
    },
    requestCompressed(payload) {
      client.text(payload, { rsv1: true });
      return readFrame();
    },
    publish(n) {
      client.text(`publish ${n}`);
    },
    readFrame,
    close: () => client.destroy(),
  };
}

// The second copy of an `n`-byte text only compresses well if the first copy is
// still in the compressor's window. That needs windowBits w where 2^w - 262 >= n.
async function secondCopySize(peer: Peer, n: number): Promise<number> {
  const first = await peer.request(n);
  expect(first.rsv).toBe(4);
  const second = await peer.request(n);
  expect(second.rsv).toBe(4);
  return second.payload.length;
}

describe.concurrent("Bun.serve perMessageDeflate", () => {
  describe("dedicated compressor sizes", () => {
    test.each([
      // [compress option, window header, n that fits in the window, n that doesn't]
      ["dedicated", undefined, 5000, 40000],
      ["256KB", undefined, 5000, 40000],
      ["32KB", "server_max_window_bits=12", 3000, 5000],
      ["3KB", "server_max_window_bits=9", 200, 300],
    ] as const)("compress: %p uses the window size it negotiates", async (compress, window, fits, tooFar) => {
      await using server = startServer({ compress, decompress: true });
      const peer = await connect(server, "permessage-deflate");
      try {
        expect(peer.extensions).toBe(
          ["permessage-deflate", "client_no_context_takeover", window].filter(Boolean).join("; "),
        );
        expect(await secondCopySize(peer, fits)).toBeLessThan(fits / 10);
        expect(await secondCopySize(peer, tooFar)).toBeGreaterThan(tooFar / 2);
      } finally {
        peer.close();
      }
    });

    test('compress: "3KB" keeps context takeover in both directions with a dedicated decompressor', async () => {
      await using server = startServer({ compress: "3KB", decompress: "dedicated" });
      const peer = await connect(server, "permessage-deflate");
      try {
        expect(peer.extensions).toBe("permessage-deflate; server_max_window_bits=9");
        // The server's Number() ignores the padding. It makes the second request long enough to be compressed as a
        // back-reference to the first. A preset dictionary primes the window the way the first request would.
        const request = Buffer.from("200".padStart(64, " \t\n\r"));
        const options = { finishFlush: constants.Z_SYNC_FLUSH };
        const first = deflateRawSync(request, options).subarray(0, -4);
        const second = deflateRawSync(request, { ...options, dictionary: request }).subarray(0, -4);
        expect(() => inflateWithoutContext(second)).toThrow("invalid distance too far back");

        const firstReply = await peer.requestCompressed(first);
        expect(inflateWithoutContext(firstReply.payload).toString()).toBe(pseudoRandomText(200));
        const secondReply = await peer.requestCompressed(second);
        expect(secondReply.rsv).toBe(4);
        expect(secondReply.payload.length).toBeLessThan(20);
      } finally {
        peer.close();
      }
    });
  });

  describe("negotiation with a dedicated compressor", () => {
    test("echoes and honors server_no_context_takeover", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_no_context_takeover");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_no_context_takeover");
        const first = await peer.request(600);
        const second = await peer.request(600);
        expect(inflateWithoutContext(first.payload).toString()).toBe(pseudoRandomText(600));
        expect(inflateWithoutContext(second.payload).toString()).toBe(pseudoRandomText(600));
      } finally {
        peer.close();
      }
    });

    test("echoes server_max_window_bits and shrinks the window", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=10");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_max_window_bits=10");
        expect(await secondCopySize(peer, 600)).toBeLessThan(60);
        expect(await secondCopySize(peer, 1000)).toBeGreaterThan(500);
      } finally {
        peer.close();
      }
    });

    // zlib can't deflate with an 8-bit window and uses 9 bits, but its matches never reach back more than 250 bytes.
    test("accepts server_max_window_bits=8 and sends messages that inflate with an 8-bit window", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=8");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_max_window_bits=8");
        const inflate = createInflateRaw({ windowBits: 8 });
        const inflated: Buffer[] = [];
        inflate.on("data", chunk => inflated.push(chunk));
        for (const size of [200, 200, 600, 5000]) {
          const frame = await peer.request(size);
          expect(frame.rsv).toBe(4);
          inflated.length = 0;
          inflate.write(frame.payload);
          inflate.write(Buffer.from([0x00, 0x00, 0xff, 0xff]));
          await new Promise<void>((resolve, reject) => {
            inflate.once("error", reject);
            inflate.flush(() => resolve());
          });
          expect(Buffer.concat(inflated).toString()).toBe(pseudoRandomText(size));
        }
      } finally {
        peer.close();
      }
    });

    test("echoes server_max_window_bits=15", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=15");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_max_window_bits=15");
      } finally {
        peer.close();
      }
    });

    test("ignores another extension's parameters after the comma", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; client_max_window_bits, x-other; foo=1");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover");
      } finally {
        peer.close();
      }
    });

    test.each([
      "server_max_window_bits=16",
      "server_max_window_bits",
      "server_max_window_bits=10; server_max_window_bits=12",
      "server_no_context_takeover; server_no_context_takeover",
      "server_no_context_takeover; server_max_window_bits=10",
      "client_max_window_bits=16",
      "client_max_window_bits=7",
      "client_max_window_bits=1",
      "client_max_window_bits=0",
      "client_max_window_bits=0; bogus",
      "server_max_window_bits=0",
      "client_no_context_takeover=1",
      "foo=1",
      "no_context_takeover",
    ])("declines the offer %p", async params => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, `permessage-deflate; ${params}`);
      try {
        expect(peer.extensions).toBeUndefined();
        const frame = await peer.request(600);
        expect(frame.rsv).toBe(0);
        expect(frame.payload.toString()).toBe(pseudoRandomText(600));
      } finally {
        peer.close();
      }
    });
  });

  describe("negotiation with the shared compressor", () => {
    test("echoes server_max_window_bits=15 alongside server_no_context_takeover", async () => {
      await using server = startServer(true);
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=15");
      try {
        expect(peer.extensions).toBe(
          "permessage-deflate; client_no_context_takeover; server_no_context_takeover; server_max_window_bits=15",
        );
        expect(inflateWithoutContext((await peer.request(5000)).payload).toString()).toBe(pseudoRandomText(5000));
      } finally {
        peer.close();
      }
    });

    test("declines a lower server_max_window_bits", async () => {
      await using server = startServer(true);
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=10");
      try {
        expect(peer.extensions).toBeUndefined();
      } finally {
        peer.close();
      }
    });
  });

  describe("multiple offers", () => {
    test.each([
      // [compress, offers, response]
      [
        "dedicated",
        "permessage-deflate; server_max_window_bits=8, permessage-deflate",
        "permessage-deflate; client_no_context_takeover; server_max_window_bits=8",
      ],
      [
        "dedicated",
        "permessage-deflate; bogus, permessage-deflate; server_max_window_bits=12",
        "permessage-deflate; client_no_context_takeover; server_max_window_bits=12",
      ],
      [
        "shared",
        "permessage-deflate; server_max_window_bits=10, permessage-deflate; client_max_window_bits",
        "permessage-deflate; client_no_context_takeover; server_no_context_takeover",
      ],
      [
        "dedicated",
        "x-other; foo=1, permessage-deflate; server_max_window_bits=11",
        "permessage-deflate; client_no_context_takeover; server_max_window_bits=11",
      ],
      // The first valid offer wins, not the last.
      [
        "dedicated",
        "permessage-deflate; server_max_window_bits=10, permessage-deflate",
        "permessage-deflate; client_no_context_takeover; server_max_window_bits=10",
      ],
    ] as const)("compress: %p accepts the first valid offer in %p", async (compress, offers, response) => {
      await using server = startServer({ compress, decompress: true });
      const peer = await connect(server, offers);
      try {
        expect(peer.extensions).toBe(response);
        const frame = await peer.request(600);
        expect(frame.rsv).toBe(4);
        expect(inflateWithoutContext(frame.payload).toString()).toBe(pseudoRandomText(600));
      } finally {
        peer.close();
      }
    });
  });

  test.each([
    // Same characters in a different order.
    "deflate-permessage",
    "permessage-deflate; takeover_context_no_server",
    "permessage-deflate; server_max_bits_window=10",
    "Permessage-Deflate",
    "permessage-deflate-x",
    "permessage-deflate; server_max_window_bits=010",
    "permessage-deflate; server_max_window_bits=1 0",
    "permessage-deflate; server_max_window_bits =10",
    "permessage-deflate; server_max_window_bits=",
    "permessage-deflate; client_max_window_bits=",
    "permessage-deflate;",
    "permessage-deflate; ; client_max_window_bits",
    // Old Safari's per-frame extension, which isn't permessage-deflate.
    "x-webkit-deflate-frame",
    "x-webkit-deflate-frame; no_context_takeover",
  ])("declines the offer %p", async offer => {
    await using server = startServer(true);
    const peer = await connect(server, offer);
    try {
      expect(peer.extensions).toBeUndefined();
      const frame = await peer.request(600);
      expect(frame.rsv).toBe(0);
      expect(frame.payload.toString()).toBe(pseudoRandomText(600));
    } finally {
      peer.close();
    }
  });

  test("accepts whitespace around separators and a quoted value", async () => {
    await using server = startServer({ compress: "dedicated", decompress: true });
    const peer = await connect(
      server,
      'x-other ,\tpermessage-deflate ;  server_max_window_bits="10" ; client_max_window_bits',
    );
    try {
      expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_max_window_bits=10");
    } finally {
      peer.close();
    }
  });

  // If a message ends in a BFINAL=1 block, Safari fails the connection on the next message.
  describe.each([true, { compress: "dedicated", decompress: true }] as const)(
    "perMessageDeflate: %j never sets BFINAL",
    perMessageDeflate => {
      test.each([1, 20, 600, 4000, 5000, 40000])("in a %d-byte message", async n => {
        await using server = startServer(perMessageDeflate);
        for (const send of [(peer: Peer) => peer.request(n), (peer: Peer) => (peer.publish(n), peer.readFrame())]) {
          // Use a new peer each time. inflateAndCheckEnd() has no context from earlier messages.
          const peer = await connect(server, "permessage-deflate");
          try {
            const frame = await send(peer);
            expect(frame.rsv).toBe(4);
            expect(inflateAndCheckEnd(frame.payload)).toEqual({ text: pseudoRandomText(n), ended: false });
          } finally {
            peer.close();
          }
        }
      });
    },
  );

  test("publish() compresses with each subscriber's own negotiated parameters", async () => {
    await using server = startServer({ compress: "dedicated", decompress: true });
    const peers: Peer[] = [];
    try {
      const withTakeover = await connect(server, "permessage-deflate");
      peers.push(withTakeover);
      const withoutTakeover = await connect(server, "permessage-deflate; server_no_context_takeover");
      peers.push(withoutTakeover);
      expect(withTakeover.extensions).toBe("permessage-deflate; client_no_context_takeover");
      expect(withoutTakeover.extensions).toBe(
        "permessage-deflate; client_no_context_takeover; server_no_context_takeover",
      );
      const text = pseudoRandomText(600);
      for (let i = 0; i < 2; i++) {
        withTakeover.publish(600);
        const [a, b] = await Promise.all([withTakeover.readFrame(), withoutTakeover.readFrame()]);
        expect(inflateWithoutContext(b.payload).toString()).toBe(text);
        if (i === 0) {
          expect(inflateWithoutContext(a.payload).toString()).toBe(text);
        } else {
          // The dedicated compressor back-references the first publish.
          expect(a.payload.length).toBeLessThan(60);
        }
      }
    } finally {
      for (const peer of peers) peer.close();
    }
  });
});

// See the fixture for how the race works. Only a sanitizer catches the out-of-bounds write.
// "mmap" is a plain Uint8Array over a MAP_SHARED region, so a SharedArrayBuffer isn't the only
// input another thread can modify.
describe.concurrent.each(["sab", "mmap"])("ws.send() of %s memory while another thread writes to it", mode => {
  test.skipIf(!isASAN)(
    "doesn't overrun the deflate buffer",
    async () => {
      using dir = tempDir("ws-deflate-race", { "bytes.bin": Buffer.alloc(4000) });
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "websocket-server-deflate-race-fixture.ts")],
        env: {
          ...bunEnv,
          MODE: mode,
          FILE: path.join(String(dir), "bytes.bin"),
          // symbolize=0: symbolizing a sanitizer report takes longer than the test timeout.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "done", stderr: "", exitCode: 0 });
    },
    // A debug ASAN build takes about 3s just to start the worker.
    20_000,
  );
});
