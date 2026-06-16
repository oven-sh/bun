// Shared helper for MySQL tests that need a real server in environments
// without docker (e.g. the sandboxed dev/CI-gate container, which ships a
// native MariaDB). Starts mysqld_safe if needed and provisions a
// passwordless TCP user over the root unix socket. `MYSQL_URL`
// short-circuits all of this when set.

import { SQL } from "bun";
import { existsSync } from "fs";
import { isLinux } from "harness";

const MYSQL_SOCKET = "/run/mysqld/mysqld.sock";

async function waitForSocket(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(MYSQL_SOCKET)) return true;
    await Bun.sleep(250);
  }
  return existsSync(MYSQL_SOCKET);
}

// Start the native MariaDB if its socket isn't already there. Best-effort:
// on environments without the binaries / permissions this just fails and the
// caller skips.
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

// Create a passwordless `bun_sql_test` user reachable over TCP. root uses
// unix_socket auth (no TCP), so provision through the socket first.
async function provisionTcpUser(): Promise<void> {
  await using root = new SQL({ adapter: "mysql", username: "root", database: "mysql", path: MYSQL_SOCKET, max: 1 });
  await root`CREATE DATABASE IF NOT EXISTS bun_sql_test`;
  await root.unsafe("CREATE USER IF NOT EXISTS 'bun_sql_test'@'%' IDENTIFIED BY ''");
  await root.unsafe("CREATE USER IF NOT EXISTS 'bun_sql_test'@'localhost' IDENTIFIED BY ''");
  await root.unsafe("GRANT ALL PRIVILEGES ON *.* TO 'bun_sql_test'@'%'");
  await root.unsafe("GRANT ALL PRIVILEGES ON *.* TO 'bun_sql_test'@'localhost'");
  await root.unsafe("FLUSH PRIVILEGES");
}

/**
 * Resolve a `mysql://` URL for a real local MySQL/MariaDB server, starting
 * and provisioning one if necessary. Returns `null` when no server is
 * reachable in this environment; callers should skip assertions in that case
 * (the docker `describeWithContainer` branch covers CI).
 */
export async function ensureLocalMySQL(): Promise<string | null> {
  if (process.env.MYSQL_URL) return process.env.MYSQL_URL;
  if (!isLinux) return null;
  try {
    if (!(await ensureServerStarted())) return null;
    await provisionTcpUser();
    return "mysql://bun_sql_test@127.0.0.1:3306/bun_sql_test";
  } catch {
    return null;
  }
}
