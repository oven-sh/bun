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

it.skipIf(isWindows)("slicing a non-regular file blob by offset should not overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Bun.file("/dev/null").slice(1).text().then(() => console.log("ok"), e => console.log("ok", e?.name));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
