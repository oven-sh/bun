import { expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { tmpdir } from "node:os";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it.skipIf(isWindows)("reading a non-regular file sliced to near-max size should not overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Bun.file("/dev/null").slice(0, 2**52 - 2).arrayBuffer(); console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
});
