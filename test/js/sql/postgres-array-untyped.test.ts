// `sql.array(values)` with no type used to bind as `$N::JSON[]` with every
// element in its JSON form. A write into a `text[]` column then stored `"a"`
// with the quotes, `::int[]` failed with "cannot cast type json[] to
// integer[]", and `id = ANY(...)` failed with "operator does not exist:
// integer = json". Now the untyped parameter carries no cast and a plain array
// literal, so the server infers the element type from the column or from the
// cast the query applies (issue #41242).
//
// The wire test pins the query text and the bound literal with a scripted
// backend. The end-to-end tests run against the docker-compose postgres.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  pgErrorResponse,
  pgMockServer,
  pgParameterDescription,
  pgParseComplete,
  pgRaw,
  pgReadyForQuery,
} from "./wire-frames";

type Captured = { query: string; oids: number[]; params: (string | null)[] };

// Records the Parse text and the Bind values of one extended-protocol query.
// The client sends Parse + Describe + Sync and waits for the parameter types
// before it binds, so Describe is answered as a server that resolved every
// parameter to text[] would. Execute is answered with an error so the client
// settles.
async function captureBind(run: (sql: SQL) => Promise<unknown>): Promise<Captured> {
  const captured: Captured = { query: "", oids: [], params: [] };
  const { port, server } = await pgMockServer((type, body) => {
    if (type === "D") {
      return [
        pgParseComplete(),
        pgParameterDescription(captured.oids.map(() => 1009)),
        pgRaw("n", Buffer.alloc(0)), // NoData
      ];
    }
    if (type === "P") {
      const nameEnd = body.indexOf(0);
      const queryEnd = body.indexOf(0, nameEnd + 1);
      captured.query = body.toString("utf8", nameEnd + 1, queryEnd);
      const count = body.readInt16BE(queryEnd + 1);
      for (let i = 0; i < count; i++) captured.oids.push(body.readInt32BE(queryEnd + 3 + i * 4));
    } else if (type === "B") {
      const portalEnd = body.indexOf(0);
      const nameEnd = body.indexOf(0, portalEnd + 1);
      let offset = nameEnd + 1;
      const formats = body.readInt16BE(offset);
      offset += 2 + formats * 2;
      const count = body.readInt16BE(offset);
      offset += 2;
      for (let i = 0; i < count; i++) {
        const len = body.readInt32BE(offset);
        offset += 4;
        if (len === -1) {
          captured.params.push(null);
          continue;
        }
        captured.params.push(body.toString("utf8", offset, offset + len));
        offset += len;
      }
    } else if (type === "E") {
      return pgErrorResponse({ S: "ERROR", C: "0A000", M: "mock" });
    } else if (type === "S") {
      return pgReadyForQuery();
    }
  });
  try {
    await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
    await run(sql).catch(() => {});
  } finally {
    server.close();
  }
  return captured;
}

describe("untyped sql.array", () => {
  test("binds without a cast and without JSON quoting", async () => {
    expect(
      await captureBind(sql => sql`INSERT INTO probe (tags) VALUES (${sql.array(["a", 'He said "hi"', 1, true])})`),
    ).toEqual({
      query: "INSERT INTO probe (tags) VALUES ($1 )",
      oids: [0],
      params: ['{"a","He said \\"hi\\"","1","true"}'],
    });
  });

  test("leaves the caller's cast as the only cast", async () => {
    expect(await captureBind(sql => sql`SELECT ${sql.array([1, 2])}::int[]`)).toEqual({
      query: "SELECT $1 ::int[]",
      oids: [0],
      params: ['{"1","2"}'],
    });
  });

  test("an unmapped type oid binds untyped", async () => {
    expect(await captureBind(sql => sql`SELECT ${sql.array([1, 2], 999999)}`)).toEqual({
      query: "SELECT $1 ",
      oids: [0],
      params: ['{"1","2"}'],
    });
  });

  test("null elements are NULL and buffers are hex bytea", async () => {
    expect(await captureBind(sql => sql`SELECT ${sql.array(["a", null, undefined, Buffer.from("hi")])}`)).toEqual({
      query: "SELECT $1 ",
      oids: [0],
      params: ['{"a",null,null,"\\\\x6869"}'],
    });
    expect(await captureBind(sql => sql`SELECT ${sql.array([Buffer.from("hi"), null], "BYTEA")}`)).toEqual({
      query: "SELECT $1::BYTEA[] ",
      oids: [0],
      params: ['{"\\\\x6869",null}'],
    });
    // In a json[] a null element stays the JSON value null, as before.
    expect(await captureBind(sql => sql`SELECT ${sql.array([null, undefined], "JSON")}`)).toEqual({
      query: "SELECT $1::JSON[] ",
      oids: [0],
      params: ['{"null",null}'],
    });
  });

  test("typed array elements keep their values", async () => {
    expect(await captureBind(sql => sql`SELECT ${sql.array(new Int32Array([100, 200]))}`)).toEqual({
      query: "SELECT $1 ",
      oids: [0],
      params: ['{"100","200"}'],
    });
    expect(await captureBind(sql => sql`SELECT ${sql.array([new Float64Array([1.5, 2])], "TEXT")}`)).toEqual({
      query: "SELECT $1::TEXT[] ",
      oids: [0],
      params: ['{{"1.5","2"}}'],
    });
  });

  test("an explicit type still casts", async () => {
    expect(await captureBind(sql => sql`SELECT ${sql.array(["a", 1], "TEXT")}`)).toEqual({
      query: "SELECT $1::TEXT[] ",
      oids: [0],
      params: ['{"a","1"}'],
    });
    expect(await captureBind(sql => sql`SELECT ${sql.array(["a", 1], "JSON")}`)).toEqual({
      query: "SELECT $1::JSON[] ",
      oids: [0],
      params: ['{"\\"a\\"",1}'],
    });
  });
});

describeWithContainer("untyped sql.array against postgres", { image: "postgres_plain" }, container => {
  const connect = () => new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, { max: 1 });
  const uuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  test("the server infers the column types on insert", async () => {
    await container.ready;
    await using sql = connect();
    const table = "array_untyped_" + Bun.randomUUIDv7("hex");
    await sql`CREATE TEMPORARY TABLE ${sql(table)} (tags TEXT[], ints INT[], ids UUID[], flags BOOLEAN[])`;
    const [row] = await sql`INSERT INTO ${sql(table)} (tags, ints, ids, flags) VALUES (
      ${sql.array(["a", 'He said "hi"', "x,y", "c:\\win"])},
      ${sql.array([1, 2])},
      ${sql.array([uuid])},
      ${sql.array([true, false])}
    ) RETURNING tags, ints::text[] AS ints, ids::text[] AS ids, flags`;
    expect(row).toEqual({
      tags: ["a", 'He said "hi"', "x,y", "c:\\win"],
      ints: ["1", "2"],
      ids: [uuid],
      flags: [true, false],
    });
  });

  test("null elements and buffers reach the column as NULL and bytea", async () => {
    await container.ready;
    await using sql = connect();
    const table = "array_untyped_" + Bun.randomUUIDv7("hex");
    await sql`CREATE TEMPORARY TABLE ${sql(table)} (tags TEXT[], ints INT[], blobs BYTEA[])`;
    const [row] = await sql`INSERT INTO ${sql(table)} (tags, ints, blobs) VALUES (
      ${sql.array(["a", null])},
      ${sql.array([1, null])},
      ${sql.array([Buffer.from("hi"), Buffer.from([0, 255]), null])}
    ) RETURNING tags, ints::text[] AS ints, blobs`;
    expect(row).toEqual({
      tags: ["a", null],
      ints: ["1", null],
      blobs: [Buffer.from("hi"), Buffer.from([0, 255]), null],
    });
    const [typed] = await sql`SELECT ${sql.array([Buffer.from("hi")], "BYTEA")} AS blobs`;
    expect(typed).toEqual({ blobs: [Buffer.from("hi")] });
  });

  test("an explicit type binds a null element as NULL", async () => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`SELECT
      ${sql.array(["a", null, undefined, "null"], "TEXT")} AS texts,
      ${sql.array([{ a: 1 }, null, undefined], "JSON")} AS docs,
      ${sql.array([true, null], "BOOLEAN")} AS flags`;
    expect(row).toEqual({
      texts: ["a", null, null, "null"],
      docs: [{ a: 1 }, null, null],
      flags: [true, null],
    });
  });

  test("prepare: false binds the same literal", async () => {
    await container.ready;
    await using sql = new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, {
      max: 1,
      prepare: false,
    });
    const table = "array_untyped_" + Bun.randomUUIDv7("hex");
    await sql`CREATE TEMPORARY TABLE ${sql(table)} (tags TEXT[], ints INT[])`;
    const [row] = await sql`INSERT INTO ${sql(table)} (tags, ints) VALUES (
      ${sql.array(["x", "y"])},
      ${sql.array([3, 4])}
    ) RETURNING tags, ints::text[] AS ints`;
    expect(row).toEqual({ tags: ["x", "y"], ints: ["3", "4"] });
  });

  test("the caller's cast applies", async () => {
    await container.ready;
    await using sql = connect();
    const [{ x }] = await sql`SELECT ${sql.array([1, 2])}::int[] AS x`;
    expect(Array.from(x)).toEqual([1, 2]);
    const [{ t }] = await sql`SELECT ${sql.array(["a", 'b"c'])}::text[] AS t`;
    expect(t).toEqual(["a", 'b"c']);
  });

  test("ANY() infers the element type from the compared value", async () => {
    await container.ready;
    await using sql = connect();
    const [{ m }] = await sql`SELECT 2 = ANY(${sql.array([1, 2])}) AS m`;
    expect(m).toBe(true);
    const [{ u }] = await sql`SELECT ${uuid}::uuid = ANY(${sql.array([uuid])}) AS u`;
    expect(u).toBe(true);
  });

  // The JSON default returned an array here. With no context the server reads
  // the parameter as text, so these queries need the type.
  test("a query with no context needs the type", async () => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`SELECT ${sql.array([1, 2])} AS untyped, ${sql.array([1, 2], "INT")} AS typed`;
    expect({ untyped: row.untyped, typed: Array.from(row.typed) }).toEqual({ untyped: '{"1","2"}', typed: [1, 2] });
    const error = await sql`SELECT unnest(${sql.array([1, 2])})`.catch(e => e);
    expect(error.message).toBe("function unnest(unknown) is not unique");
    const rows = await sql`SELECT unnest(${sql.array([1, 2], "INT")}) AS n`;
    expect(rows.map(r => r.n)).toEqual([1, 2]);
  });

  // The JSON default JSON-encoded each string. Untyped, a string element
  // reaches json_in as is, so json[] and jsonb[] columns need the type.
  test("json[] and jsonb[] columns need the type for string elements", async () => {
    await container.ready;
    await using sql = connect();
    const table = "array_untyped_" + Bun.randomUUIDv7("hex");
    await sql`CREATE TEMPORARY TABLE ${sql(table)} (docs JSONB[], notes JSON[])`;
    const [row] = await sql`INSERT INTO ${sql(table)} (docs, notes) VALUES (
      ${sql.array([{ a: 1 }, 2, true, null])},
      ${sql.array(["a", 'b"c'], "JSON")}
    ) RETURNING docs, notes`;
    expect(row).toEqual({ docs: [{ a: 1 }, 2, true, null], notes: ["a", 'b"c'] });
    const error = await sql`INSERT INTO ${sql(table)} (docs) VALUES (${sql.array(["a"])})`.catch(e => e);
    expect(error.message).toBe("invalid input syntax for type json");
  });
});
