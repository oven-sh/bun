// The shared ColumnIdentifier classifier (src/sql/shared/ColumnIdentifier.rs)
// decides whether a result column becomes an array-index key or a string key
// on the row object. It used to treat any all-digit name as an index, so a
// column aliased "01" came back as "1", and "007" collided with a real "7"
// column and was dropped from the object (values() still had the cell). JS only
// treats canonical integer strings as index keys: {"01": .., "1": ..} are two
// distinct properties, which is also what Postgres/MySQL return and what
// postgres.js / mysql2 hand back.
//
// Runs against the real docker-compose postgres/mysql services; the classifier
// is shared by both decoders, and each adapter decodes column names on both its
// prepared and its simple/text query path.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const expectedRow = {
  id: "row1",
  "01": "jan",
  "02": "feb",
  "10": "oct",
  "007": "bond",
  "7": "seven",
  "0": "zero",
  "00": "dz",
};
// Index keys ("0", "7", "10") sort first; the rest keep column order.
const expectedKeys = ["0", "7", "10", "id", "01", "02", "007", "00"];
const expectedValues = ["row1", "jan", "feb", "oct", "bond", "seven", "zero", "dz"];

// More columns than JSFinalObject's inline capacity (64), so the row is built
// from the per-statement column-name array instead of a cached Structure.
const wideNames = Array.from({ length: 70 }, (_, i) => String(i + 1).padStart(3, "0"));
const expectedWideRow = { name: "n", "5": "i", ...Object.fromEntries(wideNames.map(n => [n, n])) };
function wideSelect(quote: string) {
  const alias = (value: string, name: string) => `'${value}' as ${quote}${name}${quote}`;
  return `select ${[alias("n", "name"), alias("i", "5"), ...wideNames.map(n => alias(n, n))].join(", ")}`;
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const options = () => ({
    url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });

  test("zero-padded numeric aliases stay distinct string keys", async () => {
    await container.ready;
    await using sql = new SQL(options());

    const query = () =>
      sql`select 'row1' as "id", 'jan' as "01", 'feb' as "02", 'oct' as "10", 'bond' as "007", 'seven' as "7", 'zero' as "0", 'dz' as "00"`;

    const [row] = await query();
    expect(row).toEqual(expectedRow);
    expect(Object.keys(row)).toEqual(expectedKeys);
    expect((await query().values())[0]).toEqual(expectedValues);

    const [simpleRow] = await query().simple();
    expect(simpleRow).toEqual(expectedRow);
    expect(Object.keys(simpleRow)).toEqual(expectedKeys);
  });

  test("a result made only of zero-padded aliases keeps every column", async () => {
    await container.ready;
    await using sql = new SQL(options());

    expect(await sql`select 1 as "01", 2 as "1"`).toEqual([{ "01": 1, "1": 2 }]);
    expect(await sql`select 'a' as "01", 'b' as "02", 'c' as "000"`).toEqual([{ "01": "a", "02": "b", "000": "c" }]);
  });

  test("zero-padded aliases survive past the inline property capacity", async () => {
    await container.ready;
    await using sql = new SQL(options());

    expect(await sql.unsafe(wideSelect('"'))).toEqual([expectedWideRow]);
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  const options = () => ({
    url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });

  test("zero-padded numeric aliases stay distinct string keys", async () => {
    await container.ready;
    await using sql = new SQL(options());

    const query = () =>
      sql`select 'row1' as \`id\`, 'jan' as \`01\`, 'feb' as \`02\`, 'oct' as \`10\`, 'bond' as \`007\`, 'seven' as \`7\`, 'zero' as \`0\`, 'dz' as \`00\``;

    const [row] = await query();
    expect(row).toEqual(expectedRow);
    expect(Object.keys(row)).toEqual(expectedKeys);
    expect((await query().values())[0]).toEqual(expectedValues);

    const [simpleRow] = await query().simple();
    expect(simpleRow).toEqual(expectedRow);
    expect(Object.keys(simpleRow)).toEqual(expectedKeys);
  });

  test("a result made only of zero-padded aliases keeps every column", async () => {
    await container.ready;
    await using sql = new SQL(options());

    expect(await sql`select 1 as \`01\`, 2 as \`1\``).toEqual([{ "01": 1, "1": 2 }]);
    expect(await sql`select 'a' as \`01\`, 'b' as \`02\`, 'c' as \`000\``).toEqual([
      { "01": "a", "02": "b", "000": "c" },
    ]);
  });

  test("zero-padded aliases survive past the inline property capacity", async () => {
    await container.ready;
    await using sql = new SQL(options());

    expect(await sql.unsafe(wideSelect("`"))).toEqual([expectedWideRow]);
  });
});
