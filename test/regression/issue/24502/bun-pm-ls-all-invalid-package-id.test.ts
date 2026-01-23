import { expect, test } from "bun:test";
import { bunEnv, bunExe, runBunInstall, tempDirWithFiles } from "harness";

test("unresolved optional peers don't crash", async () => {
  const testDir = tempDirWithFiles("unresolved-optional-peer", {
    "package.json": JSON.stringify({
      name: "pkg",
      peerDependencies: {
        jquery: "3.7.1",
      },
      peerDependenciesMeta: {
        jquery: {
          optional: true,
        },
      },
    }),
  });

  await runBunInstall(bunEnv, testDir);

  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--all"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(await exited).toBe(0);
  expect(await stdout.text()).toBe("");
  expect(await stderr.text()).toBe("");
});
