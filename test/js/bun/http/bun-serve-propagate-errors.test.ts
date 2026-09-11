import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.serve() propagates errors to the parent fixture", async () => {
  const code = `import { test } from "bun:test";

test("Bun.serve() propagates errors to the parent", async () => {
  const server = Bun.serve({
    development: false,
    port: 0,
    fetch(req) {
      throw new Error("Test failed successfully");
    },
  });
  await fetch(server.url);
  server.stop(true);
});
`;
  await using dir = tempDir("propagate-errors", {
    "package.json": JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: {},
    }),
    "index.test.ts": code,
  });

  const { stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "test"],
    cwd: dir,
    env: bunEnv,
    stdout: "inherit",
    stdin: "inherit",
    stderr: "pipe",
  });

  expect(exitCode).toBe(1);
  expect(stderr.toString()).toContain("error: Test failed successfully");
});

test("under bun run, a fetch handler error with no error() handler fails the process and its exit listeners see it", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.on("exit", code => console.log("exit", code, process.exitCode));
      const server = Bun.serve({
        development: false,
        port: 0,
        fetch() {
          throw new Error("Test failed successfully");
        },
      });
      const res = await fetch(server.url);
      console.log(res.status);
      server.stop(true);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("error: Test failed successfully");
  // The served 500 is reported like any other unhandled error, so the exit
  // code is 1 by the time 'exit' is emitted, not only once the process exits.
  expect(stdout).toBe("500\nexit 1 1\n");
  expect(exitCode).toBe(1);
});
