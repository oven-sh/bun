// A named prepared statement is called "P" + the first 40 bytes of its
// signature + "$" + an id that the connection counts up. The id was read
// before the parameter values were inspected. An index getter of the array
// given to `unsafe(text, values)` runs during that inspection. When the getter
// started a query with the same first 40 bytes, both statements got the same
// name and the server rejected the second Parse with 42P05.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, tempDir } from "harness";
import { join } from "node:path";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  const prefix = "select /* forty characters of common prefix, and more */ ";
  const name = (id: number) => `P${prefix.slice(0, 40)}$${id}`;
  const outerText = prefix + "$1::text as outer";
  const nestedText = prefix + "$1::text as nested";

  const settled = (query: Promise<unknown>) =>
    query.then(
      rows => [...(rows as unknown[])],
      e => ({ code: e.code, errno: e.errno, message: e.message }),
    );

  // The first read of values[0] calls `start`: that read is the one that makes the signature.
  function valuesThatStart(value: string, start: () => void) {
    const values: unknown[] = [];
    let reads = 0;
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() {
        if (++reads === 1) start();
        return value;
      },
    });
    return values;
  }

  // The same, with a hole at index 0 of an Array subclass and the getter on its prototype.
  function holeOverPrototypeGetter(value: string, start: () => void) {
    class Values extends Array<unknown> {}
    let reads = 0;
    Object.defineProperty(Values.prototype, 0, {
      get() {
        if (++reads === 1) start();
        return value;
      },
    });
    return new Values(1);
  }

  // A simple query makes no prepared statement of its own.
  const statementsOnServer = async (db: SQL) =>
    [...(await db`select name, statement from pg_prepared_statements order by name`.simple())].map(row => [
      row.name,
      row.statement,
    ]);

  // Runs the outer query on `db`. Its values start the nested query on `db`.
  async function outerAndNested(
    db: SQL,
    {
      runOuter = (values: unknown[]) => db.unsafe(outerText, values),
      startNested = () => db.unsafe(nestedText, ["n"]).execute(),
      makeValues = valuesThatStart,
    }: {
      runOuter?: (values: unknown[]) => Promise<unknown>;
      startNested?: () => Promise<unknown>;
      makeValues?: typeof valuesThatStart;
    } = {},
  ) {
    let nested: Promise<unknown> | undefined;
    const values = makeValues("o", () => (nested = settled(startNested())));
    const outer = await settled(runOuter(values));
    return { outer, nested: await nested, statements: await statementsOnServer(db) };
  }

  const ownNames = {
    outer: [{ outer: "o" }],
    nested: [{ nested: "n" }],
    statements: [
      [name(0), nestedText],
      [name(1), outerText],
    ],
  };

  test("a query started by a getter of the values gets its own statement name", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    expect(await outerAndNested(sql)).toEqual(ownNames);
  });

  test("the nested query is a tagged template", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    const startNested = () =>
      sql`select /* forty characters of common prefix, and more */ ${"n"}::text as nested`.execute();
    expect(await outerAndNested(sql, { startNested })).toEqual({
      ...ownNames,
      statements: [
        [name(0), prefix + "$1 ::text as nested"],
        [name(1), outerText],
      ],
    });
  });

  test("the getter is on the prototype of an Array subclass", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    expect(await outerAndNested(sql, { makeValues: holeOverPrototypeGetter })).toEqual(ownNames);
  });

  test("the outer query comes from sql.file", async () => {
    await container.ready;
    using dir = tempDir("postgres-statement-name-reentry", { "outer.sql": outerText });
    await using sql = new SQL({ url: url(), max: 1 });
    const runOuter = (values: unknown[]) => sql.file(join(String(dir), "outer.sql"), values);
    expect(await outerAndNested(sql, { runOuter })).toEqual(ownNames);
  });

  test("both queries run on a reserved connection", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 10 });
    using reserved = await sql.reserve();
    expect(await outerAndNested(reserved)).toEqual(ownNames);
  });

  // A rejected Parse aborts the transaction: the next statement gets 25P02 and COMMIT rolls back.
  test("both queries run in a transaction, and it commits", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });
    await sql`create temp table statement_name_reentry (v text)`.simple();

    const result = await sql.begin(async tx => {
      const both = await outerAndNested(tx);
      await tx`insert into statement_name_reentry values (${"committed"})`;
      return both;
    });

    expect(result).toEqual(ownNames);
    expect(await sql`select v from statement_name_reentry`).toEqual([{ v: "committed" }]);
  });

  test("two queries started by one getter and the outer query get three statement names", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const nested: Promise<unknown>[] = [];
    const values = valuesThatStart("o", () => {
      nested.push(settled(sql.unsafe(prefix + "$1::text as first", ["1"]).execute()));
      nested.push(settled(sql.unsafe(prefix + "$1::text as second", ["2"]).execute()));
    });
    const outer = await settled(sql.unsafe(outerText, values));

    expect({ outer, nested: await Promise.all(nested) }).toEqual({
      outer: [{ outer: "o" }],
      nested: [[{ first: "1" }], [{ second: "2" }]],
    });
    expect(await statementsOnServer(sql)).toEqual([
      [name(0), prefix + "$1::text as first"],
      [name(1), prefix + "$1::text as second"],
      [name(2), outerText],
    ]);
  });

  test("a getter of the nested query that starts a third query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    let inner: Promise<unknown> | undefined;
    const middleValues = valuesThatStart(
      "m",
      () => (inner = settled(sql.unsafe(prefix + "$1::text as inner", ["i"]).execute())),
    );
    const startNested = () => sql.unsafe(prefix + "$1::text as middle", middleValues).execute();

    expect({ ...(await outerAndNested(sql, { startNested })), inner: await inner }).toEqual({
      outer: [{ outer: "o" }],
      nested: [{ middle: "m" }],
      inner: [{ inner: "i" }],
      statements: [
        [name(0), prefix + "$1::text as inner"],
        [name(1), prefix + "$1::text as middle"],
        [name(2), outerText],
      ],
    });
  });

  // values[0] is read for the signature and again for the Bind, so the second query starts while the Bind is encoded.
  test.each([
    [
      "the same text",
      (_read: number) => "nested",
      [
        [name(0), nestedText],
        [name(1), outerText],
      ],
    ],
    [
      "a new text",
      (read: number) => "nested" + read,
      [
        [name(0), prefix + "$1::text as nested1"],
        [name(1), outerText],
        [name(2), prefix + "$1::text as nested2"],
      ],
    ],
  ])("a getter that starts a query with %s on every read", async (_, column, statements) => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    const nested: Promise<unknown>[] = [];
    const values: unknown[] = [];
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() {
        const read = nested.length + 1;
        nested.push(settled(sql.unsafe(`${prefix}$1::text as ${column(read)}`, ["n" + read]).execute()));
        return "o";
      },
    });
    const outer = await settled(sql.unsafe(outerText, values));

    expect({ outer, nested: await Promise.all(nested), statements: await statementsOnServer(sql) }).toEqual({
      outer: [{ outer: "o" }],
      nested: [[{ [column(1)]: "n1" }], [{ [column(2)]: "n2" }]],
      statements,
    });
  });

  test("statements made before and after take the ids around the nested and the outer query", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await sql.unsafe(prefix + "$1::text as before", ["b"])).toEqual([{ before: "b" }]);
    // A second execution uses the statement again and takes no id.
    expect(await sql.unsafe(prefix + "$1::text as before", ["b2"])).toEqual([{ before: "b2" }]);

    const { outer, nested } = await outerAndNested(sql);
    expect({ outer, nested }).toEqual({ outer: ownNames.outer, nested: ownNames.nested });

    expect(await sql.unsafe(prefix + "$1::text as after", ["a"])).toEqual([{ after: "a" }]);
    expect(await statementsOnServer(sql)).toEqual([
      [name(0), prefix + "$1::text as before"],
      [name(1), nestedText],
      [name(2), outerText],
      [name(3), prefix + "$1::text as after"],
    ]);
  });

  // The id is taken when the statement is named, before its Parse is written. postgres.js does the same.
  test("a statement whose Parse cannot be written keeps the id it took", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1 });

    expect(await sql.unsafe(prefix + "$1::text as before", ["b"])).toEqual([{ before: "b" }]);
    // One parameter more than a Parse message can carry.
    expect(await settled(sql.unsafe(prefix + "1 as too_many", new Array(65536).fill(0)))).toMatchObject({
      code: "ERR_POSTGRES_TOO_MANY_PARAMETERS",
    });
    expect(await sql.unsafe(prefix + "$1::text as after", ["a"])).toEqual([{ after: "a" }]);

    expect(await statementsOnServer(sql)).toEqual([
      [name(0), prefix + "$1::text as before"],
      [name(2), prefix + "$1::text as after"],
    ]);
  });

  test("with prepare: false the nested and the outer query use the unnamed statement", async () => {
    await container.ready;
    await using sql = new SQL({ url: url(), max: 1, prepare: false });
    expect(await outerAndNested(sql)).toEqual({ ...ownNames, statements: [] });
  });
});
