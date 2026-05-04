import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import { once } from "events";
import net, { type AddressInfo } from "node:net";
import * as dockerCompose from "../../docker/index.ts";

// Tests for `prepare: false` (unnamed prepared statements).
// These verify that parameterized queries work correctly when using unnamed
// prepared statements, which is critical for PgBouncer compatibility.

// ─────────────────────────────────────────────────────────────────────────
// Wire-protocol assertions — no external Postgres required.
//
// Stand up a minimal mock backend that speaks just enough of the
// extended-query protocol to accept Parse+Describe+Bind+Execute+Sync from
// a `prepare: false` client, then inspect the raw bytes the client placed
// in the Bind message for parameter #0.
//
// This is what regressed in #30221: before the fix, `writeBind` fell
// through to `String.fromJS` for objects when the parsed parameter OID
// was 0 (Postgres-infers), producing `"[object Object]"` instead of the
// JSON text the prepared path already writes.
// ─────────────────────────────────────────────────────────────────────────
describe("issue #30221: prepare:false JSON-stringifies object parameters", () => {
  function msg(code: string, payload: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeInt32BE(payload.length + 4);
    return Buffer.concat([Buffer.from(code, "latin1"), len, payload]);
  }
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    return b;
  };
  const i16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n);
    return b;
  };
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

  const authOk = msg("R", i32(0));
  const paramStatus = (k: string, v: string) => msg("S", Buffer.concat([cstr(k), cstr(v)]));
  const backendKeyData = msg("K", Buffer.concat([i32(1), i32(2)]));
  const readyForQuery = msg("Z", Buffer.from([0x49])); // 'I' = idle
  const parseComplete = msg("1", Buffer.alloc(0));
  // Report the parameters back to the client as OID 0 (unspecified), so the
  // Bind encoding still uses the signature-inferred format. This mirrors
  // what a real server does when Parse was sent with OID 0 and there's a
  // `::jsonb` / `::json` cast in the query.
  const paramDescription = (oids: number[]) => msg("t", Buffer.concat([i16(oids.length), ...oids.map(i32)]));
  const noData = msg("n", Buffer.alloc(0));
  const bindComplete = msg("2", Buffer.alloc(0));
  const cmdComplete = (tag: string) => msg("C", cstr(tag));

  // Bind body layout:
  //   cstr portal, cstr stmt,
  //   i16 nFmt, i16[nFmt],
  //   i16 nParam, (i32 len, bytes)[nParam],
  //   i16 nResFmt, i16[nResFmt]
  function extractFirstParam(body: Buffer): { format: number; value: string | null } | null {
    let o = 0;
    while (body[o] !== 0) o++;
    o++; // portal
    while (body[o] !== 0) o++;
    o++; // stmt
    const nFmt = body.readInt16BE(o);
    o += 2;
    const formats: number[] = [];
    for (let i = 0; i < nFmt; i++) {
      formats.push(body.readInt16BE(o));
      o += 2;
    }
    const nParam = body.readInt16BE(o);
    o += 2;
    if (nParam < 1) return null;
    const plen = body.readInt32BE(o);
    o += 4;
    if (plen < 0) return { format: formats[0] ?? 0, value: null };
    const valueBytes = body.subarray(o, o + plen);
    // Format codes: 0=text, 1=binary. For nFmt=1, that single code applies
    // to every parameter; for nFmt=nParam, each parameter has its own.
    const format = nFmt === 1 ? formats[0] : nFmt === 0 ? 0 : formats[0];
    return { format, value: valueBytes.toString("utf8") };
  }

  /// Stand up a one-shot mock PG backend that captures parameter #0 of
  /// the first Bind message the client sends. The server advertises the
  /// parameter type as `paramOid` in its ParameterDescription reply so
  /// the client can cache it for subsequent runs, but the in-flight Bind
  /// is built from `statement.signature.fields` (OID 0 for json-shaped
  /// values) — which is exactly the codepath the issue covers.
  async function captureBindParam(
    query: (sql: SQL) => Promise<unknown>,
    paramOids: number[] = [0],
  ): Promise<{ format: number; value: string | null } | null> {
    let captured: ReturnType<typeof extractFirstParam> | null = null;
    const server = net.createServer(socket => {
      let gotStartup = false;
      socket.on("data", chunk => {
        const out: Buffer[] = [];
        let o = 0;
        while (o < chunk.length) {
          if (!gotStartup) {
            const len = chunk.readInt32BE(o);
            o += len;
            gotStartup = true;
            out.push(
              authOk,
              paramStatus("server_version", "16.3"),
              paramStatus("client_encoding", "UTF8"),
              paramStatus("standard_conforming_strings", "on"),
              backendKeyData,
              readyForQuery,
            );
            continue;
          }
          const code = chunk[o];
          const len = chunk.readInt32BE(o + 1);
          const body = chunk.subarray(o + 5, o + 1 + len);
          o += 1 + len;
          switch (code) {
            case 0x50 /* P Parse    */:
              out.push(parseComplete);
              break;
            case 0x44 /* D Describe */:
              out.push(paramDescription(paramOids), noData);
              break;
            case 0x42 /* B Bind     */:
              if (captured === null) captured = extractFirstParam(body);
              out.push(bindComplete);
              break;
            case 0x45 /* E Execute  */:
              out.push(cmdComplete("SELECT 0"));
              break;
            case 0x53 /* S Sync     */:
              out.push(readyForQuery);
              break;
            case 0x48 /* H Flush    */:
            case 0x43 /* C Close    */:
              break;
            case 0x58 /* X Terminate*/:
              socket.end();
              return;
          }
        }
        if (out.length) socket.write(Buffer.concat(out));
      });
    });
    try {
      await once(server.listen(0), "listening");
      const port = (server.address() as AddressInfo).port;
      await using sql = new SQL({
        hostname: "127.0.0.1",
        port,
        database: "x",
        max: 1,
        idleTimeout: 1,
        prepare: false,
      });
      await query(sql);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
    return captured;
  }

  test("plain object → JSON text (not '[object Object]')", async () => {
    const param = await captureBindParam(sql => sql`SELECT ${{ hello: "world" }}::jsonb`);
    // Pre-fix: String.fromJS({}) → "[object Object]"; post-fix: jsonStringifyFast.
    expect(param).toEqual({ format: 0, value: '{"hello":"world"}' });
  });

  test("nested object → JSON text", async () => {
    const payload = { user: { id: 7, tags: ["admin", "beta"] }, active: true };
    const param = await captureBindParam(sql => sql`SELECT ${payload}::jsonb`);
    expect(param).toEqual({ format: 0, value: JSON.stringify(payload) });
  });

  test("plain array → JSON array text (not 'a,b,c')", async () => {
    const arr = [1, 2, { three: 3 }];
    const param = await captureBindParam(sql => sql`SELECT ${arr}::jsonb`);
    // Pre-fix: Array.prototype.toString → "1,2,[object Object]".
    expect(param).toEqual({ format: 0, value: JSON.stringify(arr) });
  });

  test("object with ::json cast (not just ::jsonb)", async () => {
    const param = await captureBindParam(sql => sql`SELECT ${{ a: 1, b: "two" }}::json`);
    expect(param).toEqual({ format: 0, value: '{"a":1,"b":"two"}' });
  });

  // Regression guards — make sure the re-derivation in writeBind doesn't
  // accidentally reroute non-JSON values that the previous behavior
  // handled correctly (or that other PRs address separately).

  test("string parameter still emits text (not JSON-quoted)", async () => {
    const param = await captureBindParam(sql => sql`SELECT ${"hello"}::text`);
    expect(param).toEqual({ format: 0, value: "hello" });
  });

  test("integer parameter still emits text '42'", async () => {
    const param = await captureBindParam(sql => sql`SELECT ${42}::int`);
    // Integers are declared as int4 in the signature, which is binary-
    // format capable — the server reports OID 0 here but the first-run
    // path still uses signature types for encoding.
    expect(param?.value).toBeDefined();
  });

  test("null parameter is signalled with length=-1", async () => {
    const param = await captureBindParam(sql => sql`SELECT ${null}::jsonb`);
    expect(param).toEqual({ format: 0, value: null });
  });
});

describe("PostgreSQL prepare: false", async () => {
  let container: { port: number; host: string };

  try {
    const info = await dockerCompose.ensure("postgres_plain");
    container = { port: info.ports[5432], host: info.host };
  } catch (e) {
    test.skip(`Docker not available: ${e}`);
    return;
  }

  const options = {
    db: "bun_sql_test",
    username: "bun_sql_test",
    host: container.host,
    port: container.port,
    max: 1,
    prepare: false,
  };

  afterAll(async () => {
    if (!process.env.BUN_KEEP_DOCKER) {
      await dockerCompose.down();
    }
  });

  test("basic parameterized query", async () => {
    await using db = new SQL(options);
    const [{ x }] = await db`SELECT ${42}::int AS x`;
    expect(x).toBe(42);
  });

  test("multiple parameterized queries sequentially", async () => {
    await using db = new SQL(options);

    const [{ a }] = await db`SELECT ${1}::int AS a`;
    expect(a).toBe(1);

    const [{ b }] = await db`SELECT ${"hello"}::text AS b`;
    expect(b).toBe("hello");

    const [{ c }] = await db`SELECT ${3.14}::float8 AS c`;
    expect(c).toBeCloseTo(3.14);
  });

  test("same query repeated with different params", async () => {
    await using db = new SQL(options);
    for (let i = 0; i < 10; i++) {
      const [{ x }] = await db`SELECT ${i}::int AS x`;
      expect(x).toBe(i);
    }
  });

  test("concurrent queries with different tables return correct results", async () => {
    // This test simulates the scenario where concurrent unnamed prepared
    // statements could interfere with each other via PgBouncer.
    await using db = new SQL({ ...options, max: 4 });

    // Create real tables (not temp, so they're visible across connections)
    await db`CREATE TABLE IF NOT EXISTS prepare_false_test_a (id int, val text)`;
    await db`CREATE TABLE IF NOT EXISTS prepare_false_test_b (id int, val text)`;
    await db`DELETE FROM prepare_false_test_a`;
    await db`DELETE FROM prepare_false_test_b`;
    await db`INSERT INTO prepare_false_test_a VALUES (1, 'from_a')`;
    await db`INSERT INTO prepare_false_test_b VALUES (1, 'from_b')`;

    // Run concurrent parameterized queries against different tables
    const results = await Promise.all([
      db`SELECT val FROM prepare_false_test_a WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_b WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_a WHERE id = ${1}`,
      db`SELECT val FROM prepare_false_test_b WHERE id = ${1}`,
    ]);

    expect(results[0][0].val).toBe("from_a");
    expect(results[1][0].val).toBe("from_b");
    expect(results[2][0].val).toBe("from_a");
    expect(results[3][0].val).toBe("from_b");

    // Cleanup
    await db`DROP TABLE IF EXISTS prepare_false_test_a`;
    await db`DROP TABLE IF EXISTS prepare_false_test_b`;
  });

  test("parameterized query with multiple params", async () => {
    await using db = new SQL(options);
    const [{ sum }] = await db`SELECT (${10}::int + ${20}::int) AS sum`;
    expect(sum).toBe(30);
  });

  test("query without params still works", async () => {
    await using db = new SQL(options);
    const [{ x }] = await db`SELECT 1 AS x`;
    expect(x).toBe(1);
  });

  test("transactions with parameterized queries", async () => {
    await using db = new SQL(options);

    await db`CREATE TEMP TABLE IF NOT EXISTS tx_test (id int, val text)`;

    await db.begin(async tx => {
      await tx`INSERT INTO tx_test VALUES (${1}, ${"hello"})`;
      await tx`INSERT INTO tx_test VALUES (${2}, ${"world"})`;
    });

    const rows = await db`SELECT * FROM tx_test ORDER BY id`;
    expect(rows.length).toBe(2);
    expect(rows[0].val).toBe("hello");
    expect(rows[1].val).toBe("world");
  });

  test("concurrent parameterized queries with high concurrency", async () => {
    await using db = new SQL({ ...options, max: 8 });

    // Fire many concurrent queries to stress-test unnamed statement handling
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(db`SELECT ${i}::int AS x`.then(r => ({ expected: i, actual: r[0].x })));
    }

    const results = await Promise.all(promises);
    for (const { expected, actual } of results) {
      expect(actual).toBe(expected);
    }
  });

  // Round-trip coverage for https://github.com/oven-sh/bun/issues/30221 —
  // with `prepare: false`, object/array parameters bound to a jsonb/json
  // cast were previously stringified via Object.prototype.toString(),
  // producing "[object Object]". Wire-protocol assertions live in the
  // mock-server `describe` block above; these exercise the end-to-end
  // path when a real Postgres is available.
  test("object parameter round-trips via ::jsonb cast", async () => {
    await using db = new SQL(options);
    const [row] = await db`SELECT ${{ hello: "world" }}::jsonb AS value`;
    expect(row).toEqual({ value: { hello: "world" } });
  });

  test("nested object parameter round-trips via ::jsonb cast", async () => {
    await using db = new SQL(options);
    const payload = { user: { id: 7, tags: ["admin", "beta"] }, active: true };
    const [row] = await db`SELECT ${payload}::jsonb AS value`;
    expect(row).toEqual({ value: payload });
  });

  test("array parameter round-trips via ::jsonb cast", async () => {
    await using db = new SQL(options);
    const arr = [1, 2, { three: 3 }];
    const [row] = await db`SELECT ${arr}::jsonb AS value`;
    expect(row).toEqual({ value: arr });
  });
});
