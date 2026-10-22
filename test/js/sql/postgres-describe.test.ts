import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, tempDir } from "harness";
import path from "node:path";
import {
  pgBindComplete,
  pgCloseComplete,
  pgCommandComplete,
  pgErrorResponse,
  pgMockServer,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const rejection = (promise: PromiseLike<unknown>) =>
  promise.then(
    () => "fulfilled",
    e => e,
  );

type Container = { host: string; port: number; ready: Promise<void> };
const connectTo = (container: Container) =>
  async function connect(options: SQL.Options = {}) {
    await container.ready;
    return new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, {
      max: 1,
      ...options,
    });
  };

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = connectTo(container);
  /** One session with the temporary table `described (id int, name text)`. */
  const session = async (options?: SQL.Options) => {
    const sql = await connect(options);
    await sql`create temporary table described (id int, name text)`;
    return sql;
  };
  /** The OID of this session's `described`, not of another session's. */
  const oidOf = async (sql: SQL) => (await sql`select 'described'::regclass::oid as oid`)[0].oid as number;
  const rows = async (sql: SQL) => (await sql`select count(*)::int as n from described`)[0].n;

  test("an INSERT described is not run", async () => {
    await using sql = await session();
    const oid = await oidOf(sql);
    const description = await sql`insert into described (id, name) values (${1}, ${"a"}) returning id`.describe();
    expect(description).toEqual({
      string: "insert into described (id, name) values ($1 , $2 ) returning id",
      types: [23, 25],
      columns: [{ name: "id", type: 23, table: oid, number: 1 }],
    });
    expect(await rows(sql)).toBe(0);
  });

  test("a statement the connection already has is parsed again: the text as it is now", async () => {
    await using sql = await session();
    const oid = await oidOf(sql);
    const star = () => sql`select * from described where id = ${1}`;
    const result = await star();
    expect(result.statement).toEqual({
      string: "select * from described where id = $1 ",
      types: [23],
      columns: [
        { name: "id", type: 23, table: oid, number: 1 },
        { name: "name", type: 25, table: oid, number: 2 },
      ],
    });
    await sql`alter table described add column age int`;
    const description = await star().describe();
    expect(description.columns.map(c => c.name)).toEqual(["id", "name", "age"]);
    // The runs that follow take the statement that describe() parsed.
    const after = await star();
    expect(after).toEqual([]);
    expect(after.statement).toBe(description);
    expect(after.statement).not.toBe(result.statement);
  });

  test("in a transaction, a statement that a schema change invalidated", async () => {
    await using sql = await session();
    const star = () => sql`select * from described where id = ${1}`;
    await star();
    const names = await sql.begin(async tx => {
      await tx`alter table described add column age int`;
      const { columns } = await tx`select * from described where id = ${1}`.describe();
      await tx`insert into described (id, name, age) values (${1}, ${"a"}, ${2})`;
      return columns.map(c => c.name);
    });
    expect(names).toEqual(["id", "name", "age"]);
    expect(await star()).toEqual([{ id: 1, name: "a", age: 2 }]);
  });

  test("on a reserved connection, in a transaction by hand", async () => {
    await using sql = await session();
    const star = () => sql`select * from described where id = ${1}`;
    await star();
    {
      using reserved = await sql.reserve();
      await reserved`begin`;
      await reserved`alter table described add column age int`;
      const { columns } = await reserved`select * from described where id = ${1}`.describe();
      expect(columns.map(c => c.name)).toEqual(["id", "name", "age"]);
      await reserved`commit`;
    }
    expect((await star().describe()).columns.map(c => c.name)).toEqual(["id", "name", "age"]);
  });

  test("prepare: false describes the unnamed statement", async () => {
    await using sql = await session({ prepare: false });
    const oid = await oidOf(sql);
    const description = await sql`select name from described where id = ${1}`.describe();
    expect(description).toEqual({
      string: "select name from described where id = $1 ",
      types: [23],
      columns: [{ name: "name", type: 25, table: oid, number: 2 }],
    });
    expect(await sql`select name from described where id = ${1}`).toEqual([]);
  });

  test("unsafe SQL with placeholders and no values", async () => {
    await using sql = await session();
    const text = "delete from described where id = $1 and name = $2";
    expect(await sql.unsafe(text).describe()).toEqual({ string: text, types: [23, 25], columns: [] });
    expect(await sql.unsafe(text, [1]).describe()).toEqual({ string: text, types: [23, 25], columns: [] });
  });

  test("sql.file()", async () => {
    await using sql = await session();
    using dir = tempDir("sql-describe", { "count.sql": "select count(*) as n from described where id > $1" });
    expect(await sql.file(path.join(String(dir), "count.sql")).describe()).toEqual({
      string: "select count(*) as n from described where id > $1",
      types: [23],
      columns: [{ name: "n", type: 20, table: 0, number: 0 }],
    });
  });

  test("the column transform renames the columns", async () => {
    await using sql = await session({ transform: SQL.camel });
    const oid = await oidOf(sql);
    const { columns } = await sql`select id as user_id from described`.describe();
    expect(columns).toEqual([{ name: "userId", type: 23, table: oid, number: 1 }]);
  });

  test("a later .simple() does not run the statement", async () => {
    await using sql = await session();
    const query = sql`insert into described (id) values (1)`;
    const description = query.describe();
    query.simple();
    expect(await description).toEqual({ string: "insert into described (id) values (1)", types: [], columns: [] });
    expect(await rows(sql)).toBe(0);
  });

  test("a BEGIN on a pool: a describe() starts no transaction", async () => {
    await using sql = await session({ max: 2 });
    expect(await sql.unsafe("begin").describe()).toEqual({ string: "begin", types: [], columns: [] });
    expect(await rejection(sql.unsafe("begin"))).toMatchObject({ code: "ERR_POSTGRES_UNSAFE_TRANSACTION" });
  });

  test("a COPY and an empty text", async () => {
    await using sql = await session();
    expect(await sql`copy described from stdin`.describe()).toEqual({
      string: "copy described from stdin",
      types: [],
      columns: [],
    });
    expect(await sql.unsafe("").describe()).toEqual({ string: "", types: [], columns: [] });
    expect(await rows(sql)).toBe(0);
  });

  test("the server's error rejects the query", async () => {
    await using sql = await session();
    expect(await rejection(sql`select nope from described`.describe())).toMatchObject({
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "42703",
    });
    expect(await rejection(sql.unsafe("select 1; select 2").describe())).toMatchObject({ errno: "42601" });
    // The connection goes on.
    expect(await sql`select 1 as one`).toEqual([{ one: 1 }]);
  });

  test("queued behind and before other queries", async () => {
    await using sql = await session();
    const before = sql`insert into described (id) values (${1})`;
    const description = sql`insert into described (id) values (${2})`.describe();
    const after = sql`select id from described order by id`;
    const [, d, ids] = await Promise.all([before, description, after]);
    expect(d.types).toEqual([23]);
    expect(ids).toEqual([{ id: 1 }]);
  });

  test("describe() after the query started", async () => {
    await using sql = await session();
    const query = sql`select 1 as one`;
    query.execute();
    const invalidState = expect.objectContaining({ code: "ERR_INVALID_STATE" });
    expect(() => query.describe()).toThrow(invalidState);
    expect(await query).toEqual([{ one: 1 }]);
    expect(() => (sql`copy described to stdout`.describe() as any).readable()).toThrow(invalidState);
  });
});

describe("on the wire", () => {
  const column = { name: "id", tableOid: 16388, columnAttr: 1, typeOid: 23 };

  test("Parse, Describe and Sync go out, never Bind or Execute", async () => {
    const written: string[] = [];
    const { port, server } = await pgMockServer(type => {
      written.push(type);
      if (type === "S") return pgReadyForQuery();
      if (type === "P") return pgParseComplete();
      if (type === "C") return pgCloseComplete();
      if (type === "B") return pgBindComplete();
      if (type === "E") return pgCommandComplete("SELECT 0");
      if (type === "D") return [pgParameterDescription([23]), pgRowDescription([column])];
    });
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      const description = await sql`select id from t where id = ${1}`.describe();
      expect(description).toEqual({
        string: "select id from t where id = $1 ",
        types: [23],
        columns: [{ name: "id", type: 23, table: 16388, number: 1 }],
      });
      expect(written).toEqual(["P", "D", "S"]);
      // A describe() of a text the connection has parses it again, and closes the statement it had.
      expect(await sql`select id from t where id = ${1}`.describe()).toEqual(description);
      expect(written).toEqual(["P", "D", "S", "C", "P", "D", "S"]);
      // The run that follows has its statement.
      await sql`select id from t where id = ${1}`;
      expect(written).toEqual(["P", "D", "S", "C", "P", "D", "S", "B", "E", "S"]);
    } finally {
      server.close();
    }
  });

  test("NoData is no columns", async () => {
    const { port, server } = await pgMockServer(type => {
      if (type === "S") return pgReadyForQuery();
      if (type === "P") return pgParseComplete();
      if (type === "D") return [pgParameterDescription([]), pgNoData()];
    });
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      expect(await sql`delete from t`.describe()).toEqual({ string: "delete from t", types: [], columns: [] });
    } finally {
      server.close();
    }
  });

  test("the server's error rejects the query, and the text is parsed again the next time", async () => {
    const written: string[] = [];
    let parses = 0;
    const { port, server } = await pgMockServer(type => {
      written.push(type);
      if (type === "S") return pgReadyForQuery();
      if (type === "C") return pgCloseComplete();
      if (type === "P") {
        if (++parses === 1) return pgErrorResponse({ S: "ERROR", C: "42P01", M: 'relation "t" does not exist' });
        return pgParseComplete();
      }
      if (type === "D") return [pgParameterDescription([]), pgRowDescription([column])];
    });
    try {
      await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
      const query = () => sql`select id from t`.describe();
      expect(await rejection(query())).toMatchObject({ errno: "42P01" });
      expect((await query()).columns).toHaveLength(1);
      expect(written).toEqual(["P", "D", "S", "P", "D", "S"]);
    } finally {
      server.close();
    }
  });
});

describe("the other adapters", () => {
  test.each(["sqlite://:memory:", "mysql://user@127.0.0.1:1/db"])("%s", async url => {
    await using sql = new SQL(url);
    expect(await rejection(sql`select 1`.describe())).toMatchObject({
      name: "Error",
      message: "describe() is not supported by this adapter (PostgreSQL only)",
    });
  });

  test("after the query started", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const query = sql`select 1 as one`;
    expect(await query).toEqual([{ one: 1 }]);
    expect(() => query.describe()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  });
});
