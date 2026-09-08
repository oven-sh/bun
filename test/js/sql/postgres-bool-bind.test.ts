// Binding a JS value to a parameter the server types as `boolean` (OID 16): a
// bool column, `$1::bool`, `where flag = $1`. Bun sends a boolean parameter in
// binary format, so the value has to be a JS boolean, or a string (sent as
// text, parsed by the server). Bun declares no type for an object, array, Date
// or function, the server infers `boolean` from the context, and the binary
// encoder used to write `ToBoolean(value)`: `[]`, `{ enabled: false }`, an
// Invalid Date and a Temporal value were all stored as `true` with no error.
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

  // One connection per case: after a bind-time throw the partial Bind message
  // stays in the write buffer and the next query on that connection fails
  // (#34732), the same as for the other encoder arms.
  test.each(rejected)("%s bound to a boolean column rejects instead of storing true", async (_, value, received) => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_bind (id int, b bool)`;
    const err: any = await sql`insert into bool_bind (id, b) values (${1}, ${value}) returning b`.then(
      rows => rows,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(err.message).toBe(`Query parameter $2 of type boolean must be a boolean or a string. Received ${received}`);
  });

  test("a cast and a comparison type the parameter as boolean too", async () => {
    await container.ready;
    {
      await using sql = connect();
      const err: any = await sql`select ${{ a: 1 }}::bool as v`.then(
        rows => rows,
        e => e,
      );
      expect(err?.message).toBe(
        "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Object",
      );
    }
    {
      await using sql = connect();
      const err: any = await sql`select 1 as v where true = ${[]}`.then(
        rows => rows,
        e => e,
      );
      expect(err?.message).toBe(
        "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Array",
      );
    }
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
