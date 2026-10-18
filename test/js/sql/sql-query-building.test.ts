import { SQL, randomUUIDv7 } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

type Dialect = "sqlite" | "postgres" | "mysql" | "mariadb";

const idColumn: Record<Dialect, string> = {
  sqlite: "integer primary key autoincrement",
  postgres: "serial primary key",
  mysql: "int auto_increment primary key",
  mariadb: "int auto_increment primary key",
};
const jsonColumn: Record<Dialect, string> = { sqlite: "text", postgres: "jsonb", mysql: "json", mariadb: "json" };
const randomName = () => "qb_" + randomUUIDv7("hex").replaceAll("-", "");

function meta(result: any) {
  return {
    rows: result.length,
    count: result.count,
    command: result.command,
    affectedRows: result.affectedRows,
    lastInsertRowid: result.lastInsertRowid,
  };
}

function suite(dialect: Dialect, url: () => string) {
  const connect = () => new SQL(url(), { max: 1 });
  const isMySQL = dialect === "mysql" || dialect === "mariadb";
  const quote = isMySQL ? "`" : '"';
  const by = <T>(values: { sqlite: T; postgres: T; mysql: T; mariadb?: T }): T =>
    dialect === "mariadb" ? (values.mariadb ?? values.mysql) : values[dialect];

  // The name and not the fragment: an async function would await the fragment.
  async function tableOf(sql: SQL, columns: string) {
    const name = randomName();
    await sql`create temporary table ${sql(name)} (${sql.unsafe(columns)})`;
    return name;
  }

  describe("result", () => {
    test("count, command, affectedRows and lastInsertRowid mean the same on every adapter", async () => {
      await using sql = connect();
      const source = sql(randomName());
      const target = sql(randomName());
      const id = sql.unsafe(idColumn[dialect]);
      const command = (name: string) => (isMySQL ? null : name);
      // "none": PostgreSQL has no such thing, MySQL says 0, SQLite keeps the last one for a write and has none for a read
      const none = by<unknown>({ sqlite: expect.any(Number), postgres: null, mysql: 0 });

      expect({
        create: meta(await sql`create temporary table ${source} (id ${id}, v varchar(20))`),
        insert: meta(await sql`insert into ${source} (v) values ('a'), ('b'), ('c')`),
        create2: meta(await sql`create temporary table ${target} (id ${id}, v varchar(20))`).rows,
        insertSelect: meta(await sql`insert into ${target} (v) select v from ${source} where id > ${1}`),
        select: meta(await sql`select v from ${source} where id > ${1}`),
        selectNothing: meta(await sql`select v from ${source} where id > ${100}`),
        update: meta(
          await sql`update ${source} set v = ${"z"} where id in (
          select id from ${target}
        )`,
        ),
        delete: meta(await sql`delete from ${source} where id = ${3}`),
        deleteNothing: meta(await sql`delete from ${source} where id = ${3}`),
      }).toEqual({
        create: {
          rows: 0,
          count: 0,
          command: by({ sqlite: "CREATE", postgres: "CREATE TABLE", mysql: null }),
          affectedRows: 0,
          lastInsertRowid: by({ sqlite: 0, postgres: null, mysql: 0 }),
        },
        insert: {
          rows: 0,
          count: 3,
          command: command("INSERT"),
          affectedRows: 3,
          // MySQL reports the first key of the statement, SQLite the last
          lastInsertRowid: by({ sqlite: 3, postgres: null, mysql: 1 }),
        },
        create2: 0,
        insertSelect: {
          rows: 0,
          count: 2,
          command: command("INSERT"),
          affectedRows: 2,
          lastInsertRowid: by({ sqlite: 2, postgres: null, mysql: 1 }),
        },
        select: {
          rows: 2,
          count: 2,
          command: command("SELECT"),
          affectedRows: 0,
          lastInsertRowid: by({ sqlite: null, postgres: null, mysql: 0 }),
        },
        selectNothing: {
          rows: 0,
          count: 0,
          command: command("SELECT"),
          affectedRows: 0,
          lastInsertRowid: by({ sqlite: null, postgres: null, mysql: 0 }),
        },
        update: { rows: 0, count: 2, command: command("UPDATE"), affectedRows: 2, lastInsertRowid: none },
        delete: { rows: 0, count: 1, command: command("DELETE"), affectedRows: 1, lastInsertRowid: none },
        deleteNothing: { rows: 0, count: 0, command: command("DELETE"), affectedRows: 0, lastInsertRowid: none },
      });
    });

    test.skipIf(dialect === "mysql")("a write with RETURNING", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, `id ${idColumn[dialect]}, v varchar(20)`));
      const result = await sql`insert into ${table} ${sql([{ v: "a" }, { v: "b" }])}returning id`;
      expect([...result]).toEqual([{ id: 1 }, { id: 2 }]);
      expect(meta(result)).toEqual({
        rows: 2,
        count: 2,
        command: isMySQL ? null : "INSERT",
        // MariaDB sends the rows as a result set, whose terminator counts nothing
        affectedRows: by({ sqlite: 2, postgres: 2, mysql: 0 }),
        lastInsertRowid: by({ sqlite: 2, postgres: null, mysql: 0 }),
      });
    });

    test.skipIf(dialect === "sqlite")("each result of a multi-statement query has its own numbers", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int"));
      const results =
        await sql`insert into ${table} values (1), (2); select id from ${table}; delete from ${table}`.simple();
      expect(results.map(meta).map(({ rows, count, affectedRows }) => ({ rows, count, affectedRows }))).toEqual([
        { rows: 0, count: 2, affectedRows: 2 },
        { rows: 2, count: 2, affectedRows: 0 },
        { rows: 0, count: 2, affectedRows: 2 },
      ]);
    });

    test("count, command, lastInsertRowid and affectedRows are own and enumerable, so console.log shows them", async () => {
      await using sql = connect();
      const rows = await sql`select 1 as a union all select 2 as a`;
      const forIn: string[] = [];
      for (const key in rows) forIn.push(key);
      const metadata = ["count", "command", "lastInsertRowid", "affectedRows"];

      expect({
        isArray: Array.isArray(rows),
        keys: Object.keys(rows),
        forIn,
        own: Object.getOwnPropertyNames(rows),
        spread: Object.keys({ ...rows }),
        inspected: /count: 2,/.test(Bun.inspect(rows)),
        json: JSON.stringify(rows),
        clone: Object.keys(structuredClone(rows)),
        mapped: rows.map((row: any) => row.a).constructor,
        count: rows.count,
      }).toEqual({
        isArray: true,
        keys: ["0", "1", ...metadata],
        forIn: ["0", "1", ...metadata],
        own: ["0", "1", "length", ...metadata],
        spread: ["0", "1", ...metadata],
        inspected: true,
        json: '[{"a":1},{"a":2}]',
        clone: ["0", "1", ...metadata],
        mapped: Array,
        count: 2,
      });
      expect(rows).toEqual([{ a: 1 }, { a: 2 }]);

      rows.count = 7;
      expect(rows.count).toBe(7);
    });
  });

  describe("the keyword before a helper", () => {
    test("is found whatever its case, the white space, the quoting or the comments around it", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int primary key, a int, b varchar(40)"));
      const spaced = sql("my set x " + randomName());
      await sql`create temporary table ${spaced} (id int)`;
      const accented = sql.unsafe(randomName() + "éin");
      await sql`create temporary table ${accented} (id int)`;
      const read = async (id: number) => (await sql`select a, b from ${table} where id = ${id}`)[0];

      await sql`insert into ${table} ${sql({ id: 1, a: 1, b: "x" })}`;
      await sql`INSERT INTO ${table} ${sql({ id: 2, a: 1, b: "x" })}`;
      await sql`Insert\n\tInto\r\n${table}\n${sql({ id: 3, a: 1, b: "x" })}`;
      await sql`insert into ${table} /* don't */ ${sql({ id: 4, a: 1, b: "x" })}`;
      await sql`insert into ${table} /* set */ -- it's in here
        ${sql({ id: 5, a: 1, b: "x" })}`;
      await sql`insert into ${spaced} ${sql({ id: 1 })}`;
      await sql`insert into ${accented} ${sql({ id: 1 })}`;
      expect((await sql`select id from ${table} order by id`).map((row: any) => row.id)).toEqual([1, 2, 3, 4, 5]);
      expect(await sql`select id from ${spaced}`).toEqual([{ id: 1 }]);
      expect(await sql`select id from ${accented}`).toEqual([{ id: 1 }]);

      await sql`update ${table} set ${sql({ a: 2 })} where id = 1`;
      expect(await read(1)).toEqual({ a: 2, b: "x" });
      await sql`UPDATE ${table} SET ${sql({ a: 3 })} WHERE id = 1`;
      expect(await read(1)).toEqual({ a: 3, b: "x" });
      await sql`update ${table} ${sql({ a: 4 })} where id = 1`;
      expect(await read(1)).toEqual({ a: 4, b: "x" });
      await sql`update ${table} set b = ' in ', ${sql({ a: 5 })} where id = 1`;
      expect(await read(1)).toEqual({ a: 5, b: " in " });
      await sql`update ${table} set b = 'it''s where y', ${sql({ a: 6 })} where id = 1`;
      expect(await read(1)).toEqual({ a: 6, b: "it's where y" });
      await sql`update ${table} set${sql("b")}= 'q', ${sql({ a: 7 })} where id = 1`;
      expect(await read(1)).toEqual({ a: 7, b: "q" });

      const ids = (rows: any[]) => rows.map(row => row.id);
      expect(ids(await sql`select id from ${table} where id in ${sql([1, 3])} order by id`)).toEqual([1, 3]);
      expect(ids(await sql`select id from ${table} WHERE id IN ${sql([1, 3])} order by id`)).toEqual([1, 3]);
      expect(ids(await sql`select id from ${table} where id not in ${sql([1, 3])} order by id`)).toEqual([2, 4, 5]);
      expect(ids(await sql`select id from ${table} where id in/* c */${sql([1, 3])} order by id`)).toEqual([1, 3]);
      expect(ids(await sql`select id from ${table} where b = 'x' and id in ${sql([{ id: 2 }], "id")}`)).toEqual([2]);

      // Dashes in quotes on the line before the helper begin no comment.
      expect(ids(await sql`select id from ${table} where b <> 'x--y' and id in\n${sql([1, 3])} order by id`)).toEqual([1, 3]); // prettier-ignore
      expect(ids(await sql`select id from ${table} where b <> 'it''s--y' and id in\n${sql([1, 3])} order by id`)).toEqual([1, 3]); // prettier-ignore
      expect(ids(await sql`select id from ${table} as ${sql("a--b")} where id in\n${sql([1, 3])} order by id`)).toEqual([1, 3]); // prettier-ignore
      expect(ids(await sql`select id from ${table} where b <> 'x--y' and id in -- set 'it\n${sql([1, 3])} order by id`)).toEqual([1, 3]); // prettier-ignore
    });

    test("an upsert takes assignments", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int primary key, a int, b int"));
      const row = { id: 1, a: 1, b: 1 };
      await sql`insert into ${table} ${sql(row)}`;
      const read = async () => (await sql`select a, b from ${table}`)[0];

      if (isMySQL) {
        await sql`insert into ${table} ${sql(row)} ON DUPLICATE KEY UPDATE ${sql({ a: 2 })}`;
        expect(await read()).toEqual({ a: 2, b: 1 });
        await sql`insert into ${table} ${sql(row)} on duplicate key update ${sql({ a: 3 })}`;
        expect(await read()).toEqual({ a: 3, b: 1 });
        await sql`insert into ${table} ${sql(row)} On  Duplicate\n Key\tUpdate\n${sql({ a: 4 })}`;
        expect(await read()).toEqual({ a: 4, b: 1 });
        await sql`insert into ${table} ${sql(row)} on duplicate key update /* c */ ${sql({ a: 5 })}`;
        expect(await read()).toEqual({ a: 5, b: 1 });
        await sql`insert into ${table} ${sql(row)} on duplicate key update b = 2, ${sql({ a: 6 })}`;
        expect(await read()).toEqual({ a: 6, b: 2 });
      } else {
        await sql`insert into ${table} ${sql(row)} on conflict (id) do update set ${sql({ a: 2 })}`;
        expect(await read()).toEqual({ a: 2, b: 1 });
        await sql`insert into ${table} ${sql(row)} on conflict (id) do update ${sql({ a: 3 })}`;
        expect(await read()).toEqual({ a: 3, b: 1 });
      }
    });

    test("is required", async () => {
      await using sql = connect();
      for (const query of [
        () => sql`select ${sql({ a: 1 })}`,
        () => sql`select 1 where ${sql({ a: 1 })}`,
        () => sql`select 'insert into' , ${sql({ a: 1 })}`,
        () => sql`${sql([1])}`,
      ]) {
        const error = await query().catch((e: any) => e);
        expect(error).toBeInstanceOf(SyntaxError);
        expect(error.message).toBe("Helpers are only allowed for INSERT, UPDATE and IN commands");
      }
    });
  });

  describe("values", () => {
    test("a fragment works wherever a value does", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a int, b int"));

      await sql`insert into ${table} ${sql({ id: 1, a: sql`1 + 1`, b: 5 })}`;
      await sql`insert into ${table} ${sql([
        { id: 2, a: sql`${20} + 1`, b: 6 },
        { id: 3, a: 30, b: sql`${3} * ${4}` },
      ])}`;
      expect(await sql`select * from ${table} order by id`).toEqual([
        { id: 1, a: 2, b: 5 },
        { id: 2, a: 21, b: 6 },
        { id: 3, a: 30, b: 12 },
      ]);

      await sql`update ${table} set ${sql({ a: sql`a + ${5}`, b: 0 })} where id = ${1}`;
      expect(await sql`select * from ${table} where id = 1`).toEqual([{ id: 1, a: 7, b: 0 }]);

      expect(await sql`select id from ${table} where id in ${sql([1, sql`1 + ${1}`])} order by id`).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
    });

    test("an array of fragments is joined, not bound", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int"));
      await sql`insert into ${table} ${sql([{ id: 1 }, { id: 2 }, { id: 3 }])}`;
      const conditions = [sql`id = ${1}`, sql`or id = ${3}`];
      expect(await sql`select id from ${table} where ${conditions} order by id`).toEqual([{ id: 1 }, { id: 3 }]);
    });

    test("a helper in a fragment sees the keyword of the outer text", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int"));
      await sql`insert into ${table} ${sql`${sql([{ id: 1 }, { id: 2 }])}`}`;
      expect(await sql`select id from ${table} where id in ${sql`${sql([2, 3])}`}`).toEqual([{ id: 2 }]);
    });

    test("insert takes the keys of the first row: a column that only a later row names gets its default", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a varchar(20), b varchar(20) default 'default'"));
      await sql`insert into ${table} ${sql([
        { id: 1, a: "only a" },
        { id: 2, a: "both", b: "dropped" },
        { id: 3, b: "dropped" },
      ])}`;
      expect(await sql`select * from ${table} order by id`).toEqual([
        { id: 1, a: "only a", b: "default" },
        { id: 2, a: "both", b: "default" },
        { id: 3, a: null, b: "default" },
      ]);
    });

    test("insert takes the columns that it is given, whatever the first row has", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a varchar(20), b varchar(20) default 'default'"));
      await sql`insert into ${table} ${sql(
        [
          { id: 1, a: "left out" },
          { id: 2, b: "kept" },
        ],
        "id",
        "b",
      )}`;
      expect(await sql`select * from ${table} order by id`).toEqual([
        { id: 1, a: null, b: null },
        { id: 2, a: null, b: "kept" },
      ]);
    });

    test("a first row without keys is no insert", async () => {
      await using sql = connect();
      for (const rows of [[{}, { id: 4 }], [{}], {}, [], [null, { id: 4 }]]) {
        const error = await sql`insert into t ${sql(rows as any)}`.catch((e: any) => e);
        expect(error).toBeInstanceOf(SyntaxError);
        expect(error.message).toBe("Cannot INSERT with no columns");
      }
    });

    test("many rows arrive in their places, with and without a fragment among the cells", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a varchar(20), b int"));
      const rows = Array.from({ length: 400 }, (_, id) => ({ id, a: id % 7 ? "a" + id : null, b: id * 3 }));
      const more = rows.map(row => ({ ...row, id: row.id + rows.length }));
      await sql`insert into ${table} ${sql(rows)}`;
      await sql`insert into ${table} ${sql(more.map(row => ({ ...row, id: sql`${row.id}` })))}`;
      expect(await sql`select * from ${table} order by id`).toEqual([...rows, ...more]);
    });

    test("undefined is NULL as a value, and no column when every row leaves it undefined", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a int default 7, b int default 8"));
      await sql`insert into ${table} ${sql([
        { id: 1, a: undefined, b: undefined },
        { id: 2, a: 1, b: undefined },
      ])}`;
      expect(await sql`select * from ${table} order by id`).toEqual([
        { id: 1, a: null, b: 8 },
        { id: 2, a: 1, b: 8 },
      ]);
      await sql`update ${table} set ${sql({ a: 2, b: undefined })} where id = ${1}`;
      expect(await sql`select * from ${table} where id = 1`).toEqual([{ id: 1, a: 2, b: 8 }]);
      expect(await sql`select id from ${table} where a is null or a = ${undefined}`).toEqual([]);
    });

    test("a row is read once", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a int"));
      const reads = { insert: 0, update: 0, list: 0 };
      await sql`insert into ${table} ${sql([
        {
          id: 1,
          get a() {
            return ++reads.insert;
          },
        },
      ])}`;
      await sql`update ${table} set ${sql({
        get a() {
          return ++reads.update;
        },
      })}`;
      await sql`select 1 as x from ${table} where a in ${sql(
        [
          {
            get a() {
              return ++reads.list;
            },
          },
        ],
        "a",
      )}`;
      expect(reads).toEqual({ insert: 1, update: 1, list: 1 });
    });

    test("what a row's getter throws is what the query rejects with", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int, a int"));
      const thrown = new Error("row getter");
      const row = {
        id: 1,
        get a() {
          throw thrown;
        },
      };
      expect(await sql`insert into ${table} ${sql(row)}`.catch((e: any) => e)).toBe(thrown);
      expect(await sql`insert into ${table} ${sql([row], "id", "a")}`.catch((e: any) => e)).toBe(thrown);
      expect(await sql`select id from ${table}`).toEqual([]);
    });

    test("an empty list matches nothing", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "id int"));
      await sql`insert into ${table} ${sql({ id: 1 })}`;
      expect(await sql`select id from ${table} where id in ${sql([])}`).toEqual([]);
      // SQLite has `()`, which nothing is in. The servers get `(NULL)`, and `x not in (NULL)` is not true either.
      expect(await sql`select id from ${table} where id not in ${sql([])}`).toEqual(
        dialect === "sqlite" ? [{ id: 1 }] : [],
      );
    });

    test("any string is a column name", async () => {
      await using sql = connect();
      const names = ["-1", "1e3", "Infinity", "a b", "select", "7"];
      const table = sql(await tableOf(sql, names.map(name => `${quote}${name}${quote} int`).join(", ")));
      const row = Object.fromEntries(names.map((name, i) => [name, i]));
      await sql`insert into ${table} ${sql(row)}`;
      expect(await sql`select * from ${table}`).toEqual([row]);

      await sql`update ${table} set ${sql({ 7: -7, select: 0 }, 7)}`;
      await sql`insert into ${table} ${sql([{ 7: 70 }], 7)}`;
      expect(await sql`select ${sql("7")}, ${sql("select")} from ${table} order by 1`).toEqual([
        { 7: -7, select: 4 },
        { 7: 70, select: null },
      ]);
    });

    test.each<Bun.SQL.Options>(dialect === "postgres" ? [{}, { prepare: false }] : [{}])(
      "sql.json() stores any value as JSON, once %p",
      async options => {
        await using sql = new SQL(url(), { max: 1, ...options });
        const name = await tableOf(sql, `id int, j ${jsonColumn[dialect]}`);
        const table = sql(name);
        const values = ["text", '{"not":"an object"}', "42", 1.5, true, null, { a: [1, "b"] }, [1, "b"], new Date(0)];
        for (let id = 0; id < values.length; id++) {
          await sql`insert into ${table} (id, j) values (${id}, ${sql.json(values[id])})`;
        }
        await sql`insert into ${table} ${sql({ id: 100, j: sql.json("in a helper") })}`;
        await sql`update ${table} set ${sql({ j: sql.json("in an update") })} where id = 100`;
        const placeholder = by({ sqlite: "?", postgres: "$1", mysql: "?" });
        await sql.unsafe(`insert into ${name} (id, j) values (101, ${placeholder})`, [sql.json("in unsafe()")]);
        const text = by({ sqlite: sql`j`, postgres: sql`j::text`, mysql: sql`cast(j as char)` });
        const stored = await sql`select ${text} as j from ${table} order by id`;
        expect(stored.map((row: any) => (row.j === null ? "SQL NULL" : JSON.parse(row.j)))).toEqual(
          JSON.parse(JSON.stringify([...values, "in an update", "in unsafe()"])),
        );
      },
    );
  });

  describe("sql.unsafe() with values", () => {
    const first = by({ sqlite: "?", postgres: "$1", mysql: "?" });

    test("as the first parameters of a query", async () => {
      await using sql = connect();
      const [row] = await sql`select ${sql.unsafe(`${first} as a`, [2])}, ${3} as b`;
      expect({ a: Number(row.a), b: Number(row.b) }).toEqual({ a: 2, b: 3 });
    });

    test("after other parameters", async () => {
      await using sql = connect();
      const query = sql`select ${3} as b, ${sql.unsafe(`${first} as a`, [2])}`;
      if (dialect === "postgres") {
        // its $1 would be the 3
        const error = await query.catch((e: any) => e);
        expect(error).toBeInstanceOf(SyntaxError);
        expect(error.message).toStartWith("Nested sql.unsafe() cannot have values when it follows other parameters");
        expect(await sql`select ${3} as b, ${sql.unsafe("$1 as a")}`.then(([row]) => Number(row.a))).toBe(3);
      } else {
        const [row] = await query;
        expect({ a: Number(row.a), b: Number(row.b) }).toEqual({ a: 2, b: 3 });
      }
    });

    describe("parts.map(sql.unsafe) passes the index, which is no values", () => {
      test("as fragments", async () => {
        await using sql = connect();
        const [a, b] = ["1 as a", "2 as b"].map(sql.unsafe as any);
        expect(await sql`select ${a}, ${b}`).toEqual([{ a: 1, b: 2 }]);
      });

      test("as fragments before a parameter", async () => {
        await using sql = connect();
        const [a, b] = ["1 as a", "2 as b"].map(sql.unsafe as any);
        const [row] = await sql`select ${a}, ${b}, ${3} as c`;
        expect({ ...row, c: Number(row.c) }).toEqual({ a: 1, b: 2, c: 3 });
      });
    });

    describe("a second argument that is not an array", () => {
      const run = (sql: SQL, text: string, values: unknown) =>
        sql.unsafe(text, values as any).catch((e: any) => e.message);

      test.skipIf(dialect === "sqlite")("falsy: no values, so the text can hold several statements", async () => {
        await using sql = connect();
        for (const values of [0, NaN, "", false, 0n]) {
          expect(await run(sql, "select 1 as a; select 2 as b", values)).toEqual([[{ a: 1 }], [{ b: 2 }]]);
        }
      });

      test.skipIf(dialect === "sqlite")("truthy: refused", async () => {
        await using sql = connect();
        for (const values of [1, "x", true, 1n, {}, new Uint8Array(1)]) {
          expect(await run(sql, "select 1 as a", values)).toBe("values must be an array");
        }
      });

      test.skipIf(dialect !== "sqlite")("SQLite: the first parameter, falsy or not", async () => {
        await using sql = connect();
        for (const values of [5, 0, "x", ""]) {
          expect(await run(sql, "select ? as a", values)).toEqual([{ a: values }]);
        }
        expect(await run(sql, "select ? as a", false)).toEqual([{ a: 0 }]);
      });
    });
  });

  describe("identifiers", () => {
    test("a dot separates two names, each quoted on its own", async () => {
      await using sql = connect();
      const table = sql(randomName());
      await sql`create temporary table ${table} (b int, c int, ${sql.unsafe(quote + "a.b" + quote)} int)`;
      await sql`insert into ${table} values (1, 2, 3)`;
      expect(await sql`select ${sql("a.b")} as x from ${table} as a`).toEqual([{ x: 1 }]);
      expect(await sql`select a.c as x from ${table} as a order by ${sql("a.b")} desc`).toEqual([{ x: 2 }]);
    });

    test("the quote character is doubled and cannot end the name", async () => {
      await using sql = connect();
      const odd = `we${quote}ird`;
      const table = sql(randomName());
      await sql`create temporary table ${table} (${sql(odd)} int, c int)`;
      await sql`insert into ${table} ${sql({ [odd]: 1, c: 2 })}`;
      expect(await sql`select * from ${table}`).toEqual([{ [odd]: 1, c: 2 }]);
      expect(await sql`select ${sql(`a${quote}b.c`)} as x from ${table} as ${sql(`a${quote}b`)}`).toEqual([{ x: 2 }]);

      const name = `c${quote} from nowhere -- `;
      const outcome = await sql`select ${sql(name)} as x from ${table}`.catch((e: any) => e.message);
      expect(outcome).toEqual(
        by<unknown>({
          // SQLite reads a quoted name that is no column as a string
          sqlite: [{ x: name }],
          postgres: `column "${name}" does not exist`,
          mysql: `Unknown column '${name}' in 'field list'`,
          mariadb: `Unknown column '${name}' in 'SELECT'`,
        }),
      );
    });

    test("an empty name is the server's business", async () => {
      await using sql = connect();
      const table = sql(await tableOf(sql, "b int"));
      await sql`insert into ${table} values (1)`;
      const outcome = (name: string) => sql`select ${sql(name)} as x from ${table} as a`.catch((e: any) => e.message);
      const zeroLength = 'zero-length delimited identifier at or near """"';
      const clause = dialect === "mariadb" ? "SELECT" : "field list";
      expect({
        "a..b": await outcome("a..b"),
        ".b": await outcome(".b"),
        "b.": await outcome("b."),
        "": await outcome(""),
      }).toEqual(
        by<Record<string, unknown>>({
          sqlite: {
            "a..b": "no such column: a..b",
            ".b": "no such column: .b",
            "b.": "no such column: b.",
            "": [{ x: "" }],
          },
          postgres: { "a..b": zeroLength, ".b": zeroLength, "b.": zeroLength, "": zeroLength },
          // an empty qualifier is no qualifier
          mysql: {
            "a..b": [{ x: 1 }],
            ".b": [{ x: 1 }],
            "b.": `Unknown column 'b.' in '${clause}'`,
            "": `Unknown column '' in '${clause}'`,
          },
        }),
      );
    });

    test("are quoted by the instance that runs the query, not by the one that made them", async () => {
      await using sql = connect();
      // never connects
      await using other = new SQL(isMySQL ? "postgres://127.0.0.1:1/x" : "mysql://127.0.0.1:1/x", { max: 1 });
      const name = randomName();
      await sql`create temporary table ${other(name)} (v int)`;
      await sql`insert into ${sql(name)} ${sql({ v: 1 })}`;
      expect(await sql`select ${other("t.v")} from ${other(name)} as t order by ${other("t.v")}`).toEqual([{ v: 1 }]);
    });
  });
}

describe.concurrent("sqlite", () => suite("sqlite", () => "sqlite://:memory:"));

for (const [dialect, image, url] of [
  ["postgres", "postgres_plain", "postgres://bun_sql_test@"],
  ["mysql", "mysql_plain", "mysql://root@"],
  ["mariadb", "mariadb_plain", "mysql://root@"],
] as const) {
  describeWithContainer(dialect, { image, concurrent: true }, container => {
    beforeAll(() => container.ready);
    suite(dialect, () => `${url}${container.host}:${container.port}/bun_sql_test`);
  });
}
