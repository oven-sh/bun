// https://github.com/oven-sh/bun/issues/29551
import { randomUUIDv7, SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer(
  "issue #29551: sql(object) serializes JS arrays for PG array columns",
  {
    image: "postgres_plain",
    concurrent: true,
  },
  container => {
    let sql: SQL;
    const mkTable = () => "t_" + randomUUIDv7("hex").replaceAll("-", "");

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
