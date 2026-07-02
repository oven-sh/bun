// This test counts the exact messages Bun's Postgres client puts on the wire
// (Parse / Close), which needs a scripted server; a real server only exposes
// them through per-session state (pg_prepared_statements) that extra queries
// would perturb. All wire-protocol bytes come from test/js/sql/wire-frames.ts.
//
// Regression test: the client never sent Close and kept an unbounded
// per-connection prepared-statement cache. Every distinct query text on a
// connection kept a named prepared statement allocated in the server session
// and a PostgresSQLStatement (rooting one JSC Structure through a Strong
// handle) on the client, both until the connection closed, so a long-lived
// pooled connection running many distinct query texts (what ORMs produce)
// grew both sides without bound. The client now caps the per-connection cache
// (MAX_CACHED_PREPARED_STATEMENTS in src/sql_jsc/postgres/PostgresSQLConnection.rs)
// and sends Close('S', name) for what it evicts.
import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { afterAll, describe, expect, test } from "bun:test";
import * as dockerCompose from "../../docker/index.ts";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCloseComplete,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgParameterDescription,
  pgParseComplete,
  pgReadCString,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Keep in sync with MAX_CACHED_PREPARED_STATEMENTS in
// src/sql_jsc/postgres/PostgresSQLConnection.rs.
const MAX_CACHED_PREPARED_STATEMENTS = 256;

const OID_TEXT = 25;

/**
 * Minimal Postgres server speaking the extended query protocol: accepts any
 * startup, answers Parse / Describe / Bind / Execute / Sync for statements
 * that exist, and records every named statement the client prepares (Parse)
 * or deallocates (Close 'S'). Like a real server it rejects a Bind to a name
 * that was closed (or never prepared) with SQLSTATE 26000 and a Parse that
 * redefines a live name with 42P05, then discards messages until Sync; a
 * client that closes a statement another query still needs fails loudly.
 */
async function statementCountingServer() {
  const counters = {
    parses: 0,
    executes: 0,
    /** named statements the client prepared */
    prepared: new Set<string>(),
    /** named statements the client sent Close('S') for */
    closed: new Set<string>(),
  };
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    const sawStartup = { value: false };
    /** named statements currently live in this session */
    const live = new Set<string>();
    /** first parameter of the last Bind, echoed back by the next Execute */
    let lastBoundParam: Buffer | null = null;
    // After an ErrorResponse the backend discards messages until Sync.
    let skipUntilSync = false;
    socket.on("data", chunk => {
      buffered = pgReadFrontendMessages(
        Buffer.concat([buffered, chunk]),
        sawStartup,
        () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])),
        (tag, body) => {
          if (skipUntilSync && tag !== 0x53 /* Sync */) return;
          switch (tag) {
            // Parse: String(name) String(query) Int16(nparams) Int32[nparams]
            case 0x50: {
              const name = pgReadCString(body, 0);
              counters.parses++;
              if (live.has(name.value)) {
                socket.write(
                  pgErrorResponse({
                    S: "ERROR",
                    C: "42P05",
                    M: `prepared statement "${name.value}" already exists`,
                  }),
                );
                skipUntilSync = true;
                break;
              }
              live.add(name.value);
              counters.prepared.add(name.value);
              socket.write(pgParseComplete());
              break;
            }
            // Describe: Byte1('S' | 'P') String(name)
            case 0x44: {
              socket.write(
                Buffer.concat([
                  pgParameterDescription([OID_TEXT]),
                  pgRowDescription([{ name: "c", typeOid: OID_TEXT }]),
                ]),
              );
              break;
            }
            // Bind: String(portal) String(statement) Int16(nformats) Int16[nformats]
            //       Int16(nparams) (Int32(len) Byte[len])[nparams] ...
            case 0x42: {
              const portal = pgReadCString(body, 0);
              const statement = pgReadCString(body, portal.end);
              if (!live.has(statement.value)) {
                socket.write(
                  pgErrorResponse({
                    S: "ERROR",
                    C: "26000",
                    M: `prepared statement "${statement.value}" does not exist`,
                  }),
                );
                skipUntilSync = true;
                break;
              }
              let offset = statement.end;
              const formats = body.readInt16BE(offset);
              offset += 2 + 2 * formats;
              const params = body.readInt16BE(offset);
              offset += 2;
              lastBoundParam = null;
              if (params > 0) {
                const length = body.readInt32BE(offset);
                offset += 4;
                if (length >= 0) lastBoundParam = Buffer.from(body.subarray(offset, offset + length));
              }
              socket.write(pgBindComplete());
              break;
            }
            // Execute: String(portal) Int32(maxrows)
            case 0x45: {
              counters.executes++;
              socket.write(Buffer.concat([pgDataRow([lastBoundParam]), pgCommandComplete("SELECT 1")]));
              break;
            }
            // Close: Byte1('S' | 'P') String(name). Closing a nonexistent name
            // is not an error, but only names the client prepared should ever
            // show up here (asserted by the tests through `counters.closed`).
            case 0x43: {
              if (body[0] === 0x53 /* 'S' */) {
                const name = pgReadCString(body, 1);
                live.delete(name.value);
                counters.closed.add(name.value);
              }
              socket.write(pgCloseComplete());
              break;
            }
            // Sync
            case 0x53: {
              skipUntilSync = false;
              socket.write(pgReadyForQuery());
              break;
            }
            // Terminate
            case 0x58: {
              socket.end();
              break;
            }
          }
        },
      );
    });
    socket.on("error", () => {});
  });
  return { server, port, counters };
}

function sqlUrl(port: number): string {
  return `postgres://postgres@127.0.0.1:${port}/postgres`;
}

// Exceeding the cache cap takes MAX_CACHED_PREPARED_STATEMENTS + 8 distinct
// prepared statements by definition, which outgrows the 5s default per-test
// timeout on debug + ASAN builds, so these tests declare their real budget.
test("postgres: the prepared-statement cache is capped and evicted statements are closed", async () => {
  const { server, port, counters } = await statementCountingServer();
  try {
    await using sql = new SQL({ url: sqlUrl(port), max: 1 });

    // More distinct query texts than the cap, all in flight at once on one
    // connection: none may be evicted or closed while a query references it
    // (the mock rejects a Bind to a closed name, failing the Promise.all).
    const DISTINCT = MAX_CACHED_PREPARED_STATEMENTS + 8;
    const results = await Promise.all(
      Array.from({ length: DISTINCT }, (_, i) => sql.unsafe(`select $1 as c${i}`, [String(i)])),
    );
    expect(results).toEqual(Array.from({ length: DISTINCT }, (_, i) => [{ c: String(i) }]));
    expect(counters.parses).toBe(DISTINCT);
    expect(counters.closed.size).toBe(0);

    // Statements become evictable once their (collected) query wrappers stop
    // referencing them. Collect, then keep inserting distinct texts: each one
    // past the cap must evict + Close. Poll, since GC sets the pace.
    let extra = 0;
    while (counters.parses - counters.closed.size > MAX_CACHED_PREPARED_STATEMENTS && extra < 64) {
      Bun.gc(true);
      await Bun.sleep(0);
      await sql.unsafe(`select $1 as extra${extra}`, [String(extra)]);
      extra++;
    }

    // Without Close the number of live server-side statements
    // (parses - closes) grows monotonically with every distinct query text;
    // the loop above then exhausts its budget with closed.size still 0.
    expect(counters.closed.size).toBeGreaterThan(0);
    expect(counters.parses - counters.closed.size).toBeLessThanOrEqual(MAX_CACHED_PREPARED_STATEMENTS);
    // Only names the server actually saw prepared may be closed.
    expect([...counters.closed].every(name => counters.prepared.has(name))).toBe(true);
    // Every query text was parsed and executed exactly once (a Bind to a
    // closed name would have been rejected by the mock and thrown above).
    expect(counters.parses).toBe(DISTINCT + extra);
    expect(counters.executes).toBe(DISTINCT + extra);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30_000);

// The same unbounded cache also leaked client memory: every cached statement
// roots one JSC Structure (its row shape) through a Strong handle, plus its
// own metadata, for the connection's lifetime. Eviction must release both.
test("postgres: evicting cached statements releases their rooted row Structures (client memory)", async () => {
  const protectedStructures = () => heapStats().protectedObjectTypeCounts.Structure ?? 0;
  const { server, port, counters } = await statementCountingServer();
  try {
    await using sql = new SQL({ url: sqlUrl(port), max: 1 });

    // The mock names every result column "c" and echoes the first bound
    // parameter, which also proves the DataRow framing is consumed.
    expect(await sql.unsafe("select $1 as warmup", ["w"])).toEqual([{ c: "w" }]);
    Bun.gc(true);
    await Bun.sleep(0);
    const baseline = protectedStructures();

    const DISTINCT = MAX_CACHED_PREPARED_STATEMENTS + 8;
    for (let i = 0; i < DISTINCT; i++) {
      await sql.unsafe(`select $1 as c${i}`, [String(i)]);
    }

    // Statements become evictable once their collected query wrappers drop
    // them (same convergence loop as the capped-eviction test above).
    let extra = 0;
    while (counters.parses - counters.closed.size > MAX_CACHED_PREPARED_STATEMENTS && extra < 64) {
      Bun.gc(true);
      await Bun.sleep(0);
      await sql.unsafe(`select $1 as extra${extra}`, [String(extra)]);
      extra++;
    }
    Bun.gc(true);
    await Bun.sleep(0);

    expect(counters.closed.size).toBeGreaterThan(0);
    // Post-GC, only statements still cached may root a Structure (the slack
    // absorbs unrelated Strong handles created while the test runs). Without
    // eviction every one of the DISTINCT + extra texts roots its Structure
    // (and retains its statement) until the connection closes.
    expect(protectedStructures() - baseline).toBeLessThanOrEqual(MAX_CACHED_PREPARED_STATEMENTS + 16);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30_000);

// The scripted server above observes the wire; a real server additionally
// proves the Close is accepted where the client writes it (between two
// extended-query sequences) and that pg_prepared_statements, the session's
// source of truth, stays bounded.
describe("postgres: statement cache against a real server", async () => {
  let container: { port: number; host: string };
  try {
    const info = await dockerCompose.ensure("postgres_plain");
    container = { port: info.ports[5432], host: info.host };
  } catch (e) {
    test.skip(`Docker not available: ${e}`);
    return;
  }

  afterAll(async () => {
    if (!process.env.BUN_KEEP_DOCKER) {
      await dockerCompose.down();
    }
  });

  test("pg_prepared_statements stays within the cache cap", async () => {
    await using sql = new SQL({
      db: "bun_sql_test",
      username: "bun_sql_test",
      host: container.host,
      port: container.port,
      max: 1,
    });
    // Simple-protocol query: observes the session's named statements without
    // creating one.
    const statementCount = async () =>
      Number((await sql`select count(*)::int as n from pg_prepared_statements`.simple())[0].n);

    const DISTINCT = MAX_CACHED_PREPARED_STATEMENTS + 44;
    for (let i = 0; i < DISTINCT; i++) {
      expect(await sql.unsafe(`select $1::text as c${i}`, [String(i)])).toEqual([{ [`c${i}`]: String(i) }]);
    }

    let extra = 0;
    while ((await statementCount()) > MAX_CACHED_PREPARED_STATEMENTS && extra < 64) {
      Bun.gc(true);
      await Bun.sleep(0);
      await sql.unsafe(`select $1::text as extra${extra}`, [String(extra)]);
      extra++;
    }
    const settled = await statementCount();
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(MAX_CACHED_PREPARED_STATEMENTS);

    // Texts whose statements were evicted re-prepare transparently.
    for (let i = 0; i < DISTINCT; i++) {
      expect(await sql.unsafe(`select $1::text as c${i}`, [String(i)])).toEqual([{ [`c${i}`]: String(i) }]);
    }
    expect(await statementCount()).toBeLessThanOrEqual(MAX_CACHED_PREPARED_STATEMENTS);
  }, 40_000);
});

test("postgres: an identical query text keeps reusing one prepared statement and is never closed", async () => {
  const { server, port, counters } = await statementCountingServer();
  try {
    await using sql = new SQL({ url: sqlUrl(port), max: 1 });

    // Same text + same parameter type = same statement-cache entry. Collect in
    // between so finalized query wrappers cannot take the cached statement (or
    // its server-side name) with them.
    for (let i = 0; i < 50; i++) {
      expect(await sql.unsafe("select $1 as reused", [String(i)])).toEqual([{ c: String(i) }]);
      if (i % 10 === 0) {
        Bun.gc(true);
        await Bun.sleep(0);
      }
    }

    expect({
      parses: counters.parses,
      executes: counters.executes,
      closed: counters.closed.size,
    }).toEqual({
      parses: 1,
      executes: 50,
      closed: 0,
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
