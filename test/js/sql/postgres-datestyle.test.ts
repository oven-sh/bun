// Postgres emits date/timestamp text in whatever DateStyle the session has, and
// a database/role can default to e.g. 'SQL, DMY' (03/04/2026 = 3 April). Bun
// decoded that text via JS Date.parse, which applies MDY heuristics, so 3 April
// silently became 4 March and 22 July became null. Bun must pin DateStyle=ISO
// in the StartupMessage (as libpq clients, node-postgres and postgres.js do) so
// the server always sends the ISO form the decoder expects, regardless of
// postgresql.conf / ALTER DATABASE / ALTER ROLE defaults.
//
// Both tests run against a scripted v3 backend so the exact wire bytes are
// deterministic and no docker container is needed. The second test's mock
// honours the StartupMessage DateStyle the same way a real server does (a
// startup-packet parameter is GUC source PGC_S_CLIENT and outranks every
// server-side default): when DateStyle=ISO arrives in the startup packet the
// mock emits ISO text, otherwise it emits the SQL,DMY text a
// `ALTER DATABASE ... SET datestyle = 'SQL, DMY'` default would produce.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParameterStatus,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const OID_date = 1082;

function parseStartupParams(bytes: Buffer): Record<string, string> {
  // StartupMessage body is key\0value\0 pairs after the 8-byte header.
  const body = bytes.subarray(8).toString("latin1");
  const params: Record<string, string> = {};
  const parts = body.split("\0");
  for (let i = 0; i + 1 < parts.length && parts[i] !== ""; i += 2) params[parts[i]] = parts[i + 1];
  return params;
}

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
    const params = parseStartupParams(await startup.promise);
    // client_encoding was already pinned; DateStyle must be too.
    expect(params.client_encoding).toBe("UTF8");
    expect(params.DateStyle).toMatch(/^ISO\b/);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// End-to-end against a scripted backend whose default DateStyle is 'SQL, DMY':
// without DateStyle in the StartupMessage the server emits `03/04/2026` /
// `22/07/2026` for the two probe dates, which the old decode path turns into
// 4 March (month/day swapped) and null (day > 12). With the startup parameter
// the mock emits ISO text, exactly as a real server does, and the decoder
// produces the right Date on both the simple and extended query paths.
// ---------------------------------------------------------------------------
test("database-level non-ISO DateStyle default does not corrupt date values", async () => {
  // 3 April (swaps to 4 March under an MDY reader) and 22 July (day > 12, so
  // an MDY reader yields Invalid Date) are the two diagnostic probe values.
  const dateStyles = {
    ISO: { d: "2026-04-03", d2: "2026-07-22", ds: "ISO, MDY" },
    SQL: { d: "03/04/2026", d2: "22/07/2026", ds: "SQL, DMY" },
  } as const;

  let seenDateStyle = "";
  const { port, server } = await listeningServer(socket => {
    let pending = Buffer.alloc(0);
    let sawStartup = false;
    let style: (typeof dateStyles)[keyof typeof dateStyles];
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (!sawStartup) {
        if (pending.length < 4) return;
        const len = pending.readInt32BE(0);
        if (pending.length < len) return;
        const params = parseStartupParams(pending.subarray(0, len));
        pending = pending.subarray(len);
        sawStartup = true;
        seenDateStyle = params.DateStyle ?? "";
        // Honour the startup parameter the way a real server does; fall back
        // to the database default ('SQL, DMY') when the client didn't send one.
        style = /^ISO\b/.test(seenDateStyle) ? dateStyles.ISO : dateStyles.SQL;
        socket.write(
          Buffer.concat([pgAuthenticationOk(), pgParameterStatus("DateStyle", style.ds), pgReadyForQuery()]),
        );
      }
      pending = pgReadFrontendMessages(pending, type => {
        if (type === 0x51 /* Q: simple query */) {
          socket.write(
            Buffer.concat([
              pgRowDescription([
                { name: "ds", typeOid: 25 /* text */ },
                { name: "d", typeOid: OID_date },
                { name: "d2", typeOid: OID_date },
              ]),
              pgDataRow([Buffer.from(style.ds), Buffer.from(style.d), Buffer.from(style.d2)]),
              pgCommandComplete("SELECT 1"),
              pgReadyForQuery(),
            ]),
          );
        } else if (type === 0x50 /* P: Parse */) {
          socket.write(
            Buffer.concat([
              pgParseComplete(),
              pgParameterDescription([]),
              pgRowDescription([{ name: "d", typeOid: OID_date }]),
              pgReadyForQuery(),
            ]),
          );
        } else if (type === 0x42 /* B: Bind */) {
          socket.write(
            Buffer.concat([
              pgBindComplete(),
              pgDataRow([Buffer.from(style.d)]),
              pgCommandComplete("SELECT 1"),
              pgReadyForQuery(),
            ]),
          );
        }
      });
    });
    socket.on("error", () => {});
  });

  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 5 });
    const [[row], ext] = await Promise.all([
      sql`select current_setting('datestyle'), '2026-04-03'::date, '2026-07-22'::date`.simple(),
      sql`select '2026-04-03'::date`,
    ]);
    const iso = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : String(v));
    expect({
      // DateStyle in the startup packet overrides the database default; the
      // mock reports it back the same way `current_setting('datestyle')` would.
      seenDateStyle,
      ds: row.ds,
      d: iso(row.d),
      d2: iso(row.d2),
      ext: iso(ext[0].d),
    }).toEqual({
      seenDateStyle: "ISO, MDY",
      ds: "ISO, MDY",
      d: "2026-04-03T00:00:00.000Z",
      d2: "2026-07-22T00:00:00.000Z",
      ext: "2026-04-03T00:00:00.000Z",
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
