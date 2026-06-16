// The binary-protocol row decoder skipped the `index` / `is_indexed_column`
// assignments for cells marked NULL in the null bitmap (it `continue;`d out
// of the loop right after writing the null cell). For columns whose name is
// all digits, those fields tell SQLClient.cpp which object index to place the
// value at, so a NULL value on such a column landed at index 0 instead of the
// column's numeric name (and tripped `ASSERT(cell.isIndexedColumn())` in
// debug builds). The text-protocol decoder already handled this correctly.
//
// Runs against a real MySQL/MariaDB server.

import { SQL } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { describeWithContainer, isDockerEnabled, isLinux } from "harness";

async function assertBinaryNullIndexedColumn(sql: SQL) {
  // All-digit column names make ColumnIdentifier classify them as Index(n).
  // Column "2" carries a non-NULL value to prove NULL placement (not just
  // presence) is what's being checked.
  const expected = { "2": 42, "5": null, "7": null };

  // Prepared → binary protocol. Before the fix the two NULL cells kept
  // index=0 / is_indexed_column=0, so the indexed-only fast path in
  // SQLClient.cpp wrote both nulls to slot 0 and dropped keys "5" and "7".
  const [binaryRow] = await sql`SELECT NULL AS \`5\`, CAST(42 AS SIGNED) AS \`2\`, NULL AS \`7\``;
  expect(binaryRow).toEqual(expected);

  // .simple() → text protocol. This path was already correct; the two
  // protocols must agree.
  const [textRow] = await sql`SELECT NULL AS \`5\`, CAST(42 AS SIGNED) AS \`2\`, NULL AS \`7\``.simple();
  expect(textRow).toEqual(expected);
}

if (isDockerEnabled()) {
  // CI: run against the docker-compose MySQL service.
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("binary-protocol NULL in a digit-named column lands at that column's index", async () => {
      await container.ready;
      await using sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      await assertBinaryNullIndexedColumn(sql);
    });
  });
} else {
  // No docker daemon (e.g. the sandboxed dev/CI-gate container, which ships a
  // native MariaDB). Connect to that real server: start it if needed,
  // provision a passwordless TCP user over the root unix socket, and run the
  // query against it. `MYSQL_URL` short-circuits all of this when set.
  const MYSQL_SOCKET = "/run/mysqld/mysqld.sock";

  async function waitForSocket(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(MYSQL_SOCKET)) return true;
      await Bun.sleep(250);
    }
    return existsSync(MYSQL_SOCKET);
  }

  async function ensureServerStarted(): Promise<boolean> {
    if (existsSync(MYSQL_SOCKET)) return true;
    if (Bun.which("mysqld_safe") == null) return false;
    Bun.spawn({
      cmd: ["mysqld_safe", "--user=mysql", "--datadir=/var/lib/mysql"],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      timeout: 60_000,
    }).unref();
    return waitForSocket(30_000);
  }

  async function provisionTcpUser(): Promise<void> {
    await using root = new SQL({ adapter: "mysql", username: "root", database: "mysql", path: MYSQL_SOCKET, max: 1 });
    await root`CREATE DATABASE IF NOT EXISTS bun_sql_test`;
    await root.unsafe("CREATE USER IF NOT EXISTS 'bun_sql_test'@'%' IDENTIFIED BY ''");
    await root.unsafe("CREATE USER IF NOT EXISTS 'bun_sql_test'@'localhost' IDENTIFIED BY ''");
    await root.unsafe("GRANT ALL PRIVILEGES ON *.* TO 'bun_sql_test'@'%'");
    await root.unsafe("GRANT ALL PRIVILEGES ON *.* TO 'bun_sql_test'@'localhost'");
    await root.unsafe("FLUSH PRIVILEGES");
  }

  let url: string | null = process.env.MYSQL_URL ?? null;

  beforeAll(async () => {
    if (url) return;
    if (!isLinux) return;
    try {
      if (!(await ensureServerStarted())) return;
      await provisionTcpUser();
      url = "mysql://bun_sql_test@127.0.0.1:3306/bun_sql_test";
    } catch {
      url = null;
    }
  }, 60_000);

  describe("mysql (local)", () => {
    test("binary-protocol NULL in a digit-named column lands at that column's index", async () => {
      if (!url) {
        console.warn("sql-mysql-binary-null-indexed: no MySQL reachable in this environment; skipping assertions");
        return;
      }
      await using sql = new SQL({ url, max: 1 });
      await assertBinaryNullIndexedColumn(sql);
    });
  });
}
