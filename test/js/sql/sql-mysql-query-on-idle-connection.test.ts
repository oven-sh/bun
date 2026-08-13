// A MySQL connection unrefs the event loop once it has nothing in flight.
// Enqueueing a query on it has to ref the loop again, otherwise a script whose
// next query lands on an idle pool connection (after sql.begin(), after
// reserve() + release(), or simply on a later event loop turn) exits with code
// 0 while that query is still pending. Each scenario runs in its own process
// because the test runner keeps the event loop alive on its own; see the
// fixture for what each scenario sets up.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, normalizeBunSnapshot } from "harness";
import path from "path";

const fixture = path.join(import.meta.dir, "sql-mysql-query-on-idle-connection-fixture.ts");

describeWithContainer("mysql", { image: "mysql_plain", concurrent: true }, container => {
  test.each(["begin", "reserve", "turn"])("the process stays alive for a query issued after %s", async scenario => {
    await container.ready;
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, scenario],
      env: { ...bunEnv, MYSQL_URL: `mysql://root@${container.host}:${container.port}/bun_sql_test` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.split(/\r?\n/).filter(line => line && !line.startsWith("WARNING: ASAN interferes"))).toEqual([]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "first step done
      second query done: 2"
    `);
    expect(exitCode).toBe(0);
  });
});
