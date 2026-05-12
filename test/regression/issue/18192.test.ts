// https://github.com/oven-sh/bun/issues/18192
// Bun.file(path).slice(...).stream() would hang forever when the underlying
// file was larger than 640 KiB, because FileReader.onReadChunk() stopped
// asking for more data once max_size was reached but never closed the
// underlying reader — leaving isDone() == false and the next onPull()
// parked on a pending promise that nothing would ever resolve (regular
// files are not pollable).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("#18192 Bun.file().slice().stream() on large files", () => {
  for (const fileSize of [512 * 1024, 640 * 1024, 640 * 1024 + 1, 768 * 1024, 2 * 1024 * 1024]) {
    test(`slice(0, 1) on a ${fileSize}-byte file does not hang`, async () => {
      using dir = tempDir("issue-18192", {
        "run.js": `
          import { writeFileSync } from "fs";
          writeFileSync("data", Buffer.alloc(${fileSize}, 0x41));
          const text = await Bun.readableStreamToText(Bun.file("data").slice(0, 1).stream());
          console.log(JSON.stringify({ len: text.length, first: text }));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "run.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(JSON.stringify({ len: 1, first: "A" }));
      expect(exitCode).toBe(0);
    });
  }

  test("slice(start, end) on a large file yields the correct bytes", async () => {
    using dir = tempDir("issue-18192", {
      "run.js": `
        import { writeFileSync } from "fs";
        const size = 1024 * 1024;
        const buf = Buffer.alloc(size);
        for (let i = 0; i < size; i++) buf[i] = i % 256;
        writeFileSync("data", buf);

        for (const [start, end] of [[0, 1], [5, 10], [300_000, 300_005], [0, 300_000], [700_000, 700_001]]) {
          const chunks = [];
          for await (const chunk of Bun.file("data").slice(start, end).stream()) {
            chunks.push(chunk);
          }
          const got = Buffer.concat(chunks);
          const want = buf.subarray(start, end);
          if (!got.equals(want)) {
            console.log("FAIL", start, end, "got", got.length, "bytes, want", want.length);
            process.exit(1);
          }
        }
        console.log("OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
