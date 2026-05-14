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

describe.each(["postgres", "mysql"] as Adapter[])("%s connection pool grows lazily (#30632)", adapter => {
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

// Followup from #30632 review (@claude-bot / @Lillious): when a connection
// fails with a non-retryable auth error (unsupported auth method, bad
// password, TLS refused, etc.), subsequent queries must fail fast with the
// cached error — not keep opening new sockets to hit the same auth wall.
// Uses a minimal fake server that answers the startup message with an
// AuthenticationRequest carrying an unsupported auth code, which Bun rejects
// as `ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD`.
//
// Returns the listener + a counter of opened sockets. Every client write
// (the StartupMessage) gets an AuthenticationRequest with auth code 9
// (SSPI), which Bun treats as an unsupported method.
// Wire: 'R' (1 byte) + int32 length (4) + int32 auth code (4).
function makeUnsupportedAuthPgServer() {
  let opened = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        opened++;
      },
      data(socket) {
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

describe("postgres pool fast-fails on non-retryable auth errors (#30632)", () => {
  test("repeated queries with a static password do not open more sockets after an auth failure", async () => {
    using server = makeUnsupportedAuthPgServer();
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
    expect(server.opened).toBe(1);
  });

  test("function password retries auth on each new query (rotatable credentials)", async () => {
    // When `password` is a function, Bun re-invokes it every time it opens
    // a new TCP connection, so a rotated IAM token / Vault lease can take
    // effect. Verify that after an initial auth failure, subsequent
    // queries actually try again — even at `max: 1` where there's no room
    // to grow the pool, which forces reuse of the existing closed slot.
    using server = makeUnsupportedAuthPgServer();
    await using sql = new SQL({
      adapter: "postgres",
      host: "127.0.0.1",
      port: server.port,
      username: "x",
      database: "x",
      max: 1,
      connectionTimeout: 1,
      password: () => "rotating-token",
    });

    for (let i = 0; i < 3; i++) {
      await sql`SELECT ${i}`.catch(() => {});
    }
    // 3 attempts, each dialing fresh TCP on the same slot.
    expect(server.opened).toBe(3);
  });

  test(
    "synchronous `password()` throw does not hang subsequent queries",
    async () => {
      // `createConnection` in postgres.ts catches a thrown `password()`
      // and invokes `onClose` synchronously, so `release()` drains the
      // queue on the same tick `connect()` enqueues onto it. If we push
      // AFTER triggering the retry path, the waiter is lost and the query
      // hangs forever. Guard against that: both queries must resolve with
      // the thrown error. (The `bun:test` per-test timeout fails the test
      // if anything hangs, which is the failure mode we're guarding.)
      await using sql = new SQL({
        adapter: "postgres",
        host: "127.0.0.1",
        port: 1,
        username: "x",
        database: "x",
        max: 1,
        password: () => {
          throw new Error("boom");
        },
      });

      for (let i = 0; i < 2; i++) {
        let err: any;
        try {
          await sql`SELECT ${i}`;
        } catch (e) {
          err = e;
        }
        expect(err?.message).toBe("boom");
      }
    },
    5000,
  );
});
