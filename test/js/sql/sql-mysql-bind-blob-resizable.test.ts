import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// CI reaches MySQL over TCP via MYSQL_URL; the sandboxed environment talks to
// the local mariadb through its unix socket as root (no TCP user configured).
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

const TEST_TIMEOUT = 30_000;

describe("mysql blob bind vs resizable ArrayBuffer", () => {
  test(
    "resizable BLOB param bytes are copied, not borrowed, across the bind loop",
    async () => {
      const env = mysqlEnv();
      if (!env) {
        throw new Error("sql-mysql-bind-blob-resizable: no MySQL reachable (set MYSQL_URL or provide a local socket)");
      }
      const { stdout, stderr, exitCode } = await runFixture(env);
      // Without the fix the borrowed slice reads memory resize(0) decommitted,
      // which segfaults: no JSON line and a non-zero exit.
      expect(stdout).toContain("CONNECTED");
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
      });
      expect(payload.calls).toBeGreaterThanOrEqual(2);
      expect(stderr).not.toContain("Segmentation");
      expect(exitCode).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
