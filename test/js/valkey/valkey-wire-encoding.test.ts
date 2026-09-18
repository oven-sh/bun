import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

// A minimal in-process RESP3 peer that records every command it receives,
// byte for byte, so a test can assert on the exact wire encoding.
function createWirePeer() {
  const commands: Buffer[][] = [];
  const server = Bun.listen<Buffer>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = Buffer.alloc(0);
      },
      data(socket, chunk) {
        socket.data = Buffer.concat([socket.data, chunk]);
        for (;;) {
          const buf = socket.data;
          if (buf.length === 0 || buf[0] !== 0x2a) return;
          let pos = buf.indexOf("\r\n");
          if (pos < 0) return;
          const count = Number(buf.subarray(1, pos).toString());
          const args: Buffer[] = [];
          pos += 2;
          for (let i = 0; i < count; i++) {
            const lenEnd = buf.indexOf("\r\n", pos);
            if (lenEnd < 0) return;
            const len = Number(buf.subarray(pos + 1, lenEnd).toString());
            if (buf.length < lenEnd + 2 + len + 2) return;
            args.push(buf.subarray(lenEnd + 2, lenEnd + 2 + len));
            pos = lenEnd + 2 + len + 2;
          }
          socket.data = buf.subarray(pos);
          commands.push(args);
          const name = args[0].toString().toUpperCase();
          if (name === "HELLO") socket.write("%1\r\n$5\r\nproto\r\n:3\r\n");
          else if (/^(HSET|HMSET|HINCRBY)$/.test(name)) socket.write(":1\r\n");
          else socket.write("+OK\r\n");
        }
      },
    },
  });
  return {
    url: `redis://127.0.0.1:${server.port}`,
    // Commands after the HELLO handshake, as [name, ...args] byte arrays.
    sent: () => commands.slice(1).map(args => args.map(a => Array.from(a))),
    [Symbol.dispose]: () => server.stop(true),
  };
}

describe("RedisClient wire encoding", () => {
  // The `code` of the error a method throws synchronously, before any I/O.
  function thrownCode(fn: () => Promise<unknown>): string | undefined {
    try {
      fn().catch(() => {});
    } catch (e) {
      return (e as { code?: string }).code;
    }
    return undefined;
  }

  test("hset, hmset, hincrby and hincrbyfloat send buffers byte for byte", async () => {
    using peer = createWirePeer();
    const client = new RedisClient(peer.url, { autoReconnect: false });
    try {
      const bin = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
      const view = new Uint8Array([7, 255]);
      await client.hset("k", "f", bin);
      await client.hset(bin, "f", "v");
      await client.hset("k", { f: bin });
      await client.hmset("k", ["f", bin]);
      await client.hset("k", "f", view);
      await client.hset("k", bin, "v", view, 7);
      await client.hincrby("k", bin, 1);
      await client.hincrbyfloat("k", bin, 1.5);
      await client.hset("k", new Blob([bin]), new Blob([view]));

      const b = (s: string) => Array.from(Buffer.from(s));
      const raw = Array.from(bin);
      expect(peer.sent()).toEqual([
        [b("HSET"), b("k"), b("f"), raw],
        [b("HSET"), raw, b("f"), b("v")],
        [b("HSET"), b("k"), b("f"), raw],
        [b("HMSET"), b("k"), b("f"), raw],
        [b("HSET"), b("k"), b("f"), [7, 255]],
        [b("HSET"), b("k"), raw, b("v"), [7, 255], b("7")],
        [b("HINCRBY"), b("k"), raw, b("1")],
        [b("HINCRBYFLOAT"), b("k"), raw, b("1.5")],
        [b("HSET"), b("k"), raw, [7, 255]],
      ]);
    } finally {
      client.close();
    }
  });

  test("hset rejects undefined and plain objects instead of stringifying them", async () => {
    using peer = createWirePeer();
    const client = new RedisClient(peer.url, { autoReconnect: false });
    try {
      await client.ping();
      // @ts-expect-error: testing runtime behavior
      expect(thrownCode(() => client.hset("k", "f", undefined))).toBe("ERR_INVALID_ARG_TYPE");
      // @ts-expect-error: testing runtime behavior
      expect(thrownCode(() => client.hset("k", "f", { a: 1 }))).toBe("ERR_INVALID_ARG_TYPE");
      // @ts-expect-error: testing runtime behavior
      expect(thrownCode(() => client.hset("k", { f: null }))).toBe("ERR_INVALID_ARG_TYPE");
      // @ts-expect-error: testing runtime behavior
      expect(thrownCode(() => client.hmset("k", ["f", undefined]))).toBe("ERR_INVALID_ARG_TYPE");
      // @ts-expect-error: testing runtime behavior
      expect(thrownCode(() => client.hincrby("k", undefined, 1))).toBe("ERR_INVALID_ARG_TYPE");
      expect(peer.sent()).toEqual([[Array.from(Buffer.from("PING"))]]);
    } finally {
      client.close();
    }
  });
});
