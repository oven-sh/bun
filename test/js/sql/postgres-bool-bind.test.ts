// Binding a JS value to a parameter the server types as `boolean` (OID 16): a
// bool column, `$1::bool`, `where flag = $1`, or a bare `where $1`. Bun sends a
// boolean parameter in binary format, so the value has to be a JS boolean, or a
// string (sent as text, parsed by the server). Bun declares no type for an
// object, array, Date or function, the server infers `boolean` from the
// context, and the binary encoder used to write `ToBoolean(value)`: `[]`,
// `{ enabled: false }`, an Invalid Date and a Temporal value were all sent as
// `true` with no error. An insert stored `true`, and
// `delete from t where ${[a, b]}` removed every row.
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
    ["{ enabled: false }", { enabled: false }, "an instance of Object"],
    ["[]", [], "an instance of Array"],
    ["[1, 2]", [1, 2], "an instance of Array"],
    ["[true]", [true], "an instance of Array"],
    ["Invalid Date", new Date(NaN), "an instance of Date"],
    ["Date", new Date(0), "an instance of Date"],
    [
      "function",
      function enabled() {
        return false;
      },
      "function enabled",
    ],
    ["Int32Array", new Int32Array([1]), "an instance of Int32Array"],
  ];
  if (typeof Temporal !== "undefined") {
    rejected.push(["Temporal.PlainDate", Temporal.PlainDate.from("2024-05-06"), "an instance of PlainDate"]);
  }

  test.each(rejected)("%s bound to a boolean column rejects instead of storing true", async (_, value, received) => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_bind (id int, b bool)`;
    // Twice: the first run prepares the statement and binds from the request
    // queue, the second binds the cached statement directly at query time.
    for (let i = 0; i < 2; i++) {
      const err: any = await sql`insert into bool_bind (id, b) values (${1}, ${value}) returning b`.then(
        rows => rows,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(err.message).toBe(
        `Query parameter $2 of type boolean must be a boolean or a string. Received ${received}`,
      );
    }
    // The temp table only exists on the original session, so this also fails
    // if the rejection cost the connection.
    expect(await sql`select count(*)::int as n from bool_bind`).toEqual([{ n: 0 }]);
  });

  test("an array or an object as a WHERE condition rejects and removes no row", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_where (id int primary key)`;
    await sql`insert into bool_where values (1), (2), (3)`;
    const conditions: unknown[] = [[sql`id = 1`, sql`id = 2`], [sql`id = 1`], [], [1, 2], [true], [false], { id: 1 }];
    const outcomes: string[] = [];
    for (const condition of conditions) {
      outcomes.push(
        await sql`delete from bool_where where ${condition}`.then(
          result => `deleted ${result.count}`,
          e => e.code,
        ),
      );
    }
    expect(outcomes).toEqual(conditions.map(() => "ERR_INVALID_ARG_TYPE"));
    expect(await sql`select id from bool_where order by id`).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    // A boolean and a fragment in that place still do what they say.
    expect((await sql`delete from bool_where where ${false}`).count).toBe(0);
    expect((await sql`delete from bool_where where ${sql`id = 1`}`).count).toBe(1);
    expect((await sql`delete from bool_where where ${true}`).count).toBe(2);
  });

  test("a cast and a comparison type the parameter as boolean too", async () => {
    await container.ready;
    await using sql = connect();
    const message = (query: PromiseLike<unknown>) =>
      query.then(
        () => "resolved",
        e => e.message,
      );
    expect(await message(sql`select ${{ a: 1 }}::bool as v`)).toBe(
      "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Object",
    );
    expect(await message(sql`select 1 as v where true = ${[]}`)).toBe(
      "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Array",
    );
  });

  test("booleans, null and strings bound to a boolean column still work", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_bind (id int, b bool)`;
    const values = [true, false, null, undefined, "t", "f", "true", "false", "yes", "off", "1", "0"];
    for (const [id, b] of values.entries()) {
      await sql`insert into bool_bind (id, b) values (${id}, ${b})`;
    }
    expect(await sql`select id, b from bool_bind order by id`).toEqual([
      { id: 0, b: true },
      { id: 1, b: false },
      { id: 2, b: null },
      { id: 3, b: null },
      { id: 4, b: true },
      { id: 5, b: false },
      { id: 6, b: true },
      { id: 7, b: false },
      { id: 8, b: true },
      { id: 9, b: false },
      { id: 10, b: true },
      { id: 11, b: false },
    ]);
    // A string the server cannot parse as a boolean is still a server error,
    // and the connection stays usable after it.
    const err = await sql`insert into bool_bind (id, b) values (99, ${"garbage"})`.catch(e => e);
    expect([err?.code, err?.errno]).toEqual(["ERR_POSTGRES_SERVER_ERROR", "22P02"]);
    expect(await sql`select id from bool_bind where b = ${true} order by id`).toEqual([
      { id: 0 },
      { id: 4 },
      { id: 6 },
      { id: 8 },
      { id: 10 },
    ]);
    expect(await sql`select ${false}::bool as v, ${true}::bool as w`).toEqual([{ v: false, w: true }]);
  });
});
