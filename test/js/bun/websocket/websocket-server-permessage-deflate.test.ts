// RFC 7692 negotiation and the dedicated compressor sizes of Bun.serve's
// `perMessageDeflate`, observed from a raw TCP peer that does its own framing.
import { serve } from "bun";
import { describe, expect, test } from "bun:test";
import net from "node:net";
import { constants, inflateRawSync } from "node:zlib";

type Compress = "shared" | "dedicated" | "3KB" | "32KB" | "256KB";

// Deterministic pseudo-random text. Two calls with the same `n` return the same
// text, and `n` is the LZ77 distance a second copy needs to back-reference the first.
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

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length > 125) throw new Error("the peer only sends short frames");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

// Inflates one permessage-deflate payload with no prior context. Throws when the
// payload back-references bytes of an earlier message.
function inflateFresh(payload: Buffer): Buffer {
  return inflateRawSync(Buffer.concat([payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]), {
    finishFlush: constants.Z_SYNC_FLUSH,
  });
}

interface Frame {
  rsv1: boolean;
  payload: Buffer;
}

interface Peer {
  extensions: string | undefined;
  // Asks the server to send pseudoRandomText(n) compressed, returns the frame.
  request(n: number): Promise<Frame>;
  // Asks the server to publish pseudoRandomText(n) compressed to every peer.
  publish(n: number): void;
  readFrame(): Promise<Frame>;
  close(): void;
}

// The server sends pseudoRandomText(n) (compressed) on the message "n", and
// publishes it to every subscriber on the message "publish n".
function startServer(perMessageDeflate: boolean | { compress: Compress; decompress: boolean }) {
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
  const socket = net.connect(server.port, "127.0.0.1");
  socket.setNoDelay(true);
  let buffer = Buffer.alloc(0);
  const waiters: { tryRead: () => unknown; resolve: (value: any) => void }[] = [];
  let failure: Error | undefined;
  const pump = () => {
    while (waiters.length) {
      if (failure) {
        waiters.shift()!.resolve(Promise.reject(failure));
        continue;
      }
      const value = waiters[0].tryRead();
      if (value === undefined) return;
      waiters.shift()!.resolve(value);
    }
  };
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  socket.on("close", () => {
    failure ??= new Error("the server closed the socket");
    pump();
  });
  socket.on("error", (error: Error) => {
    failure ??= error;
    pump();
  });
  const read = <T>(tryRead: () => T | undefined): Promise<T> =>
    new Promise<T>(resolve => {
      waiters.push({ tryRead, resolve });
      pump();
    });

  const readFrame = () =>
    read<Frame>(() => {
      if (buffer.length < 2) return;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (buffer.length < offset + length) return;
      const frame = { rsv1: (buffer[0] & 0x40) !== 0, payload: buffer.subarray(offset, offset + length) };
      buffer = buffer.subarray(offset + length);
      return frame;
    });

  socket.write(
    "GET / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      `Sec-WebSocket-Extensions: ${offer}\r\n\r\n`,
  );
  let head: string;
  try {
    head = await read<string>(() => {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = buffer.subarray(0, end).toString();
      buffer = buffer.subarray(end + 4);
      return head;
    });
    expect(head).toStartWith("HTTP/1.1 101");
  } catch (error) {
    socket.destroy();
    throw error;
  }
  const extensions = head
    .split("\r\n")
    .find(line => line.toLowerCase().startsWith("sec-websocket-extensions:"))
    ?.slice("sec-websocket-extensions:".length)
    .trim();

  return {
    extensions,
    async request(n) {
      socket.write(maskedTextFrame(String(n)));
      return await readFrame();
    },
    publish(n) {
      socket.write(maskedTextFrame(`publish ${n}`));
    },
    readFrame,
    close: () => socket.destroy(),
  };
}

// The second copy of an `n` byte text only compresses well when the compressor
// kept the first copy in its window, which needs windowBits w with 2^w - 262 >= n.
async function secondCopySize(peer: Peer, n: number): Promise<number> {
  const first = await peer.request(n);
  expect(first.rsv1).toBe(true);
  const second = await peer.request(n);
  expect(second.rsv1).toBe(true);
  return second.payload.length;
}

describe.concurrent("Bun.serve perMessageDeflate", () => {
  describe("dedicated compressor sizes", () => {
    test.each([
      // [compress option, window header, n that fits the window, n that does not]
      ["dedicated", undefined, 5000, 40000],
      ["256KB", undefined, 5000, 40000],
      ["32KB", "server_max_window_bits=12", 3000, 5000],
      ["3KB", "server_max_window_bits=9", 200, 300],
    ] as const)("compress: %p uses the window it announces", async (compress, window, fits, tooFar) => {
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
  });

  describe("negotiation with a dedicated compressor", () => {
    test("server_no_context_takeover is echoed and honoured", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_no_context_takeover");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_no_context_takeover");
        const first = await peer.request(600);
        const second = await peer.request(600);
        expect(inflateFresh(first.payload).toString()).toBe(pseudoRandomText(600));
        expect(inflateFresh(second.payload).toString()).toBe(pseudoRandomText(600));
      } finally {
        peer.close();
      }
    });

    test("server_max_window_bits lowers the window and is echoed", async () => {
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

    test("server_max_window_bits=15 is echoed", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=15");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover; server_max_window_bits=15");
      } finally {
        peer.close();
      }
    });

    test("parameters of another extension after the comma are not ours", async () => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, "permessage-deflate; client_max_window_bits, x-other; foo=1");
      try {
        expect(peer.extensions).toBe("permessage-deflate; client_no_context_takeover");
      } finally {
        peer.close();
      }
    });

    test.each([
      "server_max_window_bits=8",
      "server_max_window_bits=16",
      "server_max_window_bits",
      "server_max_window_bits=10; server_max_window_bits=12",
      "server_no_context_takeover; server_no_context_takeover",
      "server_no_context_takeover; server_max_window_bits=10",
      "client_max_window_bits=16",
      "client_max_window_bits=7",
      "client_no_context_takeover=1",
      "foo=1",
      "no_context_takeover",
    ])("declines the offer %p", async params => {
      await using server = startServer({ compress: "dedicated", decompress: true });
      const peer = await connect(server, `permessage-deflate; ${params}`);
      try {
        expect(peer.extensions).toBeUndefined();
        const frame = await peer.request(600);
        expect(frame.rsv1).toBe(false);
        expect(frame.payload.toString()).toBe(pseudoRandomText(600));
      } finally {
        peer.close();
      }
    });
  });

  describe("negotiation with the shared compressor", () => {
    test("server_max_window_bits=15 is echoed next to server_no_context_takeover", async () => {
      await using server = startServer(true);
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=15");
      try {
        expect(peer.extensions).toBe(
          "permessage-deflate; client_no_context_takeover; server_no_context_takeover; server_max_window_bits=15",
        );
        expect(inflateFresh((await peer.request(5000)).payload).toString()).toBe(pseudoRandomText(5000));
      } finally {
        peer.close();
      }
    });

    test("a lower server_max_window_bits is declined", async () => {
      await using server = startServer(true);
      const peer = await connect(server, "permessage-deflate; server_max_window_bits=10");
      try {
        expect(peer.extensions).toBeUndefined();
      } finally {
        peer.close();
      }
    });
  });

  test("publish compresses for each subscriber with its own negotiated state", async () => {
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
        expect(inflateFresh(b.payload).toString()).toBe(text);
        if (i === 0) {
          expect(inflateFresh(a.payload).toString()).toBe(text);
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
