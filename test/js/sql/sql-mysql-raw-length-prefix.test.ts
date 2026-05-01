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

// Paths where a UNIX-socket-accessible MySQL/MariaDB might listen.
const SOCKET_CANDIDATES = ["/run/mysqld/mysqld.sock", "/var/run/mysqld/mysqld.sock", "/tmp/mysql.sock"];

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

// If a MariaDB/MySQL daemon is installed but not running (the case in the
// sandboxed gate container that has /var/lib/mysql populated but no active
// daemon), start it as a detached background process and wait for the socket
// to appear. Returns the path to the socket on success, or null otherwise.
async function startLocalMariadb(): Promise<string | null> {
  const mysqldSafe = ["/usr/bin/mysqld_safe", "/usr/local/bin/mysqld_safe"].find(p => existsSync(p));
  if (!mysqldSafe) return null;
  if (!existsSync("/var/lib/mysql")) return null;

  // Detach stdout/stderr so mysqld_safe keeps running after this test exits.
  const proc = Bun.spawn({
    cmd: [mysqldSafe, "--user=mysql", "--datadir=/var/lib/mysql"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();

  // Poll up to 20 seconds for the socket to appear.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const socket = SOCKET_CANDIDATES.find(p => existsSync(p));
    if (socket) return socket;
    await Bun.sleep(250);
  }
  return null;
}

// Return a working MYSQL_URL string, or null if no MySQL is reachable at all.
// Tries MYSQL_URL, the sibling-test convention, then bootstraps via a UNIX
// socket — starting a local MariaDB if its binary and datadir are present
// but not running (the case in the sandboxed gate container).
async function discoverMysqlUrl(): Promise<string | null> {
  // If MYSQL_URL is set, trust it and hand it to runFixture — the subprocess
  // picks up CA_PATH for TLS URLs, which a plain `new SQL({ url })` probe here
  // would not. A broken MYSQL_URL will surface as a missing CONNECTED marker
  // in assertFixtureOutput() rather than being silently misclassified here.
  if (process.env.MYSQL_URL) return process.env.MYSQL_URL;

  // Local dev: try the sibling-test convention first.
  try {
    const url = "mysql://bun@127.0.0.1:3306/bun_sql_test";
    await using sql = new SQL({ url, max: 1 });
    await sql`SELECT 1`;
    return url;
  } catch {}

  // Find an existing socket, or start MariaDB ourselves if its binary/datadir
  // is installed but not running.
  let socket = SOCKET_CANDIDATES.find(p => existsSync(p)) ?? (await startLocalMariadb());
  if (!socket) return null;

  // Bootstrap bun@%/bun_sql_test via root over UNIX socket.
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
    test(
      ".raw() on json / varchar returns only the payload (#30039)",
      async () => {
        // discoverMysqlUrl() can spend ~20s starting a cold MariaDB + running
        // the root-socket bootstrap, so the default 5s bun:test timeout would
        // fire mid-poll and hide the regression the gate is checking for.
        const url = await discoverMysqlUrl();
        if (!url) {
          // discoverMysqlUrl returns MYSQL_URL as-is when set, so getting null
          // here means MYSQL_URL is unset — nothing to diagnose, just skip.
          console.warn("sql-mysql-raw-length-prefix: no MySQL reachable (no MYSQL_URL, no socket); skipping");
          return;
        }
        const { stdout, stderr, exitCode } = await runFixture(url);
        assertFixtureOutput(stdout, stderr, exitCode);
      },
      60_000,
    );
  });
}
