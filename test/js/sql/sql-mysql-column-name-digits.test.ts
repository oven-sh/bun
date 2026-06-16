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

import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";
import { ensureLocalMySQL } from "./mysql-local-harness";

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

function assertFixtureOutput(stdout: string, stderr: string, exitCode: number) {
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
}

if (isDockerEnabled()) {
  // CI: run against the docker-compose MySQL service.
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("a digits-with-interior-underscore column stays a named key", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, stderr, exitCode } = await runFixture(url);
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
} else {
  let url: string | null = null;

  beforeAll(async () => {
    url = await ensureLocalMySQL();
  }, 60_000);

  describe("mysql (local)", () => {
    test("a digits-with-interior-underscore column stays a named key", async () => {
      if (!url) {
        console.warn("sql-mysql-column-name-digits: no MySQL reachable in this environment; skipping assertions");
        return;
      }
      const { stdout, stderr, exitCode } = await runFixture(url);
      // The fixture prints "CONNECTED" after the priming query succeeds. If a
      // URL was resolved but the fixture never connected, that's a real error.
      if (!stdout.startsWith("CONNECTED")) {
        throw new Error(
          `sql-mysql-column-name-digits: could not connect to ${url}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
      }
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
}
