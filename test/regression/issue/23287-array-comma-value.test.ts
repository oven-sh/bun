import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #23287: (new Array([1, 2]), 'hi') parses correctly", async () => {
  using dir = tempDir("issue-23287", {
    "index.js": `
      // failing since Bun v1.2.22
      var f = (new Array([1, 2]), "hi");
      // failing since Bun v1.0.15
      var h = ([1, 2], "hi");
      console.log(f, h);
      `,
  });

  const { stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);

  expect(err).toBe("");
  expect(out).toBe("hi hi\n");
  expect(exitCode).toBe(0);
});
