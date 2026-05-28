import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { createServer, type Server, type Socket } from "net";

// Raw TCP server: complete the WebSocket handshake, then run `afterUpgrade(socket)`
// so a test can write arbitrary Close-frame bytes straight onto the wire. Kept on
// a local socket (no external host) so it runs deterministically offline.
function rawWsServer(afterUpgrade: (sock: Socket) => void): Promise<Server> {
  return new Promise(resolveServer => {
    const server = createServer(sock => {
      let buf = "";
      let upgraded = false;
      sock.on("data", chunk => {
        if (upgraded) {
          sock.end();
          return;
        }
        buf += chunk.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const key = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(buf)![1].trim();
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " +
            accept +
            "\r\n\r\n",
        );
        upgraded = true;
        afterUpgrade(sock);
      });
      sock.on("error", () => {});
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

// Build a Close frame: FIN + opcode 8, single-byte length, 2-byte code, optional reason.
function closeFrame(code: number, reason = ""): Buffer {
  const r = Buffer.from(reason);
  if (2 + r.length >= 126) throw new Error("Payload too large for this test");
  const f = Buffer.alloc(4 + r.length);
  f[0] = 0x88;
  f[1] = 2 + r.length;
  f[2] = (code >> 8) & 0xff;
  f[3] = code & 0xff;
  r.copy(f, 4);
  return f;
}

// Write the given byte chunks each in their own TCP segment. The small delay
// forces a segment boundary at each split so the client parser actually
// re-enters its Close state mid-frame (a single write could be coalesced).
function writeFragmented(sock: Socket, parts: Buffer[]) {
  const writePart = (i: number) => {
    if (i >= parts.length) return;
    sock.write(parts[i]);
    if (i + 1 < parts.length) setTimeout(() => writePart(i + 1), 10);
  };
  writePart(0);
}

async function connectAndAwaitClose(server: Server): Promise<{ code: number; reason: string; wasClean: boolean }> {
  const addr = server.address() as { port: number };
  const ws = new WebSocket(`ws://127.0.0.1:${addr.port}`);
  const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string; wasClean: boolean }>();
  ws.addEventListener("close", e => resolve({ code: e.code, reason: e.reason, wasClean: e.wasClean }));
  ws.addEventListener("error", () => {});
  const result = await promise;
  await new Promise<void>(r => server.close(() => r()));
  return result;
}

describe("WebSocket CloseEvent reports the received close code", () => {
  it("bodyless Close frame reports code 1005", async () => {
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x88, 0x00])));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1005, reason: "", wasClean: true });
  });

  it("Close frame with code 1001 reports 1001", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1001)));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1001, reason: "", wasClean: true });
  });

  describe.each([1000, 1002, 1003, 1007, 1011, 3000, 4000, 4999])("Close frame with code %i", code => {
    it("passes through unchanged", async () => {
      const server = await rawWsServer(sock => sock.write(closeFrame(code)));
      expect(await connectAndAwaitClose(server)).toEqual({ code, reason: "", wasClean: true });
    });
  });

  // RFC6455 §7.4.1: codes < 1000, the reserved 1004-1006 range, and 1016-2999
  // are not legal on the wire; a server that sends one is reporting a protocol
  // error, so JS sees 1002.
  describe.each([999, 1004, 1005, 1006, 1016, 2999])("reserved/invalid code %i", code => {
    it("reports 1002", async () => {
      const server = await rawWsServer(sock => sock.write(closeFrame(code)));
      expect(await connectAndAwaitClose(server)).toEqual({ code: 1002, reason: "", wasClean: true });
    });
  });

  it("Close frame with reason preserves reason", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1011, "boom")));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1011, reason: "boom", wasClean: true });
  });

  it("server-initiated clean close reports wasClean=true", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1000)));
    const { wasClean } = await connectAndAwaitClose(server);
    expect(wasClean).toBe(true);
  });

  it("abnormal close (socket destroyed without Close frame) reports wasClean=false", async () => {
    const server = await rawWsServer(sock => sock.destroy());
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1006, reason: "Connection ended", wasClean: false });
  });
});

describe("WebSocket CloseEvent with a Close frame fragmented across TCP reads", () => {
  it("split mid-reason preserves code and reason", async () => {
    // header(2) + code(2) + first 10 reason bytes, then the rest.
    const frame = closeFrame(1000, "fragmented close test");
    const server = await rawWsServer(sock => writeFragmented(sock, [frame.subarray(0, 14), frame.subarray(14)]));
    expect(await connectAndAwaitClose(server)).toEqual({
      code: 1000,
      reason: "fragmented close test",
      wasClean: true,
    });
  });

  // Regression: the Close parser validates the declared payload length only on
  // the first entry. A split that leaves exactly 1 byte buffered must not be
  // re-read as a length==1 frame (which would spuriously fail the connection
  // with "invalid control frame").
  it("split after one body byte preserves code and reason", async () => {
    const frame = closeFrame(1000, "boom");
    const server = await rawWsServer(sock => writeFragmented(sock, [frame.subarray(0, 3), frame.subarray(3)]));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1000, reason: "boom", wasClean: true });
  });

  // Regression: a split exactly on the header/body boundary leaves 0 bytes
  // buffered; the parser must not treat the frame as bodyless (which would drop
  // the status code and report 1005 "no status received").
  it("split at the header boundary preserves code and reason", async () => {
    const frame = closeFrame(1000, "boom");
    const server = await rawWsServer(sock => writeFragmented(sock, [frame.subarray(0, 2), frame.subarray(2)]));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1000, reason: "boom", wasClean: true });
  });
});
