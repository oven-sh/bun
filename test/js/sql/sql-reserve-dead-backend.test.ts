// Issue #39562: a reserved connection whose backend the server closed must
// still tear down cleanly. release() is declared as returning void, so a
// rejected promise from it is always an unhandled rejection no caller can
// catch, and the reservation it fails to return keeps sql.end() pending
// forever.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test(
    "release() after the server closed the backend: no unhandled rejection, end() resolves",
    async () => {
      await container.ready;
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "sql-reserve-dead-backend-fixture.ts")],
        env: { ...bunEnv, DATABASE_URL: url() },
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("released\ndone\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    20_000,
  );

  test(
    "end() resolves after close() on a reserved connection",
    async () => {
      await container.ready;
      const sql = new SQL(url(), { max: 2 });
      const reserved = await sql.reserve();
      expect((await reserved`select 1 as x`)[0].x).toBe(1);
      await reserved.close();
      // hangs forever if the closed reservation is never returned to the pool
      await sql.end();
    },
    15_000,
  );
});
