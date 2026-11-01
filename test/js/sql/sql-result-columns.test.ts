// The expected values are what postgres.js 3.4.9 (`result.columns`, `result.statement`) and mysql2 3.24.6 (`fields`) report, but for
// `number` of a system column (postgres.js reads it unsigned, 65535) and the type of a MariaDB JSON column (mysql2 says 252).
import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { pgCommandComplete, pgDataRow, pgMockServer, pgReadyForQuery, pgRowDescription } from "./wire-frames";

const randomName = () => "rc_" + randomUUIDv7("hex").replaceAll("-", "");
const columnsOf = async (query: PromiseLike<any>) => (await query).columns;
const namesOf = (result: any) => result.columns.map((column: any) => column.name);
async function columnsOnReserved(sql: SQL, text: string) {
  using reserved = await sql.reserve();
  return await columnsOf(reserved.unsafe(text));
}

async function collected(ref: WeakRef<object>) {
  for (let i = 0; i < 50 && ref.deref() !== undefined; i++) {
    // What deref() returned stays alive until the end of the job.
    await new Promise<void>(resolve => setImmediate(resolve));
    Bun.gc(true);
  }
  return ref.deref() === undefined;
}

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  beforeAll(() => container.ready);
  const connect = (options: object = {}) =>
    new SQL(`postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, {
      max: 1,
      ...options,
    } as never);

  async function people(sql: SQL) {
    const name = randomName();
    await sql.unsafe(`create temporary table ${name} (id serial primary key, user_name text, tags text[], data jsonb)`);
    await sql.unsafe(`insert into ${name} (user_name, tags, data) values ('a', '{x}', '["x"]')`);
    const [{ oid }] = await sql.unsafe(`select '${name}'::regclass::oid::int as oid`);
    return { name, oid: oid as number };
  }

  test("a column has its name, the OID of its type, the OID of its table and its number in the table", async () => {
    await using sql = connect();
    const { name, oid } = await people(sql);
    const result = await sql.unsafe(
      `select ctid, id, user_name as un, tags, data, 1 as x, 2 as x, id + 1 as "1", 'a' as "01", 1.5 as "é日本😀" from ${name}`,
    );
    expect(result.columns).toEqual([
      { name: "ctid", type: 27, table: oid, number: -1 },
      { name: "id", type: 23, table: oid, number: 1 },
      { name: "un", type: 25, table: oid, number: 2 },
      { name: "tags", type: 1009, table: oid, number: 3 },
      { name: "data", type: 3802, table: oid, number: 4 },
      { name: "x", type: 23, table: 0, number: 0 },
      { name: "x", type: 23, table: 0, number: 0 },
      { name: "1", type: 23, table: 0, number: 0 },
      { name: "01", type: 25, table: 0, number: 0 },
      { name: "é日本😀", type: 1700, table: 0, number: 0 },
    ]);
    // text[] and jsonb give the same value, and a row has one `x`
    expect(result).toEqual([
      { 1: 2, ctid: "(0,1)", id: 1, un: "a", tags: ["x"], data: ["x"], x: 2, "01": "a", "é日本😀": "1.5" },
    ]);
  });

  test.each([{}, { prepare: false }, { bigint: true }])("every way to run a query brings them, %j", async options => {
    await using sql = connect(options);
    const { name, oid } = await people(sql);
    const text = `select id, user_name as un from ${name}`;
    const table = sql(name);

    const columns = [
      { name: "id", type: 23, table: oid, number: 1 },
      { name: "un", type: 25, table: oid, number: 2 },
    ];
    expect({
      tagged: await columnsOf(sql`select id, user_name as un from ${table}`),
      again: await columnsOf(sql`select id, user_name as un from ${table}`),
      parameter: await columnsOf(sql`select id, user_name as un from ${table} where id = ${1}`),
      noRows: await columnsOf(sql`select id, user_name as un from ${table} where id = ${-1}`),
      simple: await columnsOf(sql`select id, user_name as un from ${table}`.simple()),
      unsafe: await columnsOf(sql.unsafe(text)),
      unsafeWithValues: await columnsOf(sql.unsafe(text + " where id = $1", [1])),
      values: await columnsOf(sql`select id, user_name as un from ${table}`.values()),
      raw: await columnsOf(sql`select id, user_name as un from ${table}`.raw()),
      returning: await columnsOf(sql`update ${table} set user_name = ${"b"} returning id, user_name as un`),
      begin: await sql.begin(tx => columnsOf(tx.unsafe(text))),
      reserved: await columnsOnReserved(sql, text),
    }).toEqual({
      tagged: columns,
      again: columns,
      parameter: columns,
      noRows: columns,
      simple: columns,
      unsafe: columns,
      unsafeWithValues: columns,
      values: columns,
      raw: columns,
      returning: columns,
      begin: columns,
      reserved: columns,
    });
  });

  test.each([{}, { prepare: false }])(
    "statement is the text, the types the server gave the parameters, and the columns, %j",
    async options => {
      await using sql = connect(options);
      const { name, oid } = await people(sql);
      const text = `select id from ${name} where id = $1 and user_name = $2 and tags = $3 and data = $4`;
      const result = await sql.unsafe(text, [1, "a", ["x"], ["x"]]);
      expect(result).toEqual([{ id: 1 }]);
      expect(result.statement).toEqual({
        string: text,
        types: [23, 25, 1009, 3802],
        columns: [{ name: "id", type: 23, table: oid, number: 1 }],
      });
      expect(Object.keys(result.statement)).toEqual(["string", "types", "columns"]);
      expect(result.columns).toBe(result.statement.columns);
    },
  );

  test("a command that returns no rows has no columns", async () => {
    await using sql = connect();
    const name = randomName();
    const text = `create temporary table ${name} (id int)`;
    expect((await sql.unsafe(text)).statement).toEqual({ string: text, types: [], columns: [] });
    for (let i = 0; i < 2; i++) {
      expect((await sql`insert into ${sql(name)} values (${i})`).statement).toEqual({
        string: expect.stringContaining("insert into"),
        types: [23],
        columns: [],
      });
    }
    expect(await columnsOf(sql.unsafe(""))).toEqual([]);
  });

  test("each result of several statements has its own, and none from the result before it", async () => {
    await using sql = connect();
    const name = randomName();
    const text = `select 1 as x; create temporary table ${name} (id int); select 'hi' as y, 2 as z; drop table ${name}`;
    const results = await sql.unsafe(text);
    expect(results.map((result: any) => result.statement)).toEqual([
      { string: text, types: [], columns: [{ name: "x", type: 23, table: 0, number: 0 }] },
      { string: text, types: [], columns: [] },
      {
        string: text,
        types: [],
        columns: [
          { name: "y", type: 25, table: 0, number: 0 },
          { name: "z", type: 23, table: 0, number: 0 },
        ],
      },
      { string: text, types: [], columns: [] },
    ]);
  });

  test.each([{}, { prepare: false }])(
    "they can be read late, in any order, after the client closed, %j",
    async options => {
      const sql = connect(options);
      const results = await sql.unsafe("select 1 as a; select 2 as b, 3 as c; set application_name = 'x'");
      const one = await sql`select ${1}::int4 as d`;
      await sql.close();
      Bun.gc(true);
      expect([results[2], one, results[1], results[0]].map(namesOf)).toEqual([[], ["d"], ["b", "c"], ["a"]]);
      expect(one.statement.types).toEqual([23]);
      expect(results[1].statement).toBe(results[1].statement);
    },
  );

  test("the runs of a prepared statement share one object, which only their results keep alive", async () => {
    await using sql = connect();
    const query = () => sql`select ${1}::int4 as id, 'hi' as msg`;
    const first = await query();
    expect((await query()).statement).toBe(first.statement);
    Bun.gc(true);
    expect((await query()).statement).toBe(first.statement);

    // in a function, so that no result is left in this frame
    const other = async () => new WeakRef((await sql`select ${1}::int4 as other`).statement);
    expect(await collected(await other())).toBe(true);
    expect(await columnsOf(sql`select ${1}::int4 as other`)).toEqual([
      { name: "other", type: 23, table: 0, number: 0 },
    ]);
  });

  test("more columns than a row shape caches", async () => {
    await using sql = connect();
    const text = "select " + Array.from({ length: 70 }, (_, i) => `${i} as c${i}`).join(", ");
    const columns = Array.from({ length: 70 }, (_, i) => ({ name: `c${i}`, type: 23, table: 0, number: 0 }));
    expect(await columnsOf(sql.unsafe(text))).toEqual(columns);
    expect(await columnsOf(sql.unsafe(text + " where 1 = $1", [1]))).toEqual(columns);
  });

  test("a prepared statement whose table changed is described again", async () => {
    await using sql = connect();
    const { name, oid } = await people(sql);
    const query = () => sql`select * from ${sql(name)} where id = ${1}`;
    expect(namesOf(await query())).toEqual(["id", "user_name", "tags", "data"]);
    await sql.unsafe(
      `alter table ${name} drop column tags, add column extra int8, alter column user_name type varchar(9)`,
    );
    const result = await query();
    expect(result).toEqual([{ id: 1, user_name: "a", data: ["x"], extra: null }]);
    expect(result.columns).toEqual([
      { name: "id", type: 23, table: oid, number: 1 },
      { name: "user_name", type: 1043, table: oid, number: 2 },
      { name: "data", type: 3802, table: oid, number: 4 },
      { name: "extra", type: 20, table: oid, number: 5 },
    ]);
  });

  test("the names are what transform.column.from made of them", async () => {
    await using sql = connect({ transform: SQL.camel });
    for (let i = 0; i < 2; i++) {
      const result = await sql`select 1 as user_id, 2 as "userId", 3 as first_name where 1 = ${1}`;
      expect(result).toEqual([{ userId: 2, firstName: 3 }]);
      expect(namesOf(result)).toEqual(["userId", "userId", "firstName"]);
    }
    expect(namesOf(await sql`select 1 as user_id`.values())).toEqual(["userId"]);
    expect(namesOf(await sql`select 1 as user_id`.simple())).toEqual(["userId"]);
  });
});

// A server hands out OIDs from 16384 upwards: 2^31 takes two thousand million objects.
test("postgres: an OID over 2^31 is not negative", async () => {
  const { port, server } = await pgMockServer(type => {
    if (type !== "Q") return;
    return [
      pgRowDescription([{ name: "a", typeOid: 4_000_000_000 | 0, tableOid: 0xffff_ffff | 0, columnAttr: 1600 }]),
      pgDataRow([Buffer.from("v")]),
      pgCommandComplete("SELECT 1"),
      pgReadyForQuery(),
    ];
  });
  try {
    await using sql = new SQL(`postgres://u@127.0.0.1:${port}/db`, { max: 1 });
    const result = await sql`select a from t`.simple();
    expect(result).toEqual([{ a: "v" }]);
    expect(result.columns).toEqual([{ name: "a", type: 4_000_000_000, table: 0xffff_ffff, number: 1600 }]);
  } finally {
    server.close();
  }
});

for (const [dialect, image] of [
  ["mysql", "mysql_plain"],
  ["mariadb", "mariadb_plain"],
] as const) {
  describeWithContainer(dialect, { image, concurrent: true }, container => {
    beforeAll(() => container.ready);
    const connect = (options: object = {}) =>
      new SQL(`mysql://root@${container.host}:${container.port}/bun_sql_test`, { max: 1, ...options } as never);
    const by = <T>(values: { mysql: T; mariadb: T }) => values[dialect];
    /** `select 1` */
    const one = by({ mysql: { type: 8, table: "", length: 2, flags: 129 }, mariadb: { type: 3, table: "", length: 1, flags: 129 } }); // prettier-ignore

    async function people(sql: SQL) {
      const name = randomName();
      await sql.unsafe(
        `create temporary table ${name} (id int auto_increment primary key, user_name varchar(20) not null,
          big bigint unsigned, data json, note text, at datetime, b blob)`,
      );
      await sql.unsafe(`insert into ${name} (user_name, data) values ('a', '[1]')`);
      return name;
    }

    test("a column has its name, its type, its table, its length and its flags", async () => {
      await using sql = connect();
      const name = await people(sql);
      const long = "a_name_that_is_longer_than_what_fits_inline";
      const text =
        `select id, user_name as un, big, data, note, at, b, 1 as x, 2 as x, 3 as \`1\`, 4 as \`01\`, ` +
        `id + 1 as \`é日本\`, id as ${long} from ${name} as ${long}`;
      const columns = [
        { name: "id", type: 3, table: long, length: 11, flags: 16899 },
        { name: "un", type: 253, table: long, length: 80, flags: 4097 },
        { name: "big", type: 8, table: long, length: 20, flags: 32 },
        { name: "data", type: 245, table: long, length: 4294967295, flags: 144 },
        { name: "note", type: 252, table: long, length: 262140, flags: 16 },
        { name: "at", type: 12, table: long, length: 19, flags: 128 },
        { name: "b", type: 252, table: long, length: 65535, flags: 144 },
        { name: "x", ...one },
        { name: "x", ...one },
        { name: "1", ...one },
        { name: "01", ...one },
        { name: "é日本", type: 8, table: "", length: 12, flags: 129 },
        { name: long, type: 3, table: long, length: 11, flags: 16899 },
      ];
      // the text protocol, then the binary one twice: an execution brings the definitions again
      expect(await columnsOf(sql.unsafe(text))).toEqual(columns);
      for (let i = 0; i < 2; i++) {
        const result = await sql.unsafe(text + " where 1 = ?", [1]);
        Bun.gc(true);
        expect(result.columns).toEqual(columns);
        expect(Object.keys(result[0])).toEqual(["1", "id", "un", "big", "data", "note", "at", "b", "x", "01", "é日本", long]); // prettier-ignore
      }
    });

    test("every way to run a query brings them", async () => {
      await using sql = connect();
      const name = await people(sql);
      const text = `select id, user_name as un from ${name}`;
      const table = sql(name);

      const columns = [
        { name: "id", type: 3, table: name, length: 11, flags: 16899 },
        { name: "un", type: 253, table: name, length: 80, flags: 4097 },
      ];
      expect({
        tagged: await columnsOf(sql`select id, user_name as un from ${table}`),
        again: await columnsOf(sql`select id, user_name as un from ${table}`),
        parameter: await columnsOf(sql`select id, user_name as un from ${table} where id = ${1}`),
        noRows: await columnsOf(sql`select id, user_name as un from ${table} where id = ${-1}`),
        simple: await columnsOf(sql`select id, user_name as un from ${table}`.simple()),
        unsafe: await columnsOf(sql.unsafe(text)),
        unsafeWithValues: await columnsOf(sql.unsafe(text + " where id = ?", [1])),
        values: await columnsOf(sql`select id, user_name as un from ${table}`.values()),
        raw: await columnsOf(sql`select id, user_name as un from ${table}`.raw()),
        begin: await sql.begin(tx => columnsOf(tx.unsafe(text))),
        reserved: await columnsOnReserved(sql, text),
      }).toEqual({
        tagged: columns,
        again: columns,
        parameter: columns,
        noRows: columns,
        simple: columns,
        unsafe: columns,
        unsafeWithValues: columns,
        values: columns,
        raw: columns,
        begin: columns,
        reserved: columns,
      });
    });

    test("statement is the text, the types the server gave the parameters, and the columns", async () => {
      await using sql = connect();
      const name = await people(sql);
      const text = `select id from ${name} where id = ? and user_name = ? and big is null and 2 = ?`;
      const result = await sql.unsafe(text, [1, "a", 2]);
      expect(result).toEqual([{ id: 1 }]);
      expect(result.statement).toEqual({
        string: text,
        // MariaDB does not type a parameter
        types: by({ mysql: [8, 253, 8], mariadb: [6, 6, 6] }),
        columns: [{ name: "id", type: 3, table: name, length: 11, flags: 16899 }],
      });
      expect(Object.keys(result.statement)).toEqual(["string", "types", "columns"]);
      expect(result.columns).toBe(result.statement.columns);
    });

    test("a command that returns no rows has no columns", async () => {
      await using sql = connect();
      const name = await people(sql);
      const text = `update ${name} set note = 'n'`;
      expect((await sql.unsafe(text)).statement).toEqual({ string: text, types: [], columns: [] });
      for (let i = 0; i < 2; i++) {
        expect(await columnsOf(sql`update ${sql(name)} set note = ${"m" + i}`)).toEqual([]);
      }
    });

    test("each result of several statements has its own, and none from the result before it", async () => {
      await using sql = connect();
      const results = await sql.unsafe("select 1 as x; set @rc := 1; select 1 as y; select 1 as y, 1 as z; do 1");
      expect(results.map((result: any) => result.columns)).toEqual([
        [{ name: "x", ...one }],
        [],
        [{ name: "y", ...one }],
        [
          { name: "y", ...one },
          { name: "z", ...one },
        ],
        [],
      ]);
    });

    test("each result set of a CALL has its own, prepared or not", async () => {
      await using sql = connect();
      const name = randomName();
      // as many columns each time; then only the type differs, then only a leading zero
      await sql.unsafe(`create procedure ${name}() begin
        select 1 as value; select 'hi' as value; select 1 as \`1\`; select 1 as \`01\`;
      end`);
      try {
        for (const call of [
          () => sql`call ${sql(name)}()`,
          () => sql`call ${sql(name)}()`,
          () => sql.unsafe(`call ${name}()`),
        ])
          // prettier-ignore
          expect((await call()).map((result: any) => result.columns.map((c: any) => [c.name, c.type]))).toEqual([
            [["value", one.type]],
            [["value", 253]],
            [["1", one.type]],
            [["01", one.type]],
            // the OK packet that ends the CALL
            [],
          ]);
      } finally {
        await sql.unsafe(`drop procedure ${name}`);
      }
    });

    test("they can be read late, in any order, after the client closed", async () => {
      const sql = connect();
      const results = await sql.unsafe("select 1 as a; select 2 as b, 3 as c; set @rc := 1");
      await sql.close();
      Bun.gc(true);
      expect([results[2], results[1], results[0]].map(namesOf)).toEqual([[], ["b", "c"], ["a"]]);
      expect(results[1].statement).toBe(results[1].statement);
    });

    test("the runs of a prepared statement share one object, which only their results keep alive", async () => {
      await using sql = connect();
      const query = (value: string) => sql`select ${value} as msg, 1 as id`;
      const first = await query("a");
      expect((await query("a")).statement).toBe(first.statement);
      Bun.gc(true);
      expect((await query("a")).statement).toBe(first.statement);

      // MariaDB derives the column from the value that was bound. MySQL describes the parameter.
      const longer = await query("abcdefghij");
      expect(longer).toEqual([{ msg: "abcdefghij", id: 1 }]);
      expect([first.columns[0].length, longer.columns[0].length]).toEqual(
        by({ mysql: [65532, 65532], mariadb: [4, 40] }),
      );
      expect(longer.statement === first.statement).toBe(dialect === "mysql");

      // in a function, so that no result is left in this frame
      const other = async () => new WeakRef((await sql`select ${1} as other`).statement);
      expect(await collected(await other())).toBe(true);
      expect(namesOf(await sql`select ${1} as other`)).toEqual(["other"]);
    });

    test("more columns than a row shape caches", async () => {
      await using sql = connect();
      const text = "select " + Array.from({ length: 70 }, (_, i) => `1 as c${i}`).join(", ");
      const columns = Array.from({ length: 70 }, (_, i) => ({ name: `c${i}`, ...one }));
      expect(await columnsOf(sql.unsafe(text))).toEqual(columns);
      expect(await columnsOf(sql.unsafe(text + " where 1 = ?", [1]))).toEqual(columns);
    });

    test("a prepared statement whose table changed is described again", async () => {
      await using sql = connect();
      const name = randomName();
      await sql.unsafe(`create temporary table ${name} (id int, a varchar(20), b int)`);
      await sql.unsafe(`insert into ${name} values (1, 'a', 2)`);
      const query = () => sql`select * from ${sql(name)} where id = ${1}`;
      const describe = (result: any) => result.columns.map((c: any) => [c.name, c.type]);
      expect(describe(await query())).toEqual([["id", 3], ["a", 253], ["b", 3]]); // prettier-ignore
      // as many columns, one with another type
      await sql.unsafe(`alter table ${name} modify column a text`);
      expect(describe(await query())).toEqual([["id", 3], ["a", 252], ["b", 3]]); // prettier-ignore
      await sql.unsafe(`alter table ${name} drop column b, add column c bigint, add column d int`);
      const result = await query();
      expect(describe(result)).toEqual([["id", 3], ["a", 252], ["c", 8], ["d", 3]]); // prettier-ignore
      expect(result).toEqual([{ id: 1, a: "a", c: null, d: null }]);
    });

    test("the names are what transform.column.from made of them", async () => {
      await using sql = connect({ transform: SQL.camel });
      for (let i = 0; i < 2; i++) {
        const result = await sql`select 1 as user_id, 2 as userId, 3 as first_name where 1 = ${1}`;
        expect(result).toEqual([{ userId: 2, firstName: 3 }]);
        expect(namesOf(result)).toEqual(["userId", "userId", "firstName"]);
      }
      expect(namesOf(await sql`select 1 as user_id`.values())).toEqual(["userId"]);
      expect(namesOf(await sql`select 1 as user_id`.simple())).toEqual(["userId"]);
    });

    test("a column that is described differently under the same name is not renamed again", async () => {
      const calls: string[] = [];
      await using sql = connect({ transform: { column: (name: string) => (calls.push(name), SQL.toCamel(name)) } });
      const lengths: number[] = [];
      for (const value of ["a", "abcdefghij", "a"]) {
        const result = await sql`select ${value} as user_name`;
        expect(result).toEqual([{ userName: value }]);
        expect(namesOf(result)).toEqual(["userName"]);
        lengths.push(result.columns[0].length);
      }
      expect(lengths).toEqual(by({ mysql: [65532, 65532, 65532], mariadb: [4, 40, 4] }));
      expect(calls).toEqual(["user_name"]);
    });
  });
}

describe("sqlite", () => {
  test("has neither: the statement is gone when the result is there", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const result = await sql`select 1 as x`;
    expect(result).toEqual([{ x: 1 }]);
    expect({ statement: result.statement, columns: result.columns }).toEqual({ statement: null, columns: null });
  });
});
