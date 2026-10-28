import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { createServer } from "node:net";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("a refused connection rejects the query with the error class of its adapter", async () => {
  using dir = tempDir("aot-sql-refused-connection", {
    "main.ts": `
      import { SQL } from "bun";

      for (const url of process.argv.slice(2)) {
        const sql = new SQL(url, { max: 1 });
        try {
          await sql\`select 1\`;
          console.log("connected");
        } catch (error: any) {
          const adapterError = url.startsWith("mysql") ? SQL.MySQLError : SQL.PostgresError;
          console.log(error.name, error.code, error instanceof adapterError, error instanceof SQL.SQLError, error instanceof Error);
        }
        await sql.close();
      }
    `,
  });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const { stderr: buildErrors, exitCode: buildExitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable],
    String(dir),
  );
  expect({ errors: buildExitCode === 0 ? "" : buildErrors, exitCode: buildExitCode }).toEqual({
    errors: "",
    exitCode: 0,
  });

  const port = await closedPort();
  const { stdout, stderr, exitCode } = await run(
    [
      executable,
      `postgres://user:password@127.0.0.1:${port}/database`,
      `mysql://user:password@127.0.0.1:${port}/database`,
    ],
    String(dir),
  );
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      "PostgresError ERR_POSTGRES_CONNECTION_REFUSED true true true\nMySQLError ERR_MYSQL_CONNECTION_REFUSED true true true\n",
    stderr: "",
    exitCode: 0,
  });
}, 240_000);
