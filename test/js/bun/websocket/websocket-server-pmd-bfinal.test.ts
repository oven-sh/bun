// RFC 7692 7.2.3.4: a permessage-deflate sender may end a message with a
// DEFLATE block whose BFINAL bit is set to 1. A receiver must decode it and,
// with context takeover, reset its inflater so the next message starts a fresh
// DEFLATE stream. The dedicated decompressor used to treat Z_STREAM_END as a
// fatal inflate error and drop the TCP connection.
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import net from "node:net";
import { constants, deflateRawSync } from "node:zlib";

// A permessage-deflate payload sync-flushed with the trailing 0x00 0x00 0xff
// 0xff removed (RFC 7692 7.2.1): the shape every mainstream sender emits.
function pmdSyncFlush(payload: Buffer): Buffer {
  const deflated = deflateRawSync(payload, { finishFlush: constants.Z_SYNC_FLUSH });
  expect(deflated.subarray(-4)).toEqual(Buffer.from([0x00, 0x00, 0xff, 0xff]));
  return deflated.subarray(0, -4);
}

// A complete raw DEFLATE stream ending in a BFINAL=1 block.
function pmdFinal(payload: Buffer): Buffer {
  return deflateRawSync(payload);
}

// The RFC 7692 7.2.3.4 shape: a BFINAL=1 stream followed by one 0x00 octet
// (header of an empty non-final stored block) so the tail stripped by 7.2.1
// round-trips.
function pmdFinalPadded(payload: Buffer): Buffer {
  return Buffer.concat([deflateRawSync(payload), Buffer.from([0x00])]);
}

function frame(opcode: number, payload: Buffer, opts: { fin?: boolean; rsv1?: boolean } = {}): Buffer {
  const { fin = true, rsv1 = false } = opts;
  if (payload.length > 0xffff) throw new Error("these tests only build short and medium frames");
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  const flags = (fin ? 0x80 : 0x00) | (rsv1 ? 0x40 : 0x00) | opcode;
  const head =
    payload.length < 126
      ? Buffer.from([flags, 0x80 | payload.length])
      : Buffer.from([flags, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([head, mask, masked]);
}

type PerMessageDeflate = boolean | { compress?: true | "shared" | "dedicated"; decompress?: true | "shared" | "dedicated" };

// Raw TCP WebSocket client that negotiates permessage-deflate against a
// Bun.serve websocket server and exposes exactly what message() saw.
async function connectDeflated(perMessageDeflate: PerMessageDeflate) {
  const received: string[] = [];
  const messageWaiters: ((hex: string) => void)[] = [];
  const serverClose = Promise.withResolvers<string>();
  const server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate,
      message(ws, message) {
        const hex = Buffer.from(message as Buffer).toString("hex");
        received.push(hex);
        messageWaiters.shift()?.(`message:${hex}`);
      },
      close(ws, code, reason) {
        serverClose.resolve(`close:${code}:${reason}`);
      },
    },
  });

  const socket = net.connect(server.port, "127.0.0.1");
  socket.setNoDelay(true);
  const upgraded = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<string>();
  socket.on("close", () => {
    closed.resolve("socket-closed-by-server");
    upgraded.reject(new Error("socket closed before the 101 response"));
  });
  socket.on("error", (error: Error) => {
    closed.resolve("socket-closed-by-server");
    upgraded.reject(error);
  });

  let head = Buffer.alloc(0);
  let negotiated = "";
  const onHead = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    socket.off("data", onHead);
    const headText = head.subarray(0, end).toString();
    if (!headText.startsWith("HTTP/1.1 101")) {
      upgraded.reject(new Error(`upgrade failed: ${headText.split("\r\n")[0]}`));
      return;
    }
    negotiated = headText.split("\r\n").find(line => /^sec-websocket-extensions:/i.test(line)) ?? "";
    upgraded.resolve();
  };
  socket.on("data", onHead);
  socket.write(
    "GET / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" +
      "\r\n",
  );
  try {
    await upgraded.promise;
    expect(negotiated.toLowerCase()).toContain("permessage-deflate");
  } catch (error) {
    socket.destroy();
    server.stop(true);
    throw error;
  }

  return {
    socket,
    received,
    serverClose: serverClose.promise,
    closed: closed.promise,
    nextMessage(): Promise<string> {
      const { promise, resolve } = Promise.withResolvers<string>();
      messageWaiters.push(resolve);
      return promise;
    },
    [Symbol.dispose]() {
      socket.destroy();
      server.stop(true);
    },
  };
}

const modes: [string, PerMessageDeflate][] = [
  ["true", true],
  ["shared", { compress: "shared", decompress: "shared" }],
  ["dedicated", { compress: "dedicated", decompress: "dedicated" }],
];

describe.concurrent.each(modes)("permessage-deflate BFINAL=1 (perMessageDeflate: %s)", (_label, pmd) => {
  // Large enough that zlib actually compresses it, small enough to fit the
  // single-chunk inflate buffer so the loop exits on the first iteration.
  const original = Buffer.alloc(750, "bfinal-interop-");

  it("a sync-flushed message is inflated and delivered (control)", async () => {
    using raw = await connectDeflated(pmd);
    const msg = raw.nextMessage();
    raw.socket.write(frame(0x2, pmdSyncFlush(original), { rsv1: true }));
    expect(await Promise.race([msg, raw.serverClose, raw.closed])).toBe(`message:${original.toString("hex")}`);
  });

  it("a BFINAL=1 message is inflated and delivered", async () => {
    using raw = await connectDeflated(pmd);
    const msg = raw.nextMessage();
    raw.socket.write(frame(0x2, pmdFinal(original), { rsv1: true }));
    expect(await Promise.race([msg, raw.serverClose, raw.closed])).toBe(`message:${original.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex")]);
  });

  it("a BFINAL=1 message padded with 0x00 is inflated and delivered", async () => {
    using raw = await connectDeflated(pmd);
    const msg = raw.nextMessage();
    raw.socket.write(frame(0x2, pmdFinalPadded(original), { rsv1: true }));
    expect(await Promise.race([msg, raw.serverClose, raw.closed])).toBe(`message:${original.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex")]);
  });

  // After Z_STREAM_END the inflater must be reset: the next message on the
  // same connection starts a fresh DEFLATE stream, not a continuation.
  it("a sync-flushed message after a BFINAL=1 message is still decoded correctly", async () => {
    using raw = await connectDeflated(pmd);
    const first = raw.nextMessage();
    const second = raw.nextMessage();
    const followup = Buffer.alloc(200, "after-bfinal-");
    raw.socket.write(
      Buffer.concat([
        frame(0x2, pmdFinal(original), { rsv1: true }),
        frame(0x2, pmdSyncFlush(followup), { rsv1: true }),
      ]),
    );
    expect(await Promise.race([first, raw.serverClose, raw.closed])).toBe(`message:${original.toString("hex")}`);
    expect(await Promise.race([second, raw.serverClose, raw.closed])).toBe(`message:${followup.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex"), followup.toString("hex")]);
  });

  it("two BFINAL=1 messages in a row are both decoded correctly", async () => {
    using raw = await connectDeflated(pmd);
    const first = raw.nextMessage();
    const second = raw.nextMessage();
    const other = Buffer.alloc(300, "second-bfinal-");
    raw.socket.write(
      Buffer.concat([
        frame(0x2, pmdFinalPadded(original), { rsv1: true }),
        frame(0x2, pmdFinal(other), { rsv1: true }),
      ]),
    );
    expect(await Promise.race([first, raw.serverClose, raw.closed])).toBe(`message:${original.toString("hex")}`);
    expect(await Promise.race([second, raw.serverClose, raw.closed])).toBe(`message:${other.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex"), other.toString("hex")]);
  });
});

// The zlib inflate loop writes into a 16 KiB scratch buffer per iteration; a
// BFINAL=1 payload that inflates to more than that must still be reassembled
// correctly across the chunk boundary.
it("dedicated: a BFINAL=1 message inflating to more than 16 KiB is delivered intact", async () => {
  using raw = await connectDeflated({ compress: "dedicated", decompress: "dedicated" });
  const big = Buffer.alloc(20000, "bfinal-large-chunk-");
  const compressed = pmdFinal(big);
  expect(compressed.length).toBeLessThan(0xffff);
  const msg = raw.nextMessage();
  raw.socket.write(frame(0x2, compressed, { rsv1: true }));
  expect(await Promise.race([msg, raw.serverClose, raw.closed])).toBe(`message:${big.toString("hex")}`);
  expect(raw.received).toEqual([big.toString("hex")]);
});
