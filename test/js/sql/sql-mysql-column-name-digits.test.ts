// A result column whose name is all digits with an interior underscore (e.g.
// `2024_01`) must stay a NAMED key. The shared ColumnIdentifier classifier was
// rewritten from Zig to Rust; the Zig version hand-parsed only `'0'..'9'` (any
// other byte meant "this is a name"), but the Rust port routed the name through
// `parse_unsigned`, which — mirroring `std.fmt.parseInt` — skips embedded `_`
// digit separators. So `2024_01` parsed to the integer 202401 and was
// misclassified as a positional array index.
//
// On release 1.3.14 the row decodes as `{ product, "2024_01", "2024_02", "8" }`;
// on the Rust build (before this fix) `2024_01`/`2024_02` collapse to indices
// 202401/202402, so those keys vanish — and a debug build aborts on the
// `cell.index < count` assertion in the object-building slow path.
//
// Runs against a real MySQL/MariaDB server. The classifier is shared with
// Postgres, so this also covers that decoder.

import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "path";

const fixture = path.join(import.meta.dir, "sql-mysql-column-name-digits.fixture.ts");

async function runFixture(url: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, MYSQL_URL: url },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test("a digits-with-interior-underscore column stays a named key", async () => {
    await container.ready;
    const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
    const { stdout, stderr, exitCode } = await runFixture(url);

    const filteredStderr = stderr
      .split(/\r?\n/)
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(filteredStderr).toBe("");
    const lines = stdout.trim().split(/\r?\n/);
    expect(lines[0]).toBe("CONNECTED");
    // `2024_01`/`2024_02` must be NAMED keys (not indices 202401/202402), `8`
    // round-trips, and nothing is dropped.
    expect(JSON.parse(lines[1] ?? "null")).toEqual({
      row: { product: "widget", "2024_01": 10, "2024_02": 20, "8": 42 },
      keys: ["2024_01", "2024_02", "8", "product"],
    });
    expect(exitCode).toBe(0);
  });

  // A zero-padded name is not an array index either: `01` and `1` are two
  // columns, and each has to keep its own spelling on the row object.
  test("zero-padded column names stay distinct from their canonical spelling", async () => {
    await container.ready;
    await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    const t = "col_padded_" + randomUUIDv7("hex").replaceAll("-", "");

    await sql`CREATE TEMPORARY TABLE ${sql(t)} (\`01\` INT, \`02\` INT, \`1\` INT)`;
    await sql`INSERT INTO ${sql(t)} ${sql({ "01": 10, "02": 20, "1": 30 })}`;
    const [row] = await sql`SELECT * FROM ${sql(t)}`;
    expect(row).toEqual({ "01": 10, "02": 20, "1": 30 });
    expect(Object.keys(row)).toEqual(["1", "01", "02"]);

    // The row names the table's real columns, so writing it back stores every cell.
    await sql`INSERT INTO ${sql(t)} ${sql(row)}`;
    expect(await sql`SELECT * FROM ${sql(t)}`.values()).toEqual([
      [10, 20, 30],
      [10, 20, 30],
    ]);

    // MySQL names an unaliased literal after its text.
    expect(await sql`SELECT 007, 7`).toEqual([{ "007": 7, "7": 7 }]);
  });

  // Every result set of one statement decodes its columns into the slots of the
  // set before it. A slot that goes from `1` to `01` and back changes kind each
  // time, so the row shape cached for the previous set must not be reused.
  test("a column that alternates between `1` and `01` is keyed by its own name in each result set", async () => {
    await container.ready;
    await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    const sets = [[{ "1": 1, x: 2 }], [{ "01": 3, x: 4 }], [{ "1": 5, x: 6 }]];

    expect(await sql`select 1 as "1", 2 as x; select 3 as "01", 4 as x; select 5 as "1", 6 as x`.simple()).toEqual(
      sets,
    );

    // The same three sets from a prepared CALL, run twice so the second run re-decodes into used slots.
    const p = "proc_padded_" + randomUUIDv7("hex").replaceAll("-", "");
    await sql.unsafe(
      `CREATE PROCEDURE ${p}() BEGIN SELECT 1 AS \`1\`, 2 AS x; SELECT 3 AS \`01\`, 4 AS x; SELECT 5 AS \`1\`, 6 AS x; END`,
    );
    try {
      for (let run = 0; run < 2; run++) {
        expect((await sql`CALL ${sql(p)}()`).slice(0, 3)).toEqual(sets);
      }
    } finally {
      await sql.unsafe(`DROP PROCEDURE ${p}`);
    }
  });

  // JSC stores a key as an array index only when it is a canonical integer
  // below 2^32 - 1 ("0", "7", "4294967294"). Every other all-digit name is a
  // string key, so each column below keeps its own name, over the text and the
  // prepared protocol.
  const wide = (...overrides: [index: number, name: string][]) => {
    const names = Array.from({ length: 80 }, (_, i) => `c${i}`);
    for (const [index, name] of overrides) names[index] = name;
    return names;
  };

  test.each([
    ["zero-padded names beside canonical ones", ["id", "01", "02", "10", "007", "7", "0", "00"]],
    ["month names 01 to 12", Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))],
    [
      "names at the edges of the array-index range",
      ["0", "00", "0000000001", "00000000001", "4294967294", "4294967295", "x"],
    ],
    ["a repeated zero-padded name", ["01", "01", "1"]],
    // Past JSFinalObject::maxInlineCapacity (62) columns the names are put on each row one by one.
    ["a zero-padded name beside its canonical spelling in a wide result", wide([40, "007"], [41, "7"])],
    ["only zero-padded names in a wide result", Array.from({ length: 72 }, (_, i) => String(i + 1).padStart(3, "0"))],
  ])("%s: every column keeps its own name", async (_, names) => {
    await container.ready;
    await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
    const select = "select " + names.map((name, i) => `'v${i}' as \`${name}\``).join(", ");
    // Computed keys in column order: array-index keys come first, the others keep that order.
    const expected = Object.fromEntries(names.map((name, i) => [name, `v${i}`]));

    for (const rows of [await sql.unsafe(select), await sql.unsafe(select + " where 1 = ?", [1])]) {
      expect(rows).toEqual([expected]);
      expect(Object.keys(rows[0])).toEqual(Object.keys(expected));
      // Read through each key too: a key stored as the wrong kind is listed but not found.
      expect(names.map(name => rows[0][name])).toEqual(names.map(name => expected[name]));
    }
  });
});
