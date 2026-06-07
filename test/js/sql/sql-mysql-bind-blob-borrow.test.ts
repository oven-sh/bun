import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";

// Regression: Value.fromJS for MySQL BLOB parameters borrowed the
// ArrayBuffer backing store without protecting it. A later parameter in
// the same bind loop can run user JS (array index getter here) that
// transfer()s the earlier buffer before execute.write() reads it, so the
// wire bytes come from memory the caller no longer owns.
//
// For a non-resizable ArrayBuffer, `buf.transfer()` with no arguments is
// zero-copy in JSC — the new buffer takes ownership of the same backing
// pointer. The fixture overwrites the transferred buffer with 0xff; without
// the fix MySQL would store 64 bytes of 0xff instead of 0..63. The fix pins
// the ArrayBuffer for the duration of bind+execute so transfer() hands the
// user a copy instead of detaching.

const fixture = path.join(import.meta.dir, "sql-mysql-bind-blob-borrow.fixture.ts");

async function runFixture(url: string, caPath = "") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, MYSQL_URL: url, CA_PATH: caPath },
    stdout: "pipe",
    stderr: "pipe",
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
  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const lines = stdout.trim().split(/\r?\n/);
  expect(lines[0]).toBe("CONNECTED");
  const payload = JSON.parse(lines[1] ?? "null");
  expect(payload).toEqual({
    calls: expect.any(Number),
    // With the ArrayBuffer pinned for the duration of bind+execute,
    // `buf.transfer()` inside the getter returns a copy and leaves the
    // original attached. Once the query resolves the pin is released and
    // `buf` becomes detachable again.
    detached: true,
    detachableAfter: true,
    originalHex: expectedHex(),
    gotHex: expectedHex(),
    name: "evil",
    match: true,
  });
  // The getter must have fired during bind (after Signature.generate),
  // otherwise the test isn't exercising the race.
  expect(payload.calls).toBeGreaterThanOrEqual(2);
  expect(exitCode).toBe(0);
}

// Spawning the debug bun subprocess + MySQL round-trip can exceed the 5s
// default on a cold cache under ASAN.
const TEST_TIMEOUT = 30_000;

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test(
      "BLOB param backing store is pinned across the bind loop",
      async () => {
        await container.ready;
        const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
        const { stdout, stderr, exitCode } = await runFixture(url);
        assertFixtureOutput(stdout, stderr, exitCode);
      },
      TEST_TIMEOUT,
    );
  });
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server
  // is reachable at MYSQL_URL or the conventional local address, exercise
  // the fixture there so the regression is still covered.
  const url = process.env.MYSQL_URL || "mysql://bun@127.0.0.1:3306/bun_sql_test";

  describe("mysql (local)", () => {
    test(
      "BLOB param backing store is pinned across the bind loop",
      async () => {
        const { stdout, stderr, exitCode } = await runFixture(url);
        // The fixture prints "CONNECTED" after the priming query succeeds. If
        // it never got that far, there's no MySQL to talk to in this
        // environment; the docker-gated branch above provides the CI coverage.
        if (!stdout.startsWith("CONNECTED")) {
          if (process.env.MYSQL_URL) {
            throw new Error(
              `sql-mysql-bind-blob-borrow: MYSQL_URL was provided but fixture never reached CONNECTED\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            );
          }
          console.warn("sql-mysql-bind-blob-borrow: no MySQL reachable at " + url + "; skipping assertions");
          return;
        }
        assertFixtureOutput(stdout, stderr, exitCode);
      },
      TEST_TIMEOUT,
    );
  });
}
