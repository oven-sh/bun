// Binding a JS value to a parameter the server types as `bytea` (OID 17).
// Bun sends bytea in binary format, so the value needs a byte representation:
// a Buffer / TypedArray / ArrayBuffer (raw bytes) or a string (sent as text,
// parsed by the server). Anything else (a `number[]` of bytes, a
// JSON-revived `{ type: "Buffer", data }`, a Date, a plain object) used to be
// written as a zero-length value and stored as `\x` with no error.
//
// The rejection is raised while the Bind message is being encoded, so it also
// covers the general rule that a parameter which fails to encode rejects only
// its own query and leaves the connection (and anything queued on it) alone.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = (options: { prepare?: boolean } = {}) =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      ...options,
    });

  const rejected: [string, unknown, string][] = [
    ["number[]", [1, 2, 3], "an instance of Array"],
    ["JSON-revived Buffer", JSON.parse(JSON.stringify(Buffer.from([1, 2]))), "an instance of Object"],
    ["Date", new Date(0), "an instance of Date"],
    ["plain object", { a: 1 }, "an instance of Object"],
  ];

  test.each(rejected)("%s bound to a bytea parameter rejects", async (_, value, received) => {
    await container.ready;
    await using sql = connect();
    const err: any = await sql`select ${value}::bytea as x`.then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(
      `Query parameter $1 of type bytea must be a Buffer, TypedArray, ArrayBuffer or string. Received ${received}`,
    );
  });

  test("the error names the position of the offending parameter", async () => {
    await container.ready;
    await using sql = connect();
    const err: any = await sql.unsafe("select $1::int4 as a, $2::bytea as b", [7, [1, 2, 3]]).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toStartWith("Query parameter $2 of type bytea must be");
  });

  test("BufferSource, string and null values bound to a bytea parameter round-trip", async () => {
    await container.ready;
    await using sql = connect();
    const hex = async (value: unknown) => {
      const [row] = await sql`select encode(${value}::bytea, 'hex') as hex`;
      return row.hex;
    };
    expect(await hex(new Uint8Array([1, 2, 3]))).toBe("010203");
    expect(await hex(Buffer.from([4, 5]))).toBe("0405");
    expect(await hex(new Uint8Array([6, 7, 8, 9]).buffer)).toBe("06070809");
    expect(await hex(new Uint8Array([0, 10, 11, 0]).subarray(1, 3))).toBe("0a0b");
    expect(await hex(new Uint8Array(0))).toBe("");
    expect(await hex("\\x0c0d")).toBe("0c0d");
    expect(await hex(null)).toBe(null);
  });

  // A parameter is encoded while the Bind message is being written, for a named
  // statement after its Parse/Describe already went out (prepare: false writes
  // Parse and Bind in one batch). When encoding throws, the partial message
  // must not stay in the connection's write buffer: the next message would
  // complete it into a garbage frame and the server would close the socket,
  // failing the next query, every pipelined sibling and any open transaction
  // with ERR_POSTGRES_CONNECTION_CLOSED.
  const failsToEncode: [string, { prepare?: boolean }, (sql: SQL) => Promise<unknown>, object][] = [
    ["a number[] bound to bytea", {}, sql => sql`select ${[1, 2, 3]}::bytea as x`, { code: "ERR_INVALID_ARG_TYPE" }],
    [
      "a jsonb value whose toJSON throws",
      {},
      sql =>
        sql`select ${{
          toJSON() {
            throw new Error("toJSON threw");
          },
        }}::jsonb as x`,
      { message: "toJSON threw" },
    ],
    [
      "a text value whose toString throws",
      {},
      sql =>
        sql`select ${{
          toString() {
            throw new Error("toString threw");
          },
        }}::text as x`,
      { message: "toString threw" },
    ],
    [
      "a text value whose toString throws (prepare: false)",
      { prepare: false },
      sql =>
        sql`select ${{
          toString() {
            throw new Error("toString threw");
          },
        }}::text as x`,
      { message: "toString threw" },
    ],
  ];

  test.each(failsToEncode)("rejecting %s leaves the connection usable", async (_, options, query, expected) => {
    await container.ready;
    await using sql = connect(options);
    const [{ pid }] = await sql`select pg_backend_pid() as pid`;
    // Twice: the first run prepares the statement and binds from the request
    // queue, the second binds the cached statement directly at query time.
    for (let i = 0; i < 2; i++) {
      const err = await query(sql).then(
        () => null,
        e => e,
      );
      expect(err).toMatchObject(expected);
    }
    // Same backend pid: the next query ran on the same connection, no reconnect.
    expect(await sql`select pg_backend_pid() as pid`).toEqual([{ pid }]);
  });

  test("queries pipelined behind a rejected bytea parameter still run", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table files (id serial primary key, body bytea)`;
    const results = await Promise.all([
      sql`insert into files (body) values (${[1, 2, 3]})`.then(
        () => "stored",
        e => e.code,
      ),
      sql`insert into files (body) values (${new Uint8Array([9, 9])}) returning encode(body, 'hex') as hex`.then(
        rows => rows[0].hex,
        e => e.code,
      ),
      sql`select 2 as v`.then(
        rows => rows[0].v,
        e => e.code,
      ),
    ]);
    expect(results).toEqual(["ERR_INVALID_ARG_TYPE", "0909", 2]);
    // The temp table only exists on the original session, so this also fails
    // if the pool had to reconnect.
    expect(await sql`select encode(body, 'hex') as hex from files order by id`).toEqual([{ hex: "0909" }]);
  });

  test("a rejected bytea parameter inside a transaction does not abort it", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table files (id serial primary key, body bytea)`;
    const rejected = await sql.begin(async tx => {
      await tx`insert into files (body) values (${new Uint8Array([1])})`;
      const code = await tx`insert into files (body) values (${[1, 2, 3]})`.then(
        () => "stored",
        e => e.code,
      );
      await tx`insert into files (body) values (${new Uint8Array([2])})`;
      return code;
    });
    expect(rejected).toBe("ERR_INVALID_ARG_TYPE");
    expect(await sql`select encode(body, 'hex') as hex from files order by id`).toEqual([{ hex: "01" }, { hex: "02" }]);
  });
});
