import { expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { bunEnv, bunExe, isPosix } from "harness";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

it.skipIf(!isPosix)("reading a file blob sliced to near Blob.max_size should not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Bun.file("/dev/zero").slice(0, 4503599627370490).text().then(() => {}, () => {});`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
