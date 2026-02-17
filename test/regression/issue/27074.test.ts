import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/27074
// node --run <script> (Node.js v22+) should be replaced with bun run <script>
// when using --bun flag

test("bun run --bun translates 'node --run' to 'bun run'", async () => {
  const dir = tempDirWithFiles("issue-27074", {
    "package.json": JSON.stringify({
      scripts: {
        greet: 'echo "hello from greet"',
        dev: "node --run greet",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--bun", "dev"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("hello from greet");
  expect(exitCode).toBe(0);
});
