// Binding a JS value to a parameter the server types as `bytea` (OID 17).
// Bun sends bytea in binary format, so the value needs a byte representation:
// a BufferSource (raw bytes) or a string (sent as text, parsed by the server).
// Anything else rejects: bytea's input function takes any text, so the server would store it.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, expectRssDeltaBelow, isLinux } from "harness";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = (options: { prepare?: boolean } = {}) =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      ...options,
    });

  const rejection = (query: Promise<unknown>): Promise<any> =>
    query.then(
      rows => ({ resolved: rows }),
      err => err,
    );

  const rejected: [string, unknown, string][] = [
    ["number[]", [1, 2, 3], "an instance of Array"],
    ["JSON-revived Buffer", JSON.parse(JSON.stringify(Buffer.from([1, 2]))), "an instance of Object"],
    ["Date", new Date(0), "an instance of Date"],
    ["plain object", { a: 1 }, "an instance of Object"],
  ];

  test.each(rejected)("%s bound to a bytea parameter rejects", async (_, value, received) => {
    await container.ready;
    await using sql = connect();
    const err = await rejection(sql`select ${value}::bytea as x`);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(
      `Query parameter $1 of type bytea must be a Buffer, TypedArray, ArrayBuffer or string. Received ${received}`,
    );
  });

  test("the error names the position of the offending parameter", async () => {
    await container.ready;
    await using sql = connect();
    const err = await rejection(sql.unsafe("select $1::int4 as a, $2::bytea as b", [7, [1, 2, 3]]));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(
      "Query parameter $2 of type bytea must be a Buffer, TypedArray, ArrayBuffer or string. Received an instance of Array",
    );
  });

  test("BufferSource, string and null values bound to a bytea parameter round-trip", async () => {
    await container.ready;
    await using sql = connect();
    const roundTrip = async (value: unknown) => {
      const [row] = await sql`select encode(${value}::bytea, 'hex') as hex, ${value}::bytea as bytes`;
      return row;
    };
    const stored = (hex: string) => ({ hex, bytes: Buffer.from(hex, "hex") });
    expect(await roundTrip(new Uint8Array([1, 2, 3]))).toEqual(stored("010203"));
    expect(await roundTrip(Buffer.from([4, 5]))).toEqual(stored("0405"));
    expect(await roundTrip(new Uint8Array([6, 7, 8, 9]).buffer)).toEqual(stored("06070809"));
    expect(await roundTrip(new Uint8Array([0, 10, 11, 0]).subarray(1, 3))).toEqual(stored("0a0b"));
    expect(await roundTrip(new Uint16Array(new Uint8Array([16, 17, 18, 19]).buffer))).toEqual(stored("10111213"));
    expect(await roundTrip(new DataView(new Uint8Array([0, 20, 21, 0]).buffer, 1, 2))).toEqual(stored("1415"));
    expect(await roundTrip(new SharedArrayBuffer(2))).toEqual(stored("0000"));
    // 0xff on both sides of the view.
    const guarded = (buffer: ArrayBufferLike) => (
      new Uint8Array(buffer).fill(0xff),
      new Uint8Array(buffer, 2, 3).fill(7)
    );
    expect(await roundTrip(guarded(new SharedArrayBuffer(8)))).toEqual(stored("070707"));
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const view = guarded(resizable);
    expect(await roundTrip(view)).toEqual(stored("070707"));
    resizable.resize(1);
    expect(await roundTrip(view)).toEqual(stored(""));
    const detached = new Uint8Array(4);
    detached.buffer.transfer();
    expect(await roundTrip(detached)).toEqual(stored(""));
    expect(await roundTrip(new Uint8Array(0))).toEqual(stored(""));
    expect(await roundTrip("\\x0c0d")).toEqual(stored("0c0d"));
    expect(await roundTrip(null)).toEqual({ hex: null, bytes: null });
  });

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

  // The Bind message is the parameter and a few bytes behind it. A write
  // buffer that fits the parameter exactly has to double for those bytes, and
  // it copies the parameter to do it. VmHWM is Linux only, and the test reads
  // the peak of a child of its own.
  test.skipIf(!isLinux)("a large bytea parameter is held once while it is sent", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
    const fixture = /* js */ `
      const fs = require("node:fs");
      const PAYLOAD = 32 * 1024 * 1024;
      const peakMiB = () => Number(/VmHWM:\\s+(\\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) / 1024;
      const sql = new Bun.SQL({ url: ${JSON.stringify(url)}, max: 1 });
      await sql.unsafe("select 1");
      // Zero pages are not resident, so the peak counts the copies only.
      const parameter = new Uint8Array(PAYLOAD);
      const before = peakMiB();
      const [{ length }] = await sql.unsafe("select length($1::bytea) as length", [parameter]);
      if (length !== PAYLOAD) throw new Error("the server received " + length + " bytes");
      console.log(JSON.stringify({ deltaMiB: peakMiB() - before }));
      await sql.close();
    `;
    // One copy of 32 MiB. The second copy makes it 64.
    await expectRssDeltaBelow(["-e", fixture], { release: 45, debug: 51 });
  });
});
