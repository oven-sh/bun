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
});
