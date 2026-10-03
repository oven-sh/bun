import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import { existsSync } from "node:fs";
import path from "path";

// Regression for oven-sh/bun#38277: MySQL BLOB parameter binds pinned and
// borrowed the backing ArrayBuffer without copying. A pin stops .transfer()
// and detach, but not resize(): a resizable ArrayBuffer (which the BLOB arm
// never rejected) can be shrunk by user JS running for a later parameter in
// the same bind loop, dropping the bytes the borrowed slice still points at
// before execute.write() reads them. The fix copies the bytes of storage a
// pin cannot hold in place instead of pinning.

const fixture = path.join(import.meta.dir, "sql-mysql-bind-blob-resizable.fixture.ts");

async function runFixture(env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectedHex() {
  let hex = "";
  for (let i = 0; i < 64; i++) hex += i.toString(16).padStart(2, "0");
  return hex;
}

function assertFixtureOutput(stdout: string, stderr: string, exitCode: number) {
  // Without the fix the borrowed slice reads memory resize(0) decommitted,
  // which segfaults: no JSON line and a non-zero exit. Asserting stderr is
  // empty first surfaces the crash text in the failure diff.
  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const jsonLine = stdout
    .trim()
    .split(/\r?\n/)
    .find(l => l.startsWith("{"));
  const payload = jsonLine ? JSON.parse(jsonLine) : null;
  expect(payload).toEqual({
    calls: expect.any(Number),
    shrunk: true,
    originalHex: expectedHex(),
    gotHex: expectedHex(),
    name: "evil",
    match: true,
    wasmCalls: expect.any(Number),
    wasmOriginalHex: expectedHex(),
    wasmGotHex: expectedHex(),
    wasmName: "evil",
    wasmMatch: true,
  });
  expect(payload.calls).toBeGreaterThanOrEqual(2);
  expect(payload.wasmCalls).toBeGreaterThanOrEqual(2);
  expect(exitCode).toBe(0);
}

// Spawning the debug bun subprocess + MySQL round-trip can exceed the 5s
// default on a cold cache under ASAN.
const TEST_TIMEOUT = 30_000;

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test(
      "resizable BLOB param bytes are copied, not borrowed, across the bind loop",
      async () => {
        await container.ready;
        const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
        const { stdout, stderr, exitCode } = await runFixture({ MYSQL_URL: url });
        expect(stdout).toContain("CONNECTED");
        assertFixtureOutput(stdout, stderr, exitCode);
      },
      TEST_TIMEOUT,
    );
  });
} else {
  // No docker daemon (e.g. local/sandboxed environments). Reach MySQL via
  // MYSQL_URL when provided, or the local mariadb's unix socket as root (no
  // TCP user is configured there). Without either, the fixture can't connect
  // and the test soft-skips; the docker-gated branch above is the CI coverage.
  const socketCandidates = ["/var/run/mysqld/mysqld.sock", "/run/mysqld/mysqld.sock", "/tmp/mysql.sock"];
  function mysqlEnv(): Record<string, string> | null {
    if (process.env.MYSQL_URL) {
      const env: Record<string, string> = { MYSQL_URL: process.env.MYSQL_URL };
      if (process.env.CA_PATH) env.CA_PATH = process.env.CA_PATH;
      return env;
    }
    const sock = socketCandidates.find(p => existsSync(p));
    return sock ? { MYSQL_SOCKET: sock } : null;
  }

  describe("mysql (local)", () => {
    test(
      "resizable BLOB param bytes are copied, not borrowed, across the bind loop",
      async () => {
        const env = mysqlEnv();
        if (!env) {
          console.warn("sql-mysql-bind-blob-resizable: no MySQL reachable; skipping assertions");
          return;
        }
        const { stdout, stderr, exitCode } = await runFixture(env);
        // The fixture prints "CONNECTED" after the priming query succeeds. If
        // it never got that far, there's no MySQL to talk to in this
        // environment; the docker-gated branch above provides the CI coverage.
        if (!stdout.startsWith("CONNECTED")) {
          if (process.env.MYSQL_URL) {
            throw new Error(
              `sql-mysql-bind-blob-resizable: MYSQL_URL was provided but fixture never reached CONNECTED\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            );
          }
          console.warn("sql-mysql-bind-blob-resizable: MySQL not reachable; skipping assertions");
          return;
        }
        assertFixtureOutput(stdout, stderr, exitCode);
      },
      TEST_TIMEOUT,
    );
  });
}
