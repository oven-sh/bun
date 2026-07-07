// WebSocket frames that arrive in the same TCP read as the HTTP upgrade request
// must be delivered to the websocket, not dropped. TCP has no message boundaries,
// so whether the first frame lands in the same read as the request head is pure
// segmentation luck (eager client, proxy writev, loopback coalescing).
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
import net from "node:net";
import tls from "node:tls";

function maskedFrame(opcode: number, payload: Buffer): Buffer {
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]);
}

const upgradeRequest =
  "GET / HTTP/1.1\r\n" +
  "Host: localhost\r\n" +
  "Connection: Upgrade\r\n" +
  "Upgrade: websocket\r\n" +
  "Sec-WebSocket-Version: 13\r\n" +
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
  "\r\n";

type Events = { messages: unknown[]; pings: string[]; pongs: string[]; close?: { code: number; reason: string } };

describe.each([{ useTls: false }, { useTls: true }])("frames coalesced with the upgrade request (tls: $useTls)", ({ useTls }) => {
  // Raw WebSocket client that writes the upgrade request and any initial frames
  // in ONE socket.write() so they reach HttpContext::onData in one read (the
  // SSL layer decrypts a TLS record into one plaintext dispatch, too).
  async function connectRaw(initialBytes: Buffer) {
    const events: Events = { messages: [], pings: [], pongs: [] };
    const listeners: (() => void)[] = [];
    const notify = () => {
      for (const f of listeners) f();
    };
    const opened = Promise.withResolvers<void>();
    const server = serve({
      port: 0,
      tls: useTls ? { ...tlsCert } : undefined,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        perMessageDeflate: false,
        open() {
          opened.resolve();
        },
        message(ws, message) {
          events.messages.push(message);
          notify();
        },
        ping(ws, data) {
          events.pings.push(data.toString());
          notify();
        },
        close(ws, code, reason) {
          events.close = { code, reason };
          notify();
        },
      },
    });

    const socket: net.Socket = useTls
      ? tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(server.port, "127.0.0.1");
    const closed = Promise.withResolvers<string>();
    const upgraded = Promise.withResolvers<void>();
    socket.on("close", () => {
      closed.resolve("socket-closed");
      upgraded.reject(new Error("socket closed before the 101 response"));
      notify();
    });
    socket.on("error", (error: Error) => {
      closed.resolve("socket-closed");
      upgraded.reject(error);
    });

    let buffered = Buffer.alloc(0);
    let gotHead = false;
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!gotHead) {
        const end = buffered.indexOf("\r\n\r\n");
        if (end === -1) return;
        const head = buffered.subarray(0, end).toString();
        gotHead = true;
        buffered = buffered.subarray(end + 4);
        if (head.startsWith("HTTP/1.1 101")) upgraded.resolve();
        else upgraded.reject(new Error(`upgrade failed: ${head.split("\r\n")[0]}`));
      }
      // Minimal server→client frame reader (unmasked, short lengths only).
      while (buffered.length >= 2) {
        const len = buffered[1] & 0x7f;
        if (buffered.length < 2 + len) break;
        if ((buffered[0] & 0x0f) === 0x0a) events.pongs.push(buffered.subarray(2, 2 + len).toString());
        buffered = buffered.subarray(2 + len);
      }
      notify();
    });

    socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      socket.once(useTls ? "secureConnect" : "connect", resolve);
      socket.once("error", reject);
    });
    // One write: request head + any coalesced frames.
    socket.write(Buffer.concat([Buffer.from(upgradeRequest), initialBytes]));
    try {
      await upgraded.promise;
      await opened.promise;
    } catch (error) {
      socket.destroy();
      server.stop(true);
      throw error;
    }

    return {
      server,
      socket,
      events,
      closed: closed.promise,
      // Resolves once `pred` is satisfied or the socket/server closed.
      until(pred: (e: Events) => boolean): Promise<void> {
        if (pred(events) || events.close || socket.destroyed) return Promise.resolve();
        const { promise, resolve } = Promise.withResolvers<void>();
        listeners.push(() => {
          if (pred(events) || events.close || socket.destroyed) resolve();
        });
        return promise;
      },
      [Symbol.dispose]() {
        socket.destroy();
        server.stop(true);
      },
    };
  }

  it("a text frame in the same write as the upgrade request is delivered", async () => {
    using raw = await connectRaw(maskedFrame(0x1, Buffer.from("early")));
    // A frame sent after the 101 is known to be delivered; once it arrives the
    // coalesced "early" frame must already be in the list, or it was dropped.
    raw.socket.write(maskedFrame(0x1, Buffer.from("later")));
    await raw.until(e => e.messages.includes("later"));
    expect(raw.events.messages).toEqual(["early", "later"]);
  });

  it("a ping in the same write as the upgrade request is answered", async () => {
    using raw = await connectRaw(maskedFrame(0x9, Buffer.from("k")));
    raw.socket.write(maskedFrame(0x9, Buffer.from("later")));
    await raw.until(e => e.pongs.includes("later"));
    expect({ pings: raw.events.pings, pongs: raw.events.pongs }).toEqual({
      pings: ["k", "later"],
      pongs: ["k", "later"],
    });
  });

  it("multiple coalesced frames are all delivered in order", async () => {
    using raw = await connectRaw(
      Buffer.concat([
        maskedFrame(0x1, Buffer.from("one")),
        maskedFrame(0x1, Buffer.from("two")),
        maskedFrame(0x9, Buffer.from("p")),
      ]),
    );
    raw.socket.write(maskedFrame(0x1, Buffer.from("three")));
    await raw.until(e => e.messages.includes("three"));
    expect({ messages: raw.events.messages, pings: raw.events.pings }).toEqual({
      messages: ["one", "two", "three"],
      pings: ["p"],
    });
  });

  it("a partial frame coalesced with the upgrade is completed by the next read", async () => {
    const frame = maskedFrame(0x1, Buffer.from("split"));
    using raw = await connectRaw(frame.subarray(0, 4));
    raw.socket.write(Buffer.concat([frame.subarray(4), maskedFrame(0x1, Buffer.from("after"))]));
    await raw.until(e => e.messages.includes("after"));
    expect(raw.events.messages).toEqual(["split", "after"]);
  });

  it("a coalesced close frame completes the close handshake", async () => {
    const body = Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from("bye")]);
    using raw = await connectRaw(maskedFrame(0x8, body));
    // Post-101 probe so a dropped CLOSE still wakes the test instead of timing out.
    raw.socket.write(maskedFrame(0x1, Buffer.from("probe")));
    await raw.until(e => !!e.close || e.messages.includes("probe"));
    expect(raw.events).toEqual({ messages: [], pings: [], pongs: [], close: { code: 1000, reason: "bye" } });
  });

  it("a coalesced malformed frame fails the connection", async () => {
    // Unmasked client frame: RFC 6455 5.1 requires the server to reject it.
    const bad = Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from("hi")]);
    using raw = await connectRaw(bad);
    raw.socket.write(maskedFrame(0x1, Buffer.from("probe")));
    await raw.until(e => !!e.close || e.messages.includes("probe"));
    expect(raw.events.messages).toEqual([]);
    expect(raw.events.close).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  // Control: no coalesced bytes behaves exactly as before.
  it("upgrade with no coalesced bytes still works", async () => {
    using raw = await connectRaw(Buffer.alloc(0));
    raw.socket.write(maskedFrame(0x1, Buffer.from("hi")));
    await raw.until(e => e.messages.length > 0);
    expect(raw.events.messages).toEqual(["hi"]);
  });
});
