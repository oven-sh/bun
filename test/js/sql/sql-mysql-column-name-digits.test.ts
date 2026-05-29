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

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";

const fixture = path.join(import.meta.dir, "sql-mysql-column-name-digits.fixture.ts");

async function runFixture(url: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, MYSQL_URL: url },
    stdout: "pipe",
    stderr: "pipe",
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
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server is
  // reachable at MYSQL_URL or the conventional local address, exercise the
  // fixture there so the regression is still covered.
  const url = process.env.MYSQL_URL || "mysql://root@127.0.0.1:3306/bun_sql_test";

  describe("mysql (local)", () => {
    test("a digits-with-interior-underscore column stays a named key", async () => {
      const { stdout, stderr, exitCode } = await runFixture(url);
      // The fixture prints "CONNECTED" after the priming query succeeds. If it
      // never got that far, there's no MySQL to talk to in this environment;
      // the docker-gated branch above provides the CI coverage.
      if (!stdout.startsWith("CONNECTED")) {
        if (process.env.MYSQL_URL) {
          // MYSQL_URL was explicitly provided; failing to connect is a real
          // error, not an environment without MySQL.
          throw new Error(
            `sql-mysql-column-name-digits: MYSQL_URL was provided but fixture never reached CONNECTED\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          );
        }
        console.warn("sql-mysql-column-name-digits: no MySQL reachable at " + url + "; skipping assertions");
        return;
      }
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
}
