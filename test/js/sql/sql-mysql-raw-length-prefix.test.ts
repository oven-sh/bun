// Regression for https://github.com/oven-sh/bun/issues/30039
//
// `.raw()` on any length-encoded MySQL column (json / varchar / text /
// blob / enum / geometry / ...) used to return the length-encoded-integer
// prefix bytes concatenated with the payload. The reporter saw a leading
// `0xFFFD` when decoding a JSON column as UTF-8 — that's the 0xa7 length
// prefix (a lone UTF-8 continuation byte) showing up in front of the JSON.
//
// This test drives a subprocess against MYSQL_URL so it runs both in CI
// (docker-compose MySQL) and in sandboxed environments that have a MySQL
// reachable on localhost but no docker daemon.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import { existsSync } from "node:fs";
import path from "path";

const fixture = path.join(import.meta.dir, "sql-mysql-raw-length-prefix.fixture.ts");

async function runFixture(url: string, caPath = process.env.CA_PATH ?? "") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, MYSQL_URL: url, CA_PATH: caPath },
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
  const parsed = JSON.parse(lines[1] ?? "null");
  expect(parsed).not.toBeNull();

  const { expected, binary, text } = parsed;

  // The defining assertion: the raw Buffer starts with the payload's first
  // byte ('{' for JSON — 0x7b; 't' for "testname" — 0x74), not the MySQL
  // length-encoded-integer prefix (0xfc for 3-byte prefix, 0x08 for the
  // 1-byte 'testname' length). Before the fix, postFirstByte was 0xfc and
  // postLength was 3 bytes longer than the payload.
  for (const [label, got] of [
    ["binary", binary],
    ["text", text],
  ] as const) {
    expect(got.postIsUint8Array, `${label}: post is Uint8Array`).toBe(true);
    expect(got.postFirstByte, `${label}: post first byte`).toBe(expected.jsonFirstByte);
    // Parse-equality rather than byte-equality: real MySQL (8.4/9) stores
    // JSON in a native binary format and re-serializes on SELECT with
    // spaces after `:`/`,` and reordered object keys, so the returned text
    // won't match JSON.stringify() of the input. MariaDB stores JSON as
    // LONGTEXT and preserves the literal bytes. Both must parse back to
    // the original object.
    expect(JSON.parse(got.postText), `${label}: post JSON`).toEqual(expected.jsonPayload);
    expect(got.nameLength, `${label}: name length`).toBe(expected.shortTextLength);
    expect(got.nameFirstByte, `${label}: name first byte`).toBe(expected.shortFirstByte);
    expect(got.nameText, `${label}: name text`).toBe(expected.shortText);
  }

  expect(exitCode).toBe(0);
}

// Return a working MYSQL_URL string, or null if no MySQL is reachable at all.
// Tries MYSQL_URL, the sibling-test convention, then bootstraps via a UNIX
// socket (the sandboxed gate container has MariaDB running as root via
// /run/mysqld/mysqld.sock but no pre-existing TCP user).
async function discoverMysqlUrl(): Promise<string | null> {
  const candidates = [process.env.MYSQL_URL, "mysql://bun@127.0.0.1:3306/bun_sql_test"].filter((u): u is string => !!u);
  for (const url of candidates) {
    try {
      await using sql = new SQL({ url, max: 1 });
      await sql`SELECT 1`;
      return url;
    } catch {}
  }
  // Last resort: bootstrap bun@%/bun_sql_test via root over UNIX socket.
  const sockets = ["/run/mysqld/mysqld.sock", "/var/run/mysqld/mysqld.sock", "/tmp/mysql.sock"];
  const socket = sockets.find(p => existsSync(p));
  if (!socket) return null;
  try {
    await using root = new SQL({ adapter: "mysql", path: socket, user: "root", database: "mysql", max: 1 });
    await root.unsafe("CREATE DATABASE IF NOT EXISTS bun_sql_test");
    await root.unsafe("CREATE USER IF NOT EXISTS 'bun'@'%'");
    await root.unsafe("CREATE USER IF NOT EXISTS 'bun'@'localhost'");
    await root.unsafe("CREATE USER IF NOT EXISTS 'bun'@'127.0.0.1'");
    await root.unsafe("GRANT ALL PRIVILEGES ON bun_sql_test.* TO 'bun'@'%'");
    await root.unsafe("GRANT ALL PRIVILEGES ON bun_sql_test.* TO 'bun'@'localhost'");
    await root.unsafe("GRANT ALL PRIVILEGES ON bun_sql_test.* TO 'bun'@'127.0.0.1'");
    await root.unsafe("FLUSH PRIVILEGES");
  } catch {
    return null;
  }
  const url = "mysql://bun@127.0.0.1:3306/bun_sql_test";
  try {
    await using sql = new SQL({ url, max: 1 });
    await sql`SELECT 1`;
  } catch {
    return null;
  }
  return url;
}

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test(".raw() on json / varchar returns only the payload (#30039)", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, stderr, exitCode } = await runFixture(url);
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
} else {
  describe("mysql (local)", () => {
    test(".raw() on json / varchar returns only the payload (#30039)", async () => {
      const url = await discoverMysqlUrl();
      if (!url) {
        if (process.env.MYSQL_URL) {
          throw new Error(`sql-mysql-raw-length-prefix: MYSQL_URL=${process.env.MYSQL_URL} is not reachable`);
        }
        console.warn("sql-mysql-raw-length-prefix: no MySQL reachable (no MYSQL_URL, no socket); skipping");
        return;
      }
      const { stdout, stderr, exitCode } = await runFixture(url);
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
}
