import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "path";

const fixture = path.join(import.meta.dir, "sql-mysql-bind-blob-borrow.fixture.ts");

for (const image of ["mysql_plain", "mariadb_plain"]) {
  describeWithContainer(image, { image }, container => {
    test("a buffer that a later parameter's toJSON detaches, shrinks or drops", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...bunEnv, MYSQL_URL: `mysql://root@${container.host}:${container.port}/bun_sql_test` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        stderr: stderr
          .split(/\r?\n/)
          .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
          .join("\n"),
        results: stdout ? JSON.parse(stdout) : stdout,
      }).toEqual({
        stderr: "",
        results: {
          "view of a transferred ArrayBuffer": '0 .. "hurt"',
          "view of a resizable ArrayBuffer, resized to 0": '0 .. "hurt"',
          "resizable ArrayBuffer, resized to 0": '0 .. "hurt"',
          "length-tracking view, buffer halved": '524288 ABAB..ABAB "hurt"',
          "fixed-length view that falls out of bounds": '0 .. "hurt"',
          "buffer nothing else refers to, with a GC": '1048576 ABAB..ABAB "hurt"',
          "small typed array nothing else refers to, with a GC": '16 ABAB..ABAB "hurt"',
          "connection afterwards": "usable",
        },
      });
      expect(exitCode).toBe(0);
    });
  });
}
