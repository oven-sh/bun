import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

// Minimal RESP3 server stub: answers HELLO, SUBSCRIBE, GET, PING and +OK for
// everything else. Enough to drive a client into subscriber mode without
// Docker.
const CRLF = "\r\n";
const blk = (s: string) => `$${Buffer.byteLength(s)}${CRLF}${s}${CRLF}`;
const HELLO = `%3${CRLF}${blk("server")}${blk("redis")}${blk("proto")}:3${CRLF}${blk("version")}${blk("7.4.0")}`;

function makeStubServer() {
  return Bun.listen<{ buf: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s) {
        s.data = { buf: "" };
      },
      data(s, raw) {
        const t = raw.toString();
        if (t.includes("HELLO")) s.write(HELLO);
        else if (t.includes("\r\nSUBSCRIBE\r\n"))
          s.write(`>3${CRLF}${blk("subscribe")}${blk("news")}:1${CRLF}`);
        else if (t.includes("\r\nUNSUBSCRIBE\r\n"))
          s.write(`>3${CRLF}${blk("unsubscribe")}${blk("news")}:0${CRLF}`);
        else if (t.includes("\r\nGET\r\n")) s.write(`+from-server${CRLF}`);
        else if (t.includes("\r\nPING\r\n")) s.write(`+PONG${CRLF}`);
        else s.write(`+OK${CRLF}`);
      },
    },
  });
}

describe("RedisClient subscriber-mode guard", () => {
  test("command methods return a rejected promise (not a sync throw) in subscriber mode", async () => {
    using srv = makeStubServer();
    const c = new RedisClient(`redis://127.0.0.1:${srv.port}`, { autoReconnect: false });
    try {
      await c.connect();
      await c.subscribe("news", () => {});

      // The method must return a Promise synchronously so that
      // `.catch()` / `.then(_, onReject)` can observe the state error.
      let syncThrow: unknown = null;
      let returned: unknown;
      try {
        returned = c.get("k");
      } catch (e) {
        syncThrow = e;
      }
      expect(syncThrow).toBeNull();
      expect(returned).toBeInstanceOf(Promise);

      // Swallow the rejection from the captured promise (we re-assert via
      // `expect().rejects` below) so it isn't reported as unhandled.
      await (returned as Promise<unknown>).catch(() => {});

      // The rejection carries the ERR_REDIS_INVALID_STATE error.
      const getErr = await c.get("k").then(
        v => ({ status: "fulfilled", value: v }),
        e => ({ status: "rejected", code: e?.code, message: String(e?.message) }),
      );
      expect(getErr).toEqual({
        status: "rejected",
        code: "ERR_REDIS_INVALID_STATE",
        message: expect.stringContaining("cannot be called while in subscriber mode"),
      });

      // Same contract for a macro-generated method and one of the other
      // hand-written ones.
      await expect(c.keys("*")).rejects.toThrow("cannot be called while in subscriber mode");
      await expect(c.set("k", "v")).rejects.toThrow("cannot be called while in subscriber mode");
    } finally {
      c.close();
    }
  });

  test("unsubscribe() on a non-subscriber returns a rejected promise", async () => {
    using srv = makeStubServer();
    const c = new RedisClient(`redis://127.0.0.1:${srv.port}`, { autoReconnect: false });
    try {
      await c.connect();

      let syncThrow: unknown = null;
      let returned: unknown;
      try {
        returned = c.unsubscribe("news");
      } catch (e) {
        syncThrow = e;
      }
      expect(syncThrow).toBeNull();
      expect(returned).toBeInstanceOf(Promise);
      await expect(returned).rejects.toMatchObject({
        code: "ERR_REDIS_INVALID_STATE",
        message: expect.stringContaining("can only be called while in subscriber mode"),
      });
    } finally {
      c.close();
    }
  });
});
