// Postgres emits date/timestamp text in whatever DateStyle the session has, and
// a database/role can default to e.g. 'SQL, DMY' (03/04/2026 = 3 April). Bun
// decoded that text via JS Date.parse, which applies MDY heuristics, so 3 April
// silently became 4 March and 22 July became null. Bun must pin DateStyle=ISO
// in the StartupMessage (as libpq clients, node-postgres and postgres.js do) so
// the server always sends the ISO form the decoder expects, regardless of
// postgresql.conf / ALTER DATABASE / ALTER ROLE defaults.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { listeningServer, pgAuthenticationOk, pgCString, pgRaw, pgReadyForQuery } from "./wire-frames";

// PostgreSQL FE/BE protocol §55.7 ParameterStatus: Byte1('S') Int32(len) String(name) String(value)
const pgParameterStatus = (name: string, value: string) =>
  pgRaw("S", Buffer.concat([pgCString(name), pgCString(value)]));

// ---------------------------------------------------------------------------
// Protocol-level: the StartupMessage must carry DateStyle=ISO so server-side
// defaults cannot change the wire date format. This is the load-bearing fix;
// with it in place a real server never sends non-ISO text for date/timestamp.
// ---------------------------------------------------------------------------
test("StartupMessage pins DateStyle=ISO so server-side datestyle defaults cannot corrupt dates", async () => {
  const startup = Promise.withResolvers<Buffer>();
  const { port, server } = await listeningServer(socket => {
    socket.once("data", data => {
      startup.resolve(Buffer.from(data));
      socket.write(
        Buffer.concat([pgAuthenticationOk(), pgParameterStatus("DateStyle", "ISO, MDY"), pgReadyForQuery()]),
      );
    });
  });
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 5 });
    await sql.connect();
    const bytes = await startup.promise;
    // StartupMessage body is key\0value\0 pairs after the 8-byte header.
    const body = bytes.subarray(8).toString("latin1");
    const params: Record<string, string> = {};
    const parts = body.split("\0");
    for (let i = 0; i + 1 < parts.length && parts[i] !== ""; i += 2) params[parts[i]] = parts[i + 1];
    // client_encoding was already pinned; DateStyle must be too.
    expect(params.client_encoding).toBe("UTF8");
    expect(params.DateStyle).toMatch(/^ISO\b/);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// End-to-end against a real server: force a non-ISO default on the database,
// reconnect, and read a date back. Without DateStyle in the StartupMessage the
// server honours the ALTER DATABASE default and emits `03/04/2026`, which the
// old decode path turns into 4 March (or null for day > 12).
// ---------------------------------------------------------------------------
describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("database-level non-ISO DateStyle default does not corrupt date values", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    {
      await using setup = new SQL({ url, max: 1 });
      await setup.unsafe(`ALTER DATABASE bun_sql_test SET datestyle = 'SQL, DMY'`);
    }
    try {
      await using sql = new SQL({ url, max: 1 });
      const [[style], [row], ext] = await Promise.all([
        sql`select current_setting('datestyle') as ds`.simple(),
        sql`select '2026-04-03'::date as d, '2026-07-22'::date as d2`.simple(),
        sql`select '2026-04-03'::date as d`,
      ]);
      // DateStyle in the startup packet overrides the database default.
      expect(style.ds).toMatch(/^ISO\b/);
      expect({
        d: row.d.toISOString(),
        d2: row.d2.toISOString(),
        ext: ext[0].d.toISOString(),
      }).toEqual({
        d: "2026-04-03T00:00:00.000Z",
        d2: "2026-07-22T00:00:00.000Z",
        ext: "2026-04-03T00:00:00.000Z",
      });
    } finally {
      await using cleanup = new SQL({ url, max: 1 });
      await cleanup.unsafe(`ALTER DATABASE bun_sql_test RESET datestyle`);
    }
  });
});
