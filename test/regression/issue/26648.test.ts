import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("MySQL unix socket error message should not say 'postgresql'", async () => {
  using dir = tempDir("mysql-socket-test", {
    "test.ts": `
import { join } from "path";
// Create a regular file (not a socket) to trigger the connection error
const fakeSockPath = join(import.meta.dirname, "fake.sock");
await Bun.write(fakeSockPath, "");

const conn = new Bun.SQL({
  adapter: 'mysql',
  path: fakeSockPath,
  username: 'root',
  database: 'test'
});

try {
  await conn\`select 1\`;
} catch(e) {
  console.log(e.message);
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("postgresql");
  expect(output).toContain("mysql");
  expect(exitCode).toBe(0);
});
