// Binding a JS value to a parameter the server types as `bytea` (OID 17).
// Bun sends bytea in binary format, so the value needs a byte representation:
// a Buffer / TypedArray / ArrayBuffer (raw bytes) or a string (sent as text,
// parsed by the server). Anything else (a `number[]` of bytes, a
// JSON-revived `{ type: "Buffer", data }`, a Date, a plain object) used to be
// written as a zero-length value and stored as `\x` with no error.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
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
});
