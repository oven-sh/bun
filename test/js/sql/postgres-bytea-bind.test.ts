// Binding a JS value to a parameter the server types as `bytea` (OID 17).
// Bun sends bytea in binary format, so the value needs a byte representation:
// a Buffer / TypedArray / ArrayBuffer (raw bytes) or a string (sent as text,
// parsed by the server). Anything else (a `number[]` of bytes, a
// JSON-revived `{ type: "Buffer", data }`, a Date, a plain object) used to be
// written as a zero-length value and stored as `\x` with no error.
//
// Each test opens its own connection, so the tests run concurrently. Do not
// hoist one connection into beforeAll: the query that follows a rejected bind
// on the same connection fails with ERR_POSTGRES_CONNECTION_CLOSED (#34732).

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  // Settles to the error. If the server accepted the value instead, settles to
  // the rows, so the failed assertion shows what was stored.
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
    // `hex` is the server's own rendering of the bytes it received, so it does
    // not depend on how Bun decodes a bytea result. `bytes` is the value read back.
    const roundTrip = async (value: unknown) => {
      const [row] = await sql`select encode(${value}::bytea, 'hex') as hex, ${value}::bytea as bytes`;
      return row;
    };
    const stored = (hex: string) => ({ hex, bytes: Buffer.from(hex, "hex") });
    expect(await roundTrip(new Uint8Array([1, 2, 3]))).toEqual(stored("010203"));
    expect(await roundTrip(Buffer.from([4, 5]))).toEqual(stored("0405"));
    expect(await roundTrip(new Uint8Array([6, 7, 8, 9]).buffer)).toEqual(stored("06070809"));
    expect(await roundTrip(new Uint8Array([0, 10, 11, 0]).subarray(1, 3))).toEqual(stored("0a0b"));
    // a wider element type goes out as its underlying bytes, not as element values
    expect(await roundTrip(new Uint16Array(new Uint8Array([16, 17, 18, 19]).buffer))).toEqual(stored("10111213"));
    expect(await roundTrip(new Uint8Array(0))).toEqual(stored(""));
    expect(await roundTrip("\\x0c0d")).toEqual(stored("0c0d"));
    expect(await roundTrip(null)).toEqual({ hex: null, bytes: null });
  });
});
