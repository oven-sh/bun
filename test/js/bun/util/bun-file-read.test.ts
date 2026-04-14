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

it.skipIf(!isPosix)("reading a sliced non-regular file Blob does not overflow the initial buffer size", async () => {
  // .slice(1) on a file Blob whose size is unknown (max_size) yields a Blob with
  // size = max_size - 1. For a non-regular file (char device), this was used as
  // the initial buffer capacity and `size + 16` overflowed u52.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const a = await Bun.file("/dev/null").slice(1).arrayBuffer();
        if (a.byteLength !== 0) throw new Error("expected 0, got " + a.byteLength);
        const b = await Bun.file("/dev/zero").slice(0, 100).arrayBuffer();
        if (b.byteLength !== 100) throw new Error("expected 100, got " + b.byteLength);
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
});
