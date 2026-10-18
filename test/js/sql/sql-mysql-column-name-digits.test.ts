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

  const connect = () => new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

  test("zero-padded column names stay distinct from their canonical spelling", async () => {
    await container.ready;
    await using sql = connect();
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
  });

  test("a column that alternates between `1` and `01` is keyed by its own name in each result set", async () => {
    await container.ready;
    await using sql = connect();
    expect(await sql`select 1 as "1", 2 as x; select 3 as "01", 4 as x; select 5 as "1", 6 as x`.simple()).toEqual([
      [{ "1": 1, x: 2 }],
      [{ "01": 3, x: 4 }],
      [{ "1": 5, x: 6 }],
    ]);
  });

  const wide = (...overrides: [index: number, name: string][]) => {
    const names = Array.from({ length: 80 }, (_, i) => `c${i}`);
    for (const [index, name] of overrides) names[index] = name;
    return names;
  };
  test.each([
    ["zero-padded names beside canonical ones", ["id", "01", "02", "10", "007", "7", "0", "00"]],
    ["the edges of the array-index range", ["0", "0000000001", "00000000001", "4294967294", "4294967295", "x"]],
    ["a repeated zero-padded name", ["01", "01", "1"]],
    // Past JSFinalObject::maxInlineCapacity columns the names are put on each row one by one.
    ["a zero-padded name beside its canonical spelling in a wide row", wide([40, "007"], [41, "7"])],
  ])("%s: every column keeps its own name", async (_, names) => {
    await container.ready;
    await using sql = connect();
    const select = "select " + names.map((name, i) => `'v${i}' as \`${name}\``).join(", ");
    const expected = Object.fromEntries(names.map((name, i) => [name, `v${i}`]));

    // The text protocol, then the prepared one.
    for (const rows of [await sql.unsafe(select), await sql.unsafe(select + " where 1 = ?", [1])]) {
      expect(rows).toEqual([expected]);
      expect(Object.keys(rows[0])).toEqual(Object.keys(expected));
    }
  });
});
