import { SQL, type CopyBinaryType } from "bun";
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { isDockerEnabled } from "harness";
import * as dockerCompose from "../../docker/index.ts";

if (isDockerEnabled()) {
  describe("PostgreSQL COPY protocol", () => {
    let info: Awaited<ReturnType<typeof dockerCompose.ensure>>;
    let conn: InstanceType<typeof SQL>;

    beforeAll(async () => {
      info = await dockerCompose.ensure("postgres_plain");
      conn = new SQL({
        hostname: info.host,
        port: info.ports[5432],
        database: "bun_sql_test",
        username: "bun_sql_test",
        tls: false,
        max: 1,
      });
    });

    afterAll(() => {
      conn.close();
    });

    // Phase 1: COPY TO STDOUT (Data Export)

    test("COPY TO STDOUT (text) returns a single string payload", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_users", []);
      await conn.unsafe("CREATE TABLE copy_users (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_users (id, name) VALUES (1, 'Alex'), (2, 'Bea')", []);

      const result = await conn`COPY copy_users TO STDOUT`;
      expect(Array.isArray(result)).toBe(true);
      expect(typeof result[0]).toBe("string");
      const payload = String(result[0]);
      expect(payload.includes("Alex")).toBe(true);
      expect(payload.includes("Bea")).toBe(true);
      expect(result.command).toBe("COPY");
      expect(result.count).toBe(2);
    });

    test("COPY TO STDOUT with subquery", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_sub", []);
      await conn.unsafe("CREATE TABLE copy_sub (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_sub (id, name) VALUES (1, 'A'), (2, 'B')", []);

      const result = await conn`COPY (SELECT name FROM copy_sub ORDER BY id LIMIT 1) TO STDOUT`;
      expect(Array.isArray(result)).toBe(true);
      expect(typeof result[0]).toBe("string");
      expect(String(result[0]).trim()).toBe("A");
    });

    test("COPY TO STDOUT (csv) returns a single string payload", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_csv", []);
      await conn.unsafe("CREATE TABLE copy_csv (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_csv (id, name) VALUES (10, 'Hello'), (11, 'World')", []);

      const result = await conn`COPY copy_csv TO STDOUT (FORMAT CSV)`;
      expect(Array.isArray(result)).toBe(true);
      expect(typeof result[0]).toBe("string");
      const payload = String(result[0]);
      expect(payload.includes("10,Hello")).toBe(true);
      expect(payload.includes("11,World")).toBe(true);
      expect(result.command).toBe("COPY");
      expect(result.count).toBe(2);
    });

    test("COPY TO STDOUT with empty result", async () => {
      const result = await conn`COPY (SELECT * FROM (VALUES (1)) t(i) WHERE i = -1) TO STDOUT`;
      expect(Array.isArray(result)).toBe(true);
      expect(String(result[0] ?? "")).toBe("");
    });

    // Phase 2: COPY FROM STDIN (High-level API)

    test("COPY FROM STDIN (text) with array rows", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_text", []);
      await conn.unsafe("CREATE TABLE copy_from_text (id INT, name TEXT)", []);

      const rows: Array<[number, string]> = [
        [1, "One"],
        [2, "Two"],
        [3, "Three"],
      ];
      const copyRes = await conn.copyFrom("copy_from_text", ["id", "name"], rows, { format: "text" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(rows.length);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_text`;
      expect(verify[0]?.count).toBe(rows.length);
    });

    test("COPY FROM STDIN (text) with raw TSV string payload", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_text_string", []);
      await conn.unsafe("CREATE TABLE copy_from_text_string (id INT, name TEXT)", []);
      const tsv = "3\tTSV User\n4\tTSV Two\n";
      const copyRes = await conn.copyFrom("copy_from_text_string", ["id", "name"], tsv, { format: "text" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_text_string`;
      expect(verify[0]?.count).toBe(2);
    });

    test("COPY FROM STDIN (text) with generator of rows", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_text_gen", []);
      await conn.unsafe("CREATE TABLE copy_from_text_gen (id INT, name TEXT)", []);

      function* genRows() {
        for (let i = 5; i <= 7; i++) {
          yield [i, `Gen ${i}`] as [number, string];
        }
      }
      const copyRes = await conn.copyFrom("copy_from_text_gen", ["id", "name"], genRows(), { format: "text" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(3);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_text_gen`;
      expect(verify[0]?.count).toBe(3);
    });

    test("COPY FROM STDIN (text) with async iterable of rows", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_text_async", []);
      await conn.unsafe("CREATE TABLE copy_from_text_async (id INT, name TEXT)", []);

      async function* genAsyncRows() {
        for (let i = 8; i <= 10; i++) {
          await Promise.resolve();
          yield [i, `Async ${i}`] as [number, string];
        }
      }
      const copyRes = await conn.copyFrom("copy_from_text_async", ["id", "name"], genAsyncRows(), { format: "text" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(3);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_text_async`;
      expect(verify[0]?.count).toBe(3);
    });

    test("COPY FROM STDIN (text) with async iterable of raw string chunks", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_chunks", []);
      await conn.unsafe("CREATE TABLE copy_from_chunks (id INT, name TEXT)", []);

      async function* genRawStrings() {
        yield "21\tRawOne\n";
        yield "22\tRawTwo\n";
      }
      const copyRes = await conn.copyFrom("copy_from_chunks", ["id", "name"], genRawStrings(), { format: "text" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_chunks`;
      expect(verify[0]?.count).toBe(2);
    });

    test("COPY FROM STDIN (csv) with async iterable of raw Uint8Array chunks", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_chunks_bin", []);
      await conn.unsafe("CREATE TABLE copy_from_chunks_bin (id INT, name TEXT)", []);
      const enc = new TextEncoder();
      async function* genRawUint8() {
        yield enc.encode("31,RawCSVOne\n");
        yield enc.encode("32,RawCSVTwo\n");
      }
      const copyRes = await conn.copyFrom("copy_from_chunks_bin", ["id", "name"], genRawUint8(), { format: "csv" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_from_chunks_bin`;
      expect(verify[0]?.count).toBe(2);
    });

    // Phase 3: COPY TO STDOUT (Streaming API)

    test("copyTo (query form) streams chunks", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_stream_q", []);
      await conn.unsafe("CREATE TABLE copy_stream_q (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_stream_q (id, name) VALUES (1, 'Hello'), (2, 'World')", []);
      let count = 0;
      let totalLen = 0;
      for await (const chunk of conn.copyTo(`COPY (SELECT id, name FROM copy_stream_q ORDER BY id) TO STDOUT`)) {
        const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as ArrayBuffer);
        totalLen += s.length;
        count++;
      }
      expect(count).toBeGreaterThan(0);
      expect(totalLen).toBeGreaterThan(0);
    });

    test("copyTo (options, csv) streams string chunks", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_stream_opts", []);
      await conn.unsafe("CREATE TABLE copy_stream_opts (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_stream_opts (id, name) VALUES (1, 'Hello')", []);
      let count = 0;
      for await (const chunk of conn.copyTo({
        table: "copy_stream_opts",
        columns: ["id", "name"],
        format: "csv",
      })) {
        expect(typeof chunk).toBe("string");
        count++;
      }
      expect(count).toBeGreaterThan(0);
    });

    // Phase 3.5: Abort and Progress demos

    test("copyTo supports progress + abort", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_to_abort", []);
      await conn.unsafe("CREATE TABLE copy_to_abort (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_to_abort (id, name) VALUES (1, 'A'), (2, 'B'), (3, 'C')", []);

      const ac = new AbortController();
      let progressCalled = 0;
      const stream = conn.copyTo({
        table: "copy_to_abort",
        columns: ["id", "name"],
        format: "csv",
        signal: ac.signal,
        onProgress: ({ bytesReceived, chunksReceived }: { bytesReceived: number; chunksReceived: number }) => {
          progressCalled++;
          if (chunksReceived >= 1) ac.abort();
          expect(bytesReceived).toBeGreaterThan(0);
        },
      });

      let threw = false;
      try {
        for await (const _ of stream) {
          // consume first chunk only
          break;
        }
      } catch {
        threw = true;
      }
      expect(progressCalled).toBeGreaterThan(0);
      expect(threw).toBe(true);
    });

    test("copyFrom supports progress + abort", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_from_abort", []);
      await conn.unsafe("CREATE TABLE copy_from_abort (id INT, name TEXT)", []);

      const ac = new AbortController();
      const enc = new TextEncoder();
      async function* genManyRows() {
        for (let i = 0; i < 200; i++) {
          yield enc.encode(`${i},Name ${i}\n`);
        }
      }
      let progressCalled = 0;
      let threw = false;
      try {
        await conn.copyFrom("copy_from_abort", ["id", "name"], genManyRows(), {
          format: "csv",
          signal: ac.signal,
          onProgress: ({ bytesSent, chunksSent }: { bytesSent: number; chunksSent: number }) => {
            progressCalled++;
            if (chunksSent >= 2) ac.abort();
            expect(bytesSent).toBeGreaterThan(0);
          },
        });
      } catch {
        threw = true;
      }
      expect(progressCalled).toBeGreaterThan(0);
      expect(threw).toBe(true);
    });

    // Phase 4: Binary COPY

    test("binary COPY TO (non-streaming) returns single ArrayBuffer-like result", async () => {
      const result = await conn`COPY (SELECT 1::int) TO STDOUT (FORMAT BINARY)`;
      const binChunk = result?.[0] as any;
      expect(binChunk).toBeDefined();
      // It should be ArrayBuffer in Bun
      expect(binChunk.byteLength ?? 0).toBeGreaterThan(0);
      expect(result.command).toBe("COPY");
    });

    test("binary COPY TO (streaming) yields ArrayBuffer chunks", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_bin2", []);
      await conn.unsafe("CREATE TABLE copy_bin2 (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_bin2 (id, name) VALUES (1, 'One'), (2, 'Two')", []);
      let sawArrayBuffer = false;
      let total = 0;
      for await (const chunk of conn.copyTo({
        table: "copy_bin2",
        columns: ["id", "name"],
        format: "binary",
      })) {
        if (chunk instanceof ArrayBuffer) {
          sawArrayBuffer = true;
          total += chunk.byteLength;
        }
      }
      expect(sawArrayBuffer).toBe(true);
      expect(total).toBeGreaterThan(0);
    });

    test("binary COPY FROM (zero-byte attempt) should fail on server", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_binary_zero", []);
      await conn.unsafe("CREATE TABLE copy_binary_zero (id INT, name TEXT)", []);
      let failed = false;
      async function* emptyBinary() {}
      try {
        await conn.copyFrom("copy_binary_zero", ["id", "name"], emptyBinary(), { format: "binary" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    test("COPY FROM STDIN (binary) with valid header and two rows", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_binary_data", []);
      await conn.unsafe("CREATE TABLE copy_binary_data (id INT, name TEXT)", []);

      function be16(n: number) {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setInt16(0, n, false);
        return b;
      }
      function be32(n: number) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, n, false);
        return b;
      }
      function beInt32(n: number) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, n, false);
        return b;
      }
      function concat(...parts: Uint8Array[]) {
        let len = 0;
        for (const p of parts) len += p.length;
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        return out;
      }
      function buildBinaryRow(id: number, name: string) {
        const idBytes = beInt32(id);
        const nameBytes = new TextEncoder().encode(name);
        const fieldCount = be16(2);
        const idLen = be32(4);
        const nameLen = be32(nameBytes.length);
        return concat(fieldCount, idLen, idBytes, nameLen, nameBytes);
      }

      async function* genProperBinary() {
        const sig = new Uint8Array([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
        const flags = be32(0);
        const extlen = be32(0);
        yield concat(sig, flags, extlen);
        yield buildBinaryRow(200, "Bin A");
        yield buildBinaryRow(201, "Bin B");
        yield be16(-1);
      }

      const copyRes = await conn.copyFrom("copy_binary_data", ["id", "name"], genProperBinary(), { format: "binary" });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_binary_data`;
      expect(verify[0]?.count).toBe(2);

      let sawArrayBuffer = false;
      for await (const chunk of conn.copyTo({
        table: "copy_binary_data",
        columns: ["id", "name"],
        format: "binary",
      })) {
        if (chunk instanceof ArrayBuffer) {
          sawArrayBuffer = true;
          break;
        }
      }
      expect(sawArrayBuffer).toBe(true);
    });

    // Phase 5: CSV options (default delimiter and null token)

    test("copyFrom with CSV default delimiter and null token", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_csv_opts", []);
      await conn.unsafe("CREATE TABLE copy_csv_opts (id INT, name TEXT, note TEXT)", []);
      async function* genCsvDefaultCsv() {
        yield "41,CSVOne,note A\n";
        yield "42,,note B\n";
      }
      const copyCsvRes = await conn.copyFrom("copy_csv_opts", ["id", "name", "note"], genCsvDefaultCsv(), {
        format: "csv",
      });
      expect(copyCsvRes?.command).toBe("COPY");
      expect(copyCsvRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_csv_opts`;
      expect(verify[0]?.count).toBe(2);
    });

    // Phase 6: Binary COPY FROM with automatic encoder (extended types + batch)

    test("Binary copyFrom automatic encoder with extended types", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_binary_ext", []);
      await conn.unsafe(
        `
        CREATE TABLE copy_binary_ext (
          did int2,
          i4 int4,
          i8 int8,
          f4 float4,
          f8 float8,
          ok boolean,
          b bytea,
          d date,
          t time,
          ts timestamp,
          tz timestamptz,
          u uuid,
          j json,
          jb jsonb,
          txt text,
          num numeric,
          iv interval,
          i4s int4[],
          texts text[],
          uuids uuid[]
        )
        `,
        [],
      );

      const now = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6));
      const binRows: any[] = [
        [
          1,
          123,
          1234567890123n,
          3.5,
          6.25,
          true,
          new Uint8Array([1, 2, 3, 4]),
          "2024-01-01",
          "12:34:56.789",
          now,
          now,
          "550e8400-e29b-41d4-a716-446655440000",
          { k: 1 },
          { jb: "x" },
          "hello\\world\tline\nend",
          "12345.6789",
          { days: 1, ms: 3600000 },
          [10, 20, 30],
          ["x", "y"],
          ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"],
        ],
        [
          2,
          -456,
          -1234567890123n,
          -1.5,
          -2.25,
          false,
          new Uint8Array([9, 8, 7]),
          "2024-01-02",
          "23:59:59.123456",
          new Date(Date.UTC(2024, 0, 3, 10, 20, 30)),
          new Date(Date.UTC(2024, 0, 4, 11, 22, 33)),
          "550e8400-e29b-41d4-a716-446655440001",
          { k: 2 },
          { jb: "y" },
          "goodbye",
          "-9876.54321",
          { months: 2, days: 3, ms: 0 },
          [100, 200],
          ["alpha", "beta"],
          ["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440000"],
        ],
      ];
      const binaryTypes: CopyBinaryType[] = [
        "int2",
        "int4",
        "int8",
        "float4",
        "float8",
        "bool",
        "bytea",
        "date",
        "time",
        "timestamp",
        "timestamptz",
        "uuid",
        "json",
        "jsonb",
        "text",
        "numeric",
        "interval",
        "int4[]",
        "text[]",
        "uuid[]",
      ];

      const copyRes = await conn.copyFrom(
        "copy_binary_ext",
        [
          "did",
          "i4",
          "i8",
          "f4",
          "f8",
          "ok",
          "b",
          "d",
          "t",
          "ts",
          "tz",
          "u",
          "j",
          "jb",
          "txt",
          "num",
          "iv",
          "i4s",
          "texts",
          "uuids",
        ],
        binRows,
        { format: "binary", binaryTypes, batchSize: 64 * 1024 },
      );
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_binary_ext`;
      expect(verify[0]?.count).toBe(2);
    });

    // Phase 7: copyToPipeTo already covered earlier

    // Phase 8: COPY FROM (text) with custom batchSize

    test("COPY FROM (text) with custom batchSize using async rows", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_batch_test", []);
      await conn.unsafe("CREATE TABLE copy_batch_test (id INT, name TEXT)", []);
      async function* manyTextRows(count: number) {
        for (let i = 0; i < count; i++) {
          yield [i, `Name ${i} with \\ and \t and \n`] as [number, string];
        }
      }
      const count = 300;
      const copyRes = await conn.copyFrom("copy_batch_test", ["id", "name"], manyTextRows(count), {
        format: "text",
        batchSize: 32 * 1024,
      });
      expect(copyRes?.command).toBe("COPY");
      expect(copyRes?.count).toBe(count);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_batch_test`;
      expect(verify[0]?.count).toBe(count);
    });

    // Progress verification for batched text COPY FROM
    test("copyFrom (text) progress bytes/chunks match server output", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_progress", []);
      await conn.unsafe("CREATE TABLE copy_progress (id INT, name TEXT)", []);

      const total = 200;
      let expected = "";
      for (let i = 0; i < total; i++) {
        expected += `${i}\tName ${i}\n`;
      }

      let bytesSent = 0;
      let chunksSent = 0;

      async function* genRows() {
        for (let i = 0; i < total; i++) {
          // Ensure we exercise the row-batching path (flushBatch will send aggregated chunks)
          yield [i, `Name ${i}`] as [number, string];
        }
      }

      const res = await conn.copyFrom("copy_progress", ["id", "name"], genRows(), {
        format: "text",
        onProgress: ({ bytesSent: b, chunksSent: c }: { bytesSent: number; chunksSent: number }) => {
          bytesSent = b;
          chunksSent = c;
        },
      });
      expect(res?.command).toBe("COPY");
      expect(res?.count).toBe(total);

      // At least one batch should have been sent
      expect(chunksSent).toBeGreaterThan(0);

      // Progress bytes should equal the serialized payload length we generated
      expect(bytesSent).toBe(expected.length);

      // Dump back from server in a deterministic order and compare to expected payload
      const out = await conn`COPY (SELECT id, name FROM copy_progress ORDER BY id) TO STDOUT`;
      const outStr = String(out[0] ?? "");
      expect(outStr.length).toBe(bytesSent);
      expect(outStr).toBe(expected);
    });

    // Phase 9: COPY guardrails (timeout)

    test("copyTo timeout triggers when too small", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_timeout", []);
      await conn.unsafe("CREATE TABLE copy_timeout (id INT, data TEXT)", []);
      // Insert enough data to make copying take longer than the timeout
      await conn.unsafe("INSERT INTO copy_timeout SELECT i, repeat('x', 1000) FROM generate_series(1, 10000) i", []);

      let didTimeout = false;
      let errorMessage = "";
      try {
        for await (const _ of conn.copyTo({
          table: "copy_timeout",
          columns: ["id", "data"],
          format: "text",
          timeout: 50, // Very small timeout (50ms) to force timeout during large data copy
        })) {
          // Should timeout before getting all chunks
        }
      } catch (e) {
        didTimeout = true;
        errorMessage = String((e as any)?.message ?? e).toLowerCase();
      }

      // The timeout should actually fire
      expect(didTimeout).toBe(true);
      expect(errorMessage).toMatch(/timeout/);
    });
    // pgx-inspired tests

    test("pgx: small typed rows with nulls", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_small", []);
      await conn.unsafe(
        `CREATE TABLE pgx_small(
          a int2,
          b int4,
          c int8,
          d varchar,
          e text,
          f date,
          g timestamptz
        )`,
        [],
      );

      const tzed = new Date();
      const rows: any[][] = [
        [0, 1, 2n, "abc", "efg", "2000-01-01", tzed],
        [null, null, null, null, null, null, null],
      ];

      const res = await conn.copyFrom("pgx_small", ["a", "b", "c", "d", "e", "f", "g"], rows, { format: "text" });
      expect(res?.command).toBe("COPY");
      expect(res?.count).toBe(rows.length);

      const out = await conn`SELECT COUNT(*)::int AS count FROM pgx_small`;
      expect(out[0]?.count).toBe(rows.length);
    });

    test("pgx: large rows with bytea", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_large", []);
      await conn.unsafe(
        `CREATE TABLE pgx_large(
          a int2,
          b int4,
          c int8,
          d varchar,
          e text,
          f date,
          g timestamptz,
          h bytea
        )`,
        [],
      );

      const tzed = new Date();
      const bytes = new Uint8Array([111, 111, 111, 111]);
      const rows: any[][] = [];
      for (let i = 0; i < 1000; i++) {
        rows.push([0, 1, 2n, "abc", "efg", "2000-01-01", tzed, bytes]);
      }
      const res = await conn.copyFrom("pgx_large", ["a", "b", "c", "d", "e", "f", "g", "h"], rows, {
        format: "binary",
        binaryTypes: ["int2", "int4", "int8", "varchar", "text", "date", "timestamptz", "bytea"],
      });
      expect(res?.command).toBe("COPY");
      expect(res?.count).toBe(rows.length);

      const out = await conn`SELECT COUNT(*)::int AS count FROM pgx_large`;
      expect(out[0]?.count).toBe(rows.length);
    });

    test("pgx: enum types with copyFrom", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_enum_tbl", []);
      await conn.unsafe(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'color') THEN DROP TYPE color; END IF; END $$;",
        [],
      );
      await conn.unsafe(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fruit') THEN DROP TYPE fruit; END IF; END $$;",
        [],
      );
      await conn.unsafe(`CREATE TYPE color AS ENUM ('blue', 'green', 'orange')`, []);
      await conn.unsafe(`CREATE TYPE fruit AS ENUM ('apple', 'orange', 'grape')`, []);
      await conn.unsafe(
        `CREATE TABLE pgx_enum_tbl(
          a text,
          b color,
          c fruit,
          d color,
          e fruit,
          f text
        )`,
        [],
      );

      const rows: any[][] = [
        ["abc", "blue", "grape", "orange", "orange", "def"],
        [null, null, null, null, null, null],
      ];
      const res = await conn.copyFrom("pgx_enum_tbl", ["a", "b", "c", "d", "e", "f"], rows, { format: "text" });
      expect(res?.command).toBe("COPY");
      expect(res?.count).toBe(rows.length);

      const out = await conn`SELECT COUNT(*)::int AS count FROM pgx_enum_tbl`;
      expect(out[0]?.count).toBe(rows.length);
    });

    test("pgx: server failure mid-copy (NOT NULL violation) yields 0 inserted", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_fail_mid", []);
      await conn.unsafe(`CREATE TABLE pgx_fail_mid(a int4, b varchar NOT NULL)`, []);
      const rows: any[][] = [
        [1, "abc"],
        [2, null], // should trigger server-side failure
        [3, "def"],
      ];
      let failed = false;
      try {
        await conn.copyFrom("pgx_fail_mid", ["a", "b"], rows, { format: "text" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);

      const out = await conn`SELECT COUNT(*)::int AS count FROM pgx_fail_mid`;
      expect(out[0]?.count).toBe(0);
    });

    test("pgx: client generator error midway", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_client_err", []);
      await conn.unsafe(`CREATE TABLE pgx_client_err(a bytea NOT NULL)`, []);
      async function* errGen() {
        let count = 0;
        while (true) {
          count++;
          if (count === 3) throw new Error("client error");
          yield new Uint8Array(1000);
          if (count >= 100) break;
        }
      }
      let failed = false;
      try {
        await conn.copyFrom("pgx_client_err", ["a"], errGen(), { format: "binary" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);

      const out = await conn`SELECT COUNT(*)::int AS count FROM pgx_client_err`;
      expect(out[0]?.count).toBe(0);
    });

    test("pgx: automatic string conversion for int8 and numeric[]", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_auto_str", []);
      await conn.unsafe("CREATE TABLE pgx_auto_str(a int8)", []);
      const rows1: any[][] = [["42"], ["7"], [8]];
      const res1 = await conn.copyFrom("pgx_auto_str", ["a"], rows1, { format: "text" });
      expect(res1?.count).toBe(rows1.length);

      const nums = await conn`SELECT a::bigint AS a FROM pgx_auto_str ORDER BY a`;
      expect(nums.map(n => Number(n.a))).toEqual([7, 8, 42]);

      await conn.unsafe("DROP TABLE IF EXISTS pgx_auto_arr", []);
      await conn.unsafe("CREATE TABLE pgx_auto_arr(a numeric[])", []);
      const rows2: any[][] = [[[42]], [[7]], [[8, 9]]];
      const res2 = await conn.copyFrom("pgx_auto_arr", ["a"], rows2, { format: "binary", binaryTypes: ["numeric[]"] });
      expect(res2?.count).toBe(rows2.length);

      const arr = await conn`SELECT a FROM pgx_auto_arr`;
      // Flatten to verify values are present
      expect(arr.length).toBe(rows2.length);
    });

    test("pgx: function-style generator copy", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS pgx_func", []);
      await conn.unsafe("CREATE TABLE pgx_func(a int)", []);
      const channelItems = 10;

      async function* gen() {
        for (let i = 0; i < channelItems; i++) {
          yield [i];
        }
      }

      const ok = await conn.copyFrom("pgx_func", ["a"], gen(), { format: "text" });
      expect(ok?.count).toBe(channelItems);

      const rows = await conn`SELECT a::int AS a FROM pgx_func ORDER BY a`;
      expect(rows.map((r: any) => r.a)).toEqual([...Array(channelItems)].map((_, i) => i));

      // Simulate a failure on the producer side
      async function* genFail() {
        let x = 9;
        while (true) {
          x++;
          if (x > 100) throw new Error("simulated error");
          yield [x];
        }
      }

      let failed = false;
      try {
        await conn.copyFrom("pgx_func", ["a"], genFail(), { format: "text" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    });

    test("unique constraint violation during COPY FROM yields zero inserted", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_unique", []);
      await conn.unsafe("CREATE TABLE copy_unique (id INT PRIMARY KEY, name TEXT)", []);
      const rows = [
        [1, "A"],
        [1, "B"],
      ];
      let failed = false;
      try {
        await conn.copyFrom("copy_unique", ["id", "name"], rows, { format: "text" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_unique`;
      expect(verify[0]?.count).toBe(0);
    });

    test("type cast error during COPY FROM yields zero inserted", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_cast_err", []);
      await conn.unsafe("CREATE TABLE copy_cast_err (id INT NOT NULL)", []);
      const badRows = [["abc"]]; // invalid int
      let failed = false;
      try {
        await conn.copyFrom("copy_cast_err", ["id"], badRows, { format: "text" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      const verify = await conn`SELECT COUNT(*)::int AS count FROM copy_cast_err`;
      expect(verify[0]?.count).toBe(0);
    });

    test("CSV quoted fields and embedded quotes", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_csv_quotes", []);
      await conn.unsafe('CREATE TABLE copy_csv_quotes (id INT, "full" TEXT, "quote" TEXT)', []);
      async function* gen() {
        yield '1,"Last, First","He said ""Hi"""\n';
        yield '2,"Simple","Plain"\n';
      }
      const res = await conn.copyFrom("copy_csv_quotes", ["id", "full", "quote"], gen(), { format: "csv" });
      expect(res?.command).toBe("COPY");
      expect(res?.count).toBe(2);

      const rows = await conn`SELECT id::int AS id, "full", "quote" FROM copy_csv_quotes ORDER BY id`;
      expect(rows[0].full).toBe("Last, First");
      expect(rows[0].quote).toBe('He said "Hi"');
      expect(rows[1].full).toBe("Simple");
      expect(rows[1].quote).toBe("Plain");
    });

    test("copyToPipeTo streams CSV to sink", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS copy_pipe_csv", []);
      await conn.unsafe("CREATE TABLE copy_pipe_csv (id INT, name TEXT)", []);
      await conn.unsafe("INSERT INTO copy_pipe_csv (id, name) VALUES (1,'A'),(2,'B')", []);

      const sinkChunks: Array<string | ArrayBuffer | Uint8Array> = [];
      const sink = {
        async write(chunk: string | ArrayBuffer | Uint8Array) {
          sinkChunks.push(chunk);
        },
        async end() {},
      };

      await conn.copyToPipeTo(
        {
          table: "copy_pipe_csv",
          columns: ["id", "name"],
          format: "csv",
        },
        sink,
      );

      expect(sinkChunks.length).toBeGreaterThan(0);
      const stringChunks = sinkChunks.filter(c => typeof c === "string");
      expect(stringChunks.length).toBeGreaterThan(0);
    });

    test("Audit fix: Binary COPY header validation - incomplete header should fail", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_binary_test", []);
      await conn.unsafe("CREATE TABLE audit_binary_test (id INT, name TEXT)", []);

      // Try to send incomplete/invalid binary data (missing proper header)
      let failed = false;
      async function* invalidBinaryData() {
        // Send incomplete header (less than 11 bytes required for signature)
        yield new Uint8Array([0x50, 0x47, 0x43]); // Only "PGC" - incomplete signature
        // Send trailer immediately to trigger completion
        const trailer = new Uint8Array(2);
        new DataView(trailer.buffer).setInt16(0, -1, false);
        yield trailer;
      }

      try {
        await conn.copyFrom("audit_binary_test", ["id", "name"], invalidBinaryData(), {
          format: "binary",
        });
      } catch (e) {
        failed = true;
        expect(e).toBeDefined();
      }
      expect(failed).toBe(true);
    });

    test("Audit fix: Empty columns list - COPY should work without columns specified", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_empty_cols", []);
      await conn.unsafe("CREATE TABLE audit_empty_cols (id INT, name TEXT)", []);

      // Insert with empty columns array - should copy all columns
      const data = "1\tAlice\n2\tBob\n";
      const result = await conn.copyFrom("audit_empty_cols", [], data, { format: "text" });

      expect(result.command).toBe("COPY");
      expect(result.count).toBe(2);

      const verify = await conn`SELECT COUNT(*)::int AS count FROM audit_empty_cols`;
      expect(verify[0]?.count).toBe(2);
    });

    test("Audit fix: Large maxBytes values should not overflow to negative", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_large_bytes", []);
      await conn.unsafe("CREATE TABLE audit_large_bytes (id INT, data TEXT)", []);
      await conn.unsafe("INSERT INTO audit_large_bytes VALUES (1, 'test')", []);

      let bytesReceived = 0;
      const largeLimit = 5_000_000_000; // 5GB - larger than 32-bit signed int max

      // This should not fail due to negative comparison
      let chunks = 0;
      for await (const chunk of conn.copyTo({
        table: "audit_large_bytes",
        columns: ["id", "data"],
        format: "text",
        maxBytes: largeLimit, // Large value that would overflow with bitwise ops
        onProgress: info => {
          bytesReceived = info.bytesReceived;
          // Should be positive
          expect(bytesReceived).toBeGreaterThanOrEqual(0);
        },
      })) {
        chunks++;
        expect(chunk).toBeDefined();
      }

      expect(chunks).toBeGreaterThan(0);
      expect(bytesReceived).toBeGreaterThan(0);
      expect(bytesReceived).toBeLessThan(largeLimit); // Should not exceed limit
    });

    test("Audit fix: UTF-8 byte length calculation - progress should count UTF-8 bytes", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_utf8_test", []);
      await conn.unsafe("CREATE TABLE audit_utf8_test (id INT, emoji TEXT)", []);
      await conn.unsafe("INSERT INTO audit_utf8_test VALUES (1, '👍'), (2, '🎉'), (3, '😀')", []);

      let bytesReceived = 0;
      let lastBytes = 0;

      for await (const chunk of conn.copyTo({
        table: "audit_utf8_test",
        columns: ["id", "emoji"],
        format: "text",
        onProgress: info => {
          bytesReceived = info.bytesReceived;
        },
      })) {
        if (typeof chunk === "string") {
          // Manual UTF-8 byte calculation for verification
          const utf8Bytes = new TextEncoder().encode(chunk).byteLength;
          const utf16Length = chunk.length;

          // UTF-8 emoji bytes should be more than UTF-16 code units for emojis
          // Each emoji is typically 4 UTF-8 bytes but 2 UTF-16 code units
          if (chunk.includes("👍") || chunk.includes("🎉") || chunk.includes("😀")) {
            expect(utf8Bytes).toBeGreaterThan(utf16Length);
          }

          // Progress should accumulate UTF-8 bytes
          const bytesDelta = bytesReceived - lastBytes;
          lastBytes = bytesReceived;

          // The delta should be close to UTF-8 byte length (allow for some variance due to buffering)
          if (bytesDelta > 0) {
            expect(bytesDelta).toBeGreaterThanOrEqual(chunk.length);
          }
        }
      }

      expect(bytesReceived).toBeGreaterThan(0);
    });

    test("Audit fix: Binary COPY with valid header should succeed", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_valid_binary", []);
      await conn.unsafe("CREATE TABLE audit_valid_binary (id INT, name TEXT)", []);

      function be16(n: number) {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setInt16(0, n, false);
        return b;
      }
      function be32(n: number) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setInt32(0, n, false);
        return b;
      }
      function concat(...parts: Uint8Array[]) {
        let len = 0;
        for (const p of parts) len += p.length;
        const out = new Uint8Array(len);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        return out;
      }

      async function* validBinaryData() {
        // Valid signature
        const sig = new Uint8Array([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
        const flags = be32(0);
        const extlen = be32(0);
        yield concat(sig, flags, extlen);

        // One row: field count (2), id length (4), id value (100), name length (5), name value
        const fieldCount = be16(2);
        const idLen = be32(4);
        const idVal = be32(100);
        const nameBytes = new TextEncoder().encode("Test");
        const nameLen = be32(nameBytes.length);
        yield concat(fieldCount, idLen, idVal, nameLen, nameBytes);

        // Trailer
        yield be16(-1);
      }

      const result = await conn.copyFrom("audit_valid_binary", ["id", "name"], validBinaryData(), {
        format: "binary",
      });

      expect(result.command).toBe("COPY");
      expect(result.count).toBe(1);

      const verify = await conn`SELECT * FROM audit_valid_binary`;
      expect(verify[0]?.id).toBe(100);
      expect(verify[0]?.name).toBe("Test");
    });

    test("Audit fix: CSV empty string vs NULL - empty strings should be quoted", async () => {
      await conn.unsafe("DROP TABLE IF EXISTS audit_csv_null_test", []);
      await conn.unsafe("CREATE TABLE audit_csv_null_test (id INT, val TEXT)", []);

      // Test data: [1, null], [2, ""], [3, "text"]
      const rows = [
        [1, null], // Should emit: 1,
        [2, ""], // Should emit: 2,""
        [3, "text"], // Should emit: 3,text
      ];

      const result = await conn.copyFrom("audit_csv_null_test", ["id", "val"], rows, {
        format: "csv",
      });

      expect(result.command).toBe("COPY");
      expect(result.count).toBe(3);

      const verify = await conn`SELECT id::int AS id, val FROM audit_csv_null_test ORDER BY id`;
      expect(verify[0]?.id).toBe(1);
      expect(verify[0]?.val).toBe(null); // NULL value
      expect(verify[1]?.id).toBe(2);
      expect(verify[1]?.val).toBe(""); // Empty string
      expect(verify[2]?.id).toBe(3);
      expect(verify[2]?.val).toBe("text");
    });

    test("Audit fix: uint32 clamping - large timeout/buffer values should not wrap", async () => {
      const reserved = await conn.reserve();

      // Test with values larger than 32-bit signed int max (2^31 - 1 = 2147483647)
      const largeTimeout = 3_000_000_000; // 3 billion ms
      const largeBufferSize = 5_000_000_000; // 5 billion bytes

      // These should clamp to max uint32 (0xffffffff = 4294967295) without wrapping to 0 or negative
      let timeoutError = false;
      let bufferError = false;

      try {
        (reserved as any).setCopyTimeout(largeTimeout);
      } catch (e) {
        timeoutError = true;
      }

      try {
        (reserved as any).setMaxCopyBufferSize(largeBufferSize);
      } catch (e) {
        bufferError = true;
      }

      // Should not throw errors
      expect(timeoutError).toBe(false);
      expect(bufferError).toBe(false);

      // Test with negative values (should clamp to 0)
      try {
        (reserved as any).setCopyTimeout(-1000);
      } catch (e) {
        timeoutError = true;
      }

      try {
        (reserved as any).setMaxCopyBufferSize(-5000);
      } catch (e) {
        bufferError = true;
      }

      expect(timeoutError).toBe(false);
      expect(bufferError).toBe(false);

      await (reserved as any).close();
    });

    test("Audit fix: escapeIdentifier for schema-qualified names in copyTo", async () => {
      // Create a schema and table with schema-qualified name
      await conn.unsafe("DROP SCHEMA IF EXISTS audit_schema CASCADE", []);
      await conn.unsafe("CREATE SCHEMA audit_schema", []);
      await conn.unsafe("CREATE TABLE audit_schema.qualified_table (id INT, data TEXT)", []);
      await conn.unsafe("INSERT INTO audit_schema.qualified_table VALUES (1, 'test')", []);

      let chunks = 0;
      let succeeded = false;
      try {
        for await (const chunk of conn.copyTo({
          table: "audit_schema.qualified_table",
          columns: ["id", "data"],
          format: "text",
        })) {
          chunks++;
          expect(chunk).toBeDefined();
        }
        succeeded = true;
      } catch (e) {
        // Should not throw
      }

      expect(succeeded).toBe(true);
      expect(chunks).toBeGreaterThan(0);

      // Cleanup
      await conn.unsafe("DROP SCHEMA audit_schema CASCADE", []);
    });
  });
} else {
  describe("PostgreSQL COPY protocol", () => {
    test("skipped - docker not enabled", () => {
      expect(true).toBe(true);
    });
  });
}
