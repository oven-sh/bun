// How a Bind parameter is encoded when the *server* typed the parameter slot
// (ParameterDescription, e.g. from the target column of an INSERT or a `$1::t`
// cast) and the JS value is not of the class that type's binary encoder takes.
//
// Each binary arm used to coerce whatever it was given: timestamp/timestamptz
// wrote 0 µs (2000-01-01) for any object and the Unix epoch for an Invalid
// Date, bool wrote JS truthiness, bytea wrote zero bytes, int4/float8 wrote
// ToInt32/ToNumber, and time/numeric/float4 were flagged binary while the
// value's text was written. All of it reached the table with no error.
//
// A parameter is now binary only when the value has an exact binary encoding
// for the declared type. Everything else goes as text (a Date as ISO 8601) and
// the server parses or rejects it, as it always has for string parameters. An
// Invalid Date, and a non-byte value for bytea (whose text input accepts any
// characters), throw before anything is sent.

import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import type net from "node:net";
import {
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const date = new Date("2024-05-06T07:08:09.000Z");
const instant = Temporal.Instant.fromEpochMilliseconds(1e12); // 2001-09-09T01:46:40Z
/** Stands in for a decimal.js / big.js style value: an object whose text form is the number. */
const decimalLike = { toString: () => "1.5" };

/** What the query settled with: the single text cell it selects, or the error's identifying fields. */
async function outcome(pending: Promise<any>): Promise<unknown> {
  try {
    const [row] = await pending;
    return row.v;
  } catch (e: any) {
    if (e instanceof SQL.PostgresError) return { errno: e.errno, message: e.message };
    return { code: e.code, message: e.message };
  }
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  // One connection, so a parameter that throws while it is encoded would also
  // take every later case down with it if the torn Bind stayed in the buffer.
  let sql: SQL;
  const connect = async (options: Bun.SQL.PostgresOrMySQLOptions = {}) => {
    await container.ready;
    const sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      idleTimeout: 30,
      ...options,
    });
    await sql`set time zone 'UTC'`;
    return sql;
  };
  /** `select $1::<type>::text`, so the server types `$1` as `<type>` before Bind is written. */
  const bind = (type: string, value: unknown) => outcome(sql.unsafe(`select $1::${type}::text as v`, [value]));

  beforeAll(async () => {
    sql = await connect();
  });
  afterAll(() => sql?.close());

  describe.each(["timestamptz", "timestamp"])("%s", type => {
    const tz = type === "timestamptz" ? "+00" : "";
    const invalidSyntax = (text: string) => ({
      errno: "22007",
      message: expect.stringContaining(`: "${text}"`),
    });

    test("a Date and an epoch string keep working", async () => {
      expect(await bind(type, date)).toBe(`2024-05-06 07:08:09${tz}`);
      expect(await bind(type, "2024-05-06 07:08:09+00")).toBe(`2024-05-06 07:08:09${tz}`);
      expect(await bind(type, null)).toBe(null);
    });

    test("Temporal values are sent as their ISO text and parsed by the server", async () => {
      expect(await bind(type, instant)).toBe(`2001-09-09 01:46:40${tz}`);
      expect(await bind(type, Temporal.PlainDate.from("2024-05-06"))).toBe(`2024-05-06 00:00:00${tz}`);
      expect(await bind(type, Temporal.PlainDateTime.from("2024-05-06T07:08:09"))).toBe(`2024-05-06 07:08:09${tz}`);
    });

    test("objects, arrays and functions are rejected by the server instead of stored as 2000-01-01", async () => {
      expect(await bind(type, { a: 1 })).toEqual(invalidSyntax("[object Object]"));
      expect(await bind(type, [1, 2])).toEqual(invalidSyntax("1,2"));
      expect(await bind(type, () => 1)).toEqual(invalidSyntax("() => 1"));
      expect(await bind(type, new Int32Array([1, 2]))).toEqual(invalidSyntax("1,2"));
    });

    test("an Invalid Date throws instead of being stored as 1970-01-01", async () => {
      expect(await bind(type, new Date(NaN))).toEqual({
        code: "ERR_INVALID_ARG_VALUE",
        message: expect.stringContaining("Invalid Date"),
      });
      // and the connection is intact afterwards
      expect(await bind(type, date)).toBe(`2024-05-06 07:08:09${tz}`);
    });
  });

  test("bool: only a boolean is binary, anything else is judged by the server", async () => {
    const invalidSyntax = (text: string) => ({ errno: "22P02", message: expect.stringContaining(`: "${text}"`) });
    expect(await bind("bool", true)).toBe("true");
    expect(await bind("bool", false)).toBe("false");
    expect(await bind("bool", "f")).toBe("false");
    expect(await bind("bool", { a: 1 })).toEqual(invalidSyntax("[object Object]"));
    expect(await bind("bool", [])).toEqual(invalidSyntax(""));
    expect(await bind("bool", date)).toEqual(invalidSyntax("2024-05-06T07:08:09.000Z"));
  });

  test("bytea: bytes are binary, a string is text, anything else throws", async () => {
    const notBytes = { code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining("bytea parameter") };
    const bytea = (value: unknown) => outcome(sql`select encode(${value}::bytea, 'escape') as v`);
    expect(await bytea(Buffer.from("hi"))).toBe("hi");
    expect(await bytea(new Uint8Array([0x68, 0x69]).buffer)).toBe("hi");
    expect(await bytea("\\x6869")).toBe("hi");
    expect(await bytea({ a: 1 })).toEqual(notBytes);
    expect(await bytea([0x68, 0x69])).toEqual(notBytes);
    expect(await bytea({ type: "Buffer", data: [0x68, 0x69] })).toEqual(notBytes);
    expect(await bytea(date)).toEqual(notBytes);
    // and the connection is intact afterwards
    expect(await bytea(Buffer.from("hi"))).toBe("hi");
  });

  test("int4 / float8: only a number is binary, anything else is judged by the server", async () => {
    const invalidSyntax = (text: string) => ({ errno: "22P02", message: expect.stringContaining(`: "${text}"`) });
    expect(await bind("int4", 7)).toBe("7");
    expect(await bind("int4", -2147483648)).toBe("-2147483648");
    expect(await bind("int4", { a: 1 })).toEqual(invalidSyntax("[object Object]"));
    expect(await bind("int4", date)).toEqual(invalidSyntax("2024-05-06T07:08:09.000Z"));
    expect(await bind("int4", () => 1)).toEqual(invalidSyntax("() => 1"));

    expect(await bind("float8", 1.5)).toBe("1.5");
    expect(await bind("float8", NaN)).toBe("NaN");
    expect(await bind("float8", -Infinity)).toBe("-Infinity");
    expect(await bind("float8", { a: 1 })).toEqual(invalidSyntax("[object Object]"));
    expect(await bind("float8", date)).toEqual(invalidSyntax("2024-05-06T07:08:09.000Z"));
  });

  test("types without a binary encoder are sent as text, not as text flagged binary", async () => {
    // numeric, float4 and time declared format 1 and then carried the value's
    // text, which the server read as 22P03 "incorrect binary data format" /
    // 22008 "time out of range" / 08P01 "insufficient data left in message".
    expect(await bind("numeric", decimalLike)).toBe("1.5");
    expect(await bind("float4", decimalLike)).toBe("1.5");
    expect(await bind("time", Temporal.PlainTime.from("07:08:09"))).toBe("07:08:09");
    // interval never had a binary flag; it shows the same text rule.
    expect(await bind("interval", Temporal.Duration.from({ hours: 1, minutes: 30 }))).toBe("01:30:00");
  });

  test("a Date sent as text is ISO 8601 (#29010)", async () => {
    // `date` has no binary encoder, and `text` takes the string as is.
    expect(await bind("date", date)).toBe("2024-05-06");
    expect(await bind("text", date)).toBe("2024-05-06T07:08:09.000Z");
    // json keeps going through JSON.stringify.
    expect(await bind("jsonb", date)).toBe(`"2024-05-06T07:08:09.000Z"`);
    expect(await bind("jsonb", { at: date })).toBe(`{"at": "2024-05-06T07:08:09.000Z"}`);
  });

  test("prepare: false binds a Date before the server has typed the parameter (#29010)", async () => {
    await using unnamed = await connect({ prepare: false });
    expect(await outcome(unnamed`select ${date}::timestamptz::text as v`)).toBe("2024-05-06 07:08:09+00");
    expect(await outcome(unnamed`select ${date}::date::text as v`)).toBe("2024-05-06");
    expect(await outcome(unnamed`select ${new Date(NaN)}::date::text as v`)).toEqual({
      code: "ERR_INVALID_ARG_VALUE",
      message: expect.stringContaining("Invalid Date"),
    });
    expect(await outcome(unnamed`select ${1.5}::float8::text as v`)).toBe("1.5");
  });
});

// The same decisions observed on the wire, against a scripted backend that
// types every parameter itself. This part runs without Docker.
describe("Bind wire format", () => {
  const OID = { bool: 16, bytea: 17, int4: 23, float8: 701, time: 1083, timestamptz: 1184, numeric: 1700 };

  /** PostgreSQL FE/BE Bind: String portal, String statement, Int16 nFormats, Int16[] formats, Int16 nParams, (Int32 len, bytes)[] */
  function readBind(body: Buffer) {
    let o = body.indexOf(0) + 1;
    o = body.indexOf(0, o) + 1;
    const nFormats = body.readInt16BE(o);
    o += 2;
    const formats: number[] = [];
    for (let i = 0; i < nFormats; i++, o += 2) formats.push(body.readInt16BE(o));
    const nParams = body.readInt16BE(o);
    o += 2;
    const params: (Buffer | null)[] = [];
    for (let i = 0; i < nParams; i++) {
      const len = body.readInt32BE(o);
      o += 4;
      params.push(len < 0 ? null : Buffer.from(body.subarray(o, o + len)));
      if (len > 0) o += len;
    }
    return { formats, params };
  }

  /** Runs one query against a backend that declares `oids` for its parameters; resolves with the Bind the client sent, if any. */
  async function captureBind(oids: number[], run: (sql: SQL) => Promise<unknown>) {
    let bind: ReturnType<typeof readBind> | undefined;
    const sockets = new Set<net.Socket>();
    const { port, server } = await pgMockServer((type, body, socket) => {
      sockets.add(socket);
      if (type === "P") {
        return [
          pgParseComplete(),
          pgParameterDescription(oids),
          pgRowDescription([{ name: "v", typeOid: 25 }]),
          pgReadyForQuery(),
        ];
      }
      if (type === "B") {
        bind = readBind(body);
        return [pgBindComplete(), pgDataRow([Buffer.from("ok")]), pgCommandComplete("SELECT 1"), pgReadyForQuery()];
      }
    });
    const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 5 });
    let error: unknown;
    try {
      await run(sql).catch(e => (error = { code: e.code }));
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    return { bind, error };
  }

  const text = (s: string) => Buffer.from(s);
  const be64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(n);
    return b;
  };

  test("timestamptz: Date and number are binary, everything else is text", async () => {
    const placeholders = "$1, $2, $3, $4, $5, $6";
    const { bind, error } = await captureBind(Array(6).fill(OID.timestamptz), sql =>
      sql.unsafe(`select ${placeholders}`, [
        new Date(Date.UTC(2000, 0, 2)),
        Infinity,
        instant,
        { a: 1 },
        [1, 2],
        "2024-05-06 07:08:09+00",
      ]),
    );
    expect(error).toBeUndefined();
    expect(bind).toEqual({
      formats: [1, 1, 0, 0, 0, 0],
      params: [
        be64(86_400_000_000n),
        be64(0x7fffffffffffffffn),
        text("2001-09-09T01:46:40Z"),
        text("[object Object]"),
        text("1,2"),
        text("2024-05-06 07:08:09+00"),
      ],
    });
  });

  test("an Invalid Date throws and no Bind is sent", async () => {
    for (const value of [new Date(NaN), NaN]) {
      const { bind, error } = await captureBind([OID.timestamptz], sql => sql`select ${value}`);
      expect(error).toEqual({ code: "ERR_INVALID_ARG_VALUE" });
      expect(bind).toBeUndefined();
    }
  });

  test("bool, bytea, int4, float8: exact classes are binary, the rest is text", async () => {
    const oids = [OID.bool, OID.bool, OID.bytea, OID.int4, OID.int4, OID.int4, OID.float8, OID.float8];
    const placeholders = oids.map((_, i) => `$${i + 1}`).join(", ");
    const { bind, error } = await captureBind(oids, sql =>
      sql.unsafe(`select ${placeholders}`, [true, { a: 1 }, new Uint8Array([1, 2]), 7, 2 ** 31, date, 1.5, date]),
    );
    expect(error).toBeUndefined();
    expect(bind).toEqual({
      formats: [1, 0, 1, 1, 0, 0, 1, 0],
      params: [
        Buffer.from([1]),
        text("[object Object]"),
        Buffer.from([1, 2]),
        Buffer.from([0, 0, 0, 7]),
        text("2147483648"),
        text("2024-05-06T07:08:09.000Z"),
        Buffer.from(new Float64Array([1.5]).buffer).reverse(),
        text("2024-05-06T07:08:09.000Z"),
      ],
    });
  });

  test("types without a binary encoder declare the text format", async () => {
    const { bind, error } = await captureBind(
      [OID.time, OID.numeric],
      sql => sql`select ${Temporal.PlainTime.from("07:08:09")}, ${decimalLike}`,
    );
    expect(error).toBeUndefined();
    expect(bind).toEqual({ formats: [0, 0], params: [text("07:08:09"), text("1.5")] });
  });
});
