import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// JSON.stringify quotes a string many characters at a time, and x64 and arm64 have code of their own for it.
test("JSON.stringify quotes a string as a quoting written character by character does", async () => {
  await using child = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "json-stringify-quoting-fixture.mjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "checked 131632 bad 0\n", stderr: "", exitCode: 0 });
});
