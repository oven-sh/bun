// Bun.embeddedFiles must borrow the embedded executable section directly
// (the same zero-copy path Bun.file() uses for embedded paths) rather than
// heap-copying every file's bytes on first access.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import path from "node:path";

// Windows RSS accounting for the mapped executable section is too noisy for
// the threshold below to be meaningful there.
test.skipIf(isWindows)(
  "Bun.embeddedFiles does not heap-copy embedded file bytes",
  async () => {
    const SIZE = 20 * 1024 * 1024;

    using dir = tempDir("embedded-files-zero-copy", {
      "entry.ts": `
        // @ts-nocheck
        import p from "./big.bin" with { type: "file" };
        if (p.length === 0) throw new Error("asset import dropped");

        Bun.gc(true);
        const before = process.memoryUsage().rss;
        const files = Bun.embeddedFiles;
        Bun.gc(true);
        const after = process.memoryUsage().rss;

        if (files.length !== 1) throw new Error("expected 1 embedded file, got " + files.length);
        const f = files[0];
        // Verify the borrowed bytes are correct without forcing the whole
        // section resident: slice head and tail only.
        const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
        const tail = new Uint8Array(await f.slice(f.size - 4, f.size).arrayBuffer());
        console.log(JSON.stringify({
          delta: after - before,
          size: f.size,
          head: Array.from(head),
          tail: Array.from(tail),
        }));
      `,
    });

    // Distinct head/tail markers so a wrong-offset borrow would be caught.
    const big = Buffer.alloc(SIZE, 0x42);
    big[0] = 0xde;
    big[1] = 0xad;
    big[2] = 0xbe;
    big[3] = 0xef;
    big[SIZE - 4] = 0xca;
    big[SIZE - 3] = 0xfe;
    big[SIZE - 2] = 0xba;
    big[SIZE - 1] = 0xbe;
    writeFileSync(path.join(String(dir), "big.bin"), big);

    const out = path.join(String(dir), "app");
    {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.ts"), "--outfile", out],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [bout, berr, bcode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(berr).not.toContain("error:");
      expect({ stdout: bout, exitCode: bcode }).toMatchObject({ exitCode: 0, stdout: expect.any(String) });
    }

    await using proc = Bun.spawn({
      cmd: [out],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");

    const result = JSON.parse(stdout.trim());
    expect({
      size: result.size,
      head: result.head,
      tail: result.tail,
    }).toEqual({
      size: SIZE,
      head: [0xde, 0xad, 0xbe, 0xef],
      tail: [0xca, 0xfe, 0xba, 0xbe],
    });
    // A heap copy of the bytes costs at least SIZE (and in practice ~2x SIZE
    // since reading the section to copy it also pages it in). Borrowing the
    // 'static slice touches none of it. Allow generous slack for allocator /
    // JS-array overhead.
    expect(result.delta).toBeLessThan(SIZE / 2);
    expect(exitCode).toBe(0);
  },
  // `bun build --compile` copies + rewrites the full bun executable, which
  // under a debug build takes several seconds on its own.
  60_000,
);
