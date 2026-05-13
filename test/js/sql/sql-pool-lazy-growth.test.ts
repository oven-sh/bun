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
