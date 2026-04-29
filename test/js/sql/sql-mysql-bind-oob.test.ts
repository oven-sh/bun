import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, isDockerEnabled } from "harness";
import path from "path";

// Regression: MySQLQuery.bind() allocates `params` sized to the prepared
// statement's signature and then iterates a *fresh* iterator over the user's
// values array. If that array grew between signature generation and bind
// (e.g. via an index getter with side effects), bind() would walk off the
// end of the allocation. With the fix it rejects with
// ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED and the connection stays
// usable.

const fixture = path.join(import.meta.dir, "sql-mysql-bind-oob.fixture.ts");

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

function assertFixtureOutput(stdout: string, stderr: string, exitCode: number) {
  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  const lines = stdout.trim().split(/\r?\n/);
  expect(lines[0]).toBe("CONNECTED");
  expect(JSON.parse(lines[1] ?? "null")).toEqual({
    result: {
      ok: false,
      code: "ERR_MYSQL_WRONG_NUMBER_OF_PARAMETERS_PROVIDED",
      message: expect.any(String),
    },
    after: [{ x: 2 }],
  });
  expect(exitCode).toBe(0);
}

if (isDockerEnabled()) {
  // CI: run against the docker-compose MySQL service.
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    test("bind() does not OOB when the params array grows during binding", async () => {
      await container.ready;
      const url = `mysql://root@${container.host}:${container.port}/bun_sql_test`;
      const { stdout, stderr, exitCode } = await runFixture(url);
      assertFixtureOutput(stdout, stderr, exitCode);
    });
  });
} else {
  // No docker daemon (e.g. local/sandboxed environments). If a MySQL server
  // is reachable at MYSQL_URL or the conventional local address, exercise the
  // fixture there so the regression is still covered.
  const url = process.env.MYSQL_URL || "mysql://bun@127.0.0.1:3306/bun_sql_test";

  describe("mysql (local)", () => {
    test("bind() does not OOB when the params array grows during binding", async () => {
      const { stdout, stderr, exitCode } = await runFixture(url);
      // The fixture prints "CONNECTED" after the priming query succeeds. If
      // it never got that far, there's no MySQL to talk to in this
      // environment; the docker-gated branch above provides the CI coverage.
      if (!stdout.startsWith("CONNECTED")) {
        if (process.env.MYSQL_URL) {
          // MYSQL_URL was explicitly provided; failing to connect is a real
          // error, not an environment without MySQL.
          throw new Error(
            `sql-mysql-bind-oob: MYSQL_URL was provided but fixture never reached CONNECTED\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          );
        }
        console.warn("sql-mysql-bind-oob: no MySQL reachable at " + url + "; skipping assertions");
        return;
      }
      assertFixtureOutput(stdout, stderr, exitCode);
    }, 30_000);
  });
}
