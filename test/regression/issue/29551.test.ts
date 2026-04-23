// https://github.com/oven-sh/bun/issues/29551
import { randomUUIDv7, SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "events";
import { describeWithContainer, isDockerEnabled } from "harness";
import net, { type AddressInfo } from "node:net";

const mkTable = () => "t_" + randomUUIDv7("hex").replaceAll("-", "");

// ─────────────────────────────────────────────────────────────────────────
// Wire-protocol assertions — run everywhere, no external service needed.
//
// A minimal PG backend that speaks just enough of the extended-query
// protocol to make `Bun.SQL` issue a Bind for a statement whose sole
// parameter the server declares (via ParameterDescription) to be a
// specific array OID. The test then inspects the raw parameter bytes
// the client placed in the Bind message.
//
// This is what #29551 is actually about: before the fix, `sql(object)`
// stringified a JS array with `String(["A","B"])` → `"A,B"`, which PG
// rejects as a malformed `text[]` literal. After the fix the client
// emits the text-format array literal `{"A","B"}`.
// ─────────────────────────────────────────────────────────────────────────
describe("issue #29551: sql(object) writes PG array literals to the wire", () => {
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
  const paramDescription = (oids: number[]) => msg("t", Buffer.concat([i16(oids.length), ...oids.map(i32)]));
  const noData = msg("n", Buffer.alloc(0));
  const bindComplete = msg("2", Buffer.alloc(0));
  const cmdComplete = (tag: string) => msg("C", cstr(tag));

  // Bind body: cstr portal, cstr stmt, i16 nFmt, i16[nFmt], i16 nParam,
  //            (i32 len, bytes)[nParam], i16 nResFmt, i16[nResFmt]
  function extractFirstParam(body: Buffer): string | null {
    let o = 0;
    while (body[o] !== 0) o++;
    o++;
    while (body[o] !== 0) o++;
    o++;
    const nFmt = body.readInt16BE(o);
    o += 2 + nFmt * 2;
    const nParam = body.readInt16BE(o);
    o += 2;
    if (nParam < 1) return null;
    const plen = body.readInt32BE(o);
    o += 4;
    if (plen < 0) return null;
    return body.subarray(o, o + plen).toString("utf8");
  }

  /// Stand up a one-shot mock PG backend that reports `paramOids` as the
  /// prepared statement's parameter types, captures the first value the
  /// client writes in its Bind message, and returns it.
  async function captureBindParam(paramOids: number[], value: unknown): Promise<string | null> {
    let captured: string | null = null;
    const server = net.createServer(socket => {
      let gotStartup = false;
      socket.on("data", chunk => {
        const out: Buffer[] = [];
        let o = 0;
        while (o < chunk.length) {
          if (!gotStartup) {
            // StartupMessage: i32 length, i32 protoVersion, (cstr key, cstr val)*, \0
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
              captured = extractFirstParam(body);
              out.push(bindComplete);
              break;
            case 0x45 /* E Execute  */:
              out.push(cmdComplete("INSERT 0 1"));
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
      await using sql = new SQL({ hostname: "127.0.0.1", port, database: "x", max: 1, idleTimeout: 1 });
      await sql`INSERT INTO t ${sql({ col: value })}`;
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
    return captured;
  }

  // PG array-type OIDs — https://www.postgresql.org/docs/current/datatype-oid.html
  const TEXT_ARRAY = 1009;
  const INT4_ARRAY = 1007;
  const BOOL_ARRAY = 1000;
  const JSONB_ARRAY = 3807;
  const BYTEA_ARRAY = 1001;
  const TIMESTAMPTZ_ARRAY = 1185;
  const JSONB = 3802;

  test("text[] column: JS string array → PG array literal", async () => {
    const param = await captureBindParam([TEXT_ARRAY], ["A", "B"]);
    // Pre-fix this was the comma-joined String(["A","B"]) → "A,B".
    expect(param).toBe('{"A","B"}');
  });

  test("int[] column: JS number array → PG array literal", async () => {
    const param = await captureBindParam([INT4_ARRAY], [10, 20, 30]);
    expect(param).toBe('{"10","20","30"}');
  });

  test("bool[] column: JS boolean array → {t,f}", async () => {
    const param = await captureBindParam([BOOL_ARRAY], [true, false, true]);
    expect(param).toBe("{t,f,t}");
  });

  test("jsonb[] column: object elements are JSON-stringified and quoted", async () => {
    const param = await captureBindParam([JSONB_ARRAY], [{ a: 1 }, { b: 2 }]);
    expect(param).toBe('{"{\\"a\\":1}","{\\"b\\":2}"}');
  });

  test("jsonb[] column: inner JS arrays stay 1-D (stringified as one jsonb element)", async () => {
    const param = await captureBindParam([JSONB_ARRAY], [[1, 2], [3]]);
    expect(param).toBe('{"[1,2]","[3]"}');
  });

  test("text[] column: special characters are escaped", async () => {
    const param = await captureBindParam([TEXT_ARRAY], ['has "quotes"', "has,comma", "has\\backslash", "has{braces}"]);
    expect(param).toBe('{"has \\"quotes\\"","has,comma","has\\\\backslash","has{braces}"}');
  });

  test("text[] column: null and undefined elements become unquoted NULL", async () => {
    const param = await captureBindParam([TEXT_ARRAY], ["a", null, undefined]);
    expect(param).toBe('{"a",null,null}');
  });

  test("bytea[] column: Buffer elements hex-encode as \\xHH", async () => {
    const param = await captureBindParam([BYTEA_ARRAY], [Buffer.from([1, 2, 3])]);
    expect(param).toBe('{"\\\\x010203"}');
  });

  test("timestamptz[] column: Date elements serialize as ISO 8601 UTC", async () => {
    const d = new Date("2024-01-02T03:04:05.678Z");
    const param = await captureBindParam([TIMESTAMPTZ_ARRAY], [d]);
    expect(param).toBe('{"2024-01-02T03:04:05.678Z"}');
  });

  test("timestamptz[] column: non-finite Date becomes NULL (not 'Invalid Date')", async () => {
    const param = await captureBindParam([TIMESTAMPTZ_ARRAY], [new Date("2024-01-01T00:00:00Z"), new Date(NaN)]);
    expect(param).toBe('{"2024-01-01T00:00:00.000Z",null}');
  });

  test("empty array → {}", async () => {
    const param = await captureBindParam([TEXT_ARRAY], []);
    expect(param).toBe("{}");
  });

  test("scalar jsonb column: JS array value still stringifies as JSON (not PG literal)", async () => {
    // Regression guard — when the server-inferred type is NOT an array
    // OID, `sql(object)` must fall through to the existing JSON path.
    const param = await captureBindParam([JSONB], ["a", "b"]);
    expect(param).toBe('["a","b"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Full round-trip against a real PostgreSQL server (CI / docker-compose).
// ─────────────────────────────────────────────────────────────────────────
if (isDockerEnabled()) {
  describeWithContainer(
    "issue #29551: sql(object) serializes JS arrays for PG array columns",
    {
      image: "postgres_plain",
      concurrent: true,
    },
    container => {
      let sql: SQL;

      beforeAll(async () => {
        await container.ready;
        sql = new SQL({
          url: `postgres://postgres@${container.host}:${container.port}/postgres`,
          max: 1,
        });
      });

      afterAll(async () => {
        await sql?.close();
      });

      test("reproduction from the issue: text[], text[], date columns via sql(object)", async () => {
        const tableName = mkTable();
        const payload = {
          licenses: ["A"],
          driver: ["B"],
          medical_checkup: "2024-01-01",
        };

        const rows = await sql.begin(async tx => {
          await tx`CREATE TEMP TABLE ${sql(tableName)} (
            licenses text[],
            driver text[],
            medical_checkup date
          )`;

          return await tx`
            INSERT INTO ${sql(tableName)} ${sql(payload)}
            RETURNING licenses, driver, medical_checkup
          `;
        });

        expect(rows[0].licenses).toEqual(["A"]);
        expect(rows[0].driver).toEqual(["B"]);
        expect(rows[0].medical_checkup).toBeInstanceOf(Date);
      });

      test("INSERT with sql(object) — text[], int[], bool[], empty array", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (
          tags text[],
          scores int[],
          flags bool[],
          empties text[]
        )`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({
          tags: ["a", "b", "c"],
          scores: [10, 20, 30],
          flags: [true, false, true],
          empties: [],
        })}`;

        const rows = await sql`SELECT tags, scores, flags, empties FROM ${sql(tableName)}`;
        expect(rows[0].tags).toEqual(["a", "b", "c"]);
        // `int[]` comes back in binary format as an `Int32Array` for single-col,
        // plain `Array` when interleaved with text-format columns. Compare values.
        expect(Array.from(rows[0].scores)).toEqual([10, 20, 30]);
        expect(rows[0].flags).toEqual([true, false, true]);
        expect(rows[0].empties).toEqual([]);
      });

      test("INSERT bulk rows where column values are JS arrays", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (id int, tags text[])`;

        const items = [
          { id: 1, tags: ["a", "b"] },
          { id: 2, tags: ["c"] },
          { id: 3, tags: [] },
        ];
        await sql`INSERT INTO ${sql(tableName)} ${sql(items)}`;

        const rows = await sql`SELECT id, tags FROM ${sql(tableName)} ORDER BY id`;
        expect(rows).toEqual([
          { id: 1, tags: ["a", "b"] },
          { id: 2, tags: ["c"] },
          { id: 3, tags: [] },
        ]);
      });

      test("UPDATE … SET ${sql({ col: [...] })} with an array value", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (id int PRIMARY KEY, roles text[])`;
        await sql`INSERT INTO ${sql(tableName)} VALUES (1, ${sql.array(["x"], "TEXT")})`;

        await sql`UPDATE ${sql(tableName)} SET ${sql({ roles: ["y", "z"] })} WHERE id = 1`;

        const rows = await sql`SELECT id, roles FROM ${sql(tableName)}`;
        expect(rows[0]).toEqual({ id: 1, roles: ["y", "z"] });
      });

      test("text[] elements with special characters are escaped", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (t text[])`;

        const tricky = ['has "quotes"', "has,comma", "has\\backslash", "has{braces}"];
        await sql`INSERT INTO ${sql(tableName)} ${sql({ t: tricky })}`;

        const rows = await sql`SELECT t FROM ${sql(tableName)}`;
        expect(rows[0].t).toEqual(tricky);
      });

      test("null elements in a text[]", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (t text[])`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({ t: ["a", null, "c", undefined] })}`;

        const rows = await sql`SELECT t FROM ${sql(tableName)}`;
        expect(rows[0].t).toEqual(["a", null, "c", null]);
      });

      test("null elements in int[] / float4[] round-trip via binary reader", async () => {
        // int4_array and float4_array are the only PG array types whose result
        // reader uses the binary-format path. Run the SELECT twice so the
        // prepared statement's cached RowDescription forces binary decoding
        // on the second call — that's where the NULL-rejection bug surfaced.
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (scores int[], weights float4[])`;
        await sql`INSERT INTO ${sql(tableName)} ${sql({
          scores: [10, null, 30],
          weights: [1.5, null, 3.25],
        })}`;

        for (let i = 0; i < 2; i++) {
          const [row] = await sql`SELECT scores, weights FROM ${sql(tableName)}`;
          expect(Array.from(row.scores)).toEqual([10, null, 30]);
          expect(Array.from(row.weights)).toEqual([1.5, null, 3.25]);
        }
      });

      test("numeric[] keeps unquoted numeric precision", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (n numeric[])`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({ n: [1.5, 2.7, -3.14] })}`;

        const rows = await sql`SELECT n FROM ${sql(tableName)}`;
        expect(rows[0].n).toEqual(["1.5", "2.7", "-3.14"]);
      });

      test("date[] and timestamptz[] accept JS Date objects", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (d date[], ts timestamptz[])`;

        const d1 = new Date("2024-01-01T00:00:00Z");
        const d2 = new Date("2024-02-02T12:30:00Z");
        await sql`INSERT INTO ${sql(tableName)} ${sql({ d: [d1, d2], ts: [d1, d2] })}`;

        const rows = await sql`SELECT d, ts FROM ${sql(tableName)}`;
        expect(rows[0].d.map((x: Date) => x.getUTCFullYear())).toEqual([2024, 2024]);
        expect(rows[0].ts[0].toISOString()).toBe(d1.toISOString());
        expect(rows[0].ts[1].toISOString()).toBe(d2.toISOString());
      });

      test("bytea[] with Buffer elements", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (b bytea[])`;

        const payload = [Buffer.from([1, 2, 3]), Buffer.from([4, 5])];
        await sql`INSERT INTO ${sql(tableName)} ${sql({ b: payload })}`;

        const rows = await sql`SELECT b FROM ${sql(tableName)}`;
        expect(rows[0].b).toEqual(payload);
      });

      test("jsonb[] with object elements", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (j jsonb[])`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({ j: [{ a: 1 }, { b: 2 }] })}`;

        const rows = await sql`SELECT j FROM ${sql(tableName)}`;
        expect(rows[0].j).toEqual([{ a: 1 }, { b: 2 }]);
      });

      test("uuid[] via sql(object)", async () => {
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (ids uuid[])`;

        const ids = ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"];
        await sql`INSERT INTO ${sql(tableName)} ${sql({ ids })}`;

        const rows = await sql`SELECT ids FROM ${sql(tableName)}`;
        expect(rows[0].ids).toEqual(ids);
      });

      test("non-finite Date element in date[] emits NULL", async () => {
        // new Date(NaN).toISOString() throws — fall back to SQL NULL rather
        // than "Invalid Date", which PG rejects as invalid date syntax.
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (d date[])`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({
          d: [new Date("2024-01-01T00:00:00Z"), new Date(NaN)],
        })}`;

        const rows = await sql`SELECT d FROM ${sql(tableName)}`;
        expect(rows[0].d).toHaveLength(2);
        expect(rows[0].d[0]).toBeInstanceOf(Date);
        expect(rows[0].d[1]).toBeNull();
      });

      test("jsonb[] elements that are themselves JS arrays stay 1-D", async () => {
        // A JS array inside a jsonb[] value must stringify as a single jsonb
        // element, not expand into a second PG array dimension.
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (j jsonb[])`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({
          j: [
            [1, 2],
            [3, 4],
          ],
        })}`;

        const [row] = await sql`SELECT j, array_ndims(j) as ndim, array_length(j, 1) as len FROM ${sql(tableName)}`;
        expect(row.j).toEqual([
          [1, 2],
          [3, 4],
        ]);
        expect(row.ndim).toBe(1);
        expect(row.len).toBe(2);
      });

      test("scalar jsonb column with JS array value still stringifies as JSON", async () => {
        // Tag-aware: non-array server-inferred types fall through to
        // jsonStringifyFast rather than emitting a PG array literal.
        const tableName = mkTable();
        await sql`CREATE TEMP TABLE ${sql(tableName)} (j jsonb)`;

        await sql`INSERT INTO ${sql(tableName)} ${sql({ j: ["a", "b"] })}`;

        const rows = await sql`SELECT j FROM ${sql(tableName)}`;
        expect(rows[0].j).toEqual(["a", "b"]);
      });
    },
  );
}
