// https://github.com/oven-sh/bun/issues/26837
// Test that `bun install --production` does not install optional peer
// dependencies that are also listed as devDependencies. When a production
// dependency (e.g. @prisma/client) has an optional peer (e.g. typescript),
// and that same package appears in the root devDependencies, `--production`
// should NOT install it.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--production should not install optional peers that match devDependencies", async () => {
  using dir = tempDir("issue-26837", {
    "package.json": JSON.stringify({
      name: "test-issue-26837",
      dependencies: {
        "@prisma/client": "^6.3.1",
      },
      devDependencies: {
        typescript: "^5.7.3",
      },
    }),
  });

  // Run bun install --production
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--production"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // typescript should NOT be installed since it's a devDependency
  // and we're installing with --production
  const output = stdout + stderr;
  expect(output).not.toContain("error:");

  // Check that typescript is not in node_modules
  const typescriptExists = await Bun.file(`${dir}/node_modules/typescript/package.json`).exists();
  expect(typescriptExists).toBe(false);

  expect(exitCode).toBe(0);
});
