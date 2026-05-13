// Issue #30632: `new Bun.SQL({ max: N })` must grow the pool lazily on demand,
// not open all N connections up-front. Uses a bare TCP listener as a drop-in
// sink so we can count the opened sockets without needing Docker or a real
// Postgres / MySQL server.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

type Adapter = "postgres" | "mysql";

function makeSink() {
  let opened = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        opened++;
      },
      data() {},
      close() {},
      error() {},
    },
  });
  return {
    port: server.port,
    [Symbol.dispose]() {
      server.stop();
    },
    get opened() {
      return opened;
    },
  };
}

for (const adapter of ["postgres", "mysql"] as Adapter[]) {
  describe(`${adapter} connection pool grows lazily (#30632)`, () => {
    test("a single query only opens one TCP connection, not `max`", async () => {
      using sink = makeSink();
      await using sql = new SQL({
        adapter,
        host: "127.0.0.1",
        port: sink.port,
        username: "x",
        database: "x",
        max: 50,
        connectionTimeout: 1,
      });

      // Query fails (nothing is speaking the DB protocol on the other end);
      // we only care about how many sockets Bun opened.
      await sql`SELECT 1`.catch(() => {});
      expect(sink.opened).toBe(1);
    });
  });
}

// Followup from #30632 review (@claude-bot / @Lillious): when a connection
// fails with a non-retryable auth error (unsupported auth method, bad
// password, TLS refused, etc.), subsequent queries must fail fast with the
// cached error — not keep opening new sockets to hit the same auth wall.
// Uses a minimal fake server that answers the startup message with an
// AuthenticationRequest carrying an unsupported auth code, which Bun rejects
// as `ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD`.
describe("postgres pool fast-fails on non-retryable auth errors (#30632)", () => {
  test("repeated queries after an auth failure do not open more sockets", async () => {
    let opened = 0;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          opened++;
        },
        data(socket) {
          // Any client write (the StartupMessage) gets an AuthenticationRequest
          // with code 9 (SSPI), which Bun treats as an unsupported method.
          // Format: 'R' (1 byte) + int32 length (4) + int32 auth code (4).
          const buf = Buffer.alloc(9);
          buf.write("R", 0);
          buf.writeInt32BE(8, 1);
          buf.writeInt32BE(9, 5);
          socket.write(buf);
        },
        close() {},
        error() {},
      },
    });

    try {
      await using sql = new SQL({
        adapter: "postgres",
        host: "127.0.0.1",
        port: server.port,
        username: "x",
        database: "x",
        max: 20,
        connectionTimeout: 1,
      });

      // Fire 5 sequential queries. The first one opens a connection, the
      // auth handshake fails, and the remaining 4 should reject immediately
      // with the cached auth error — no extra sockets.
      for (let i = 0; i < 5; i++) {
        await sql`SELECT ${i}`.catch(() => {});
      }
      expect(opened).toBe(1);
    } finally {
      server.stop();
    }
  });
});
