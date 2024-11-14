import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
  const dir = tempDirWithFiles("propagate-errors", {
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
