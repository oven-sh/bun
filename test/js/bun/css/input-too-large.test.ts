import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Every byte offset the CSS parser hands to the rest of bun (import records,
// CSS module symbols, `composes`) and every line/column in its diagnostics is
// an i32, so once the tokenizer got past byte 2**31 of a stylesheet the process
// aborted with `panic: int cast: TryFromIntError(PosOverflow)`. The parser now
// refuses such input up front with an ordinary build error, before reading it.
//
// Each stylesheet here is one comment covering its first 2 GiB followed by a
// `composes` declaration, a cast site that both the bundler and
// `bun build --no-bundle` reach (a url() only becomes an import record when
// bundling). The comment body is all zero bytes, so it costs nothing to
// produce: untouched pages of a Uint8Array in one case, a hole in a sparse
// file in the other. Handing it to bun still costs the child 2 GiB of memory,
// hence the memory gate (the same one fs-oom.test.ts uses for its 2 GiB reads)
// and the generous timeouts. The tests are deliberately not concurrent, so at
// most one 2 GiB child exists at a time.
const TAIL = "*/.a{composes:b}\n";
const MESSAGE = "CSS file is too large to parse (2 GiB maximum)";

describe.skipIf(os.totalmem() < 10 * 1024 ** 3)("stylesheet of 2 GiB or more", () => {
  test("Bun.build reports an error naming the file", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tail = new TextEncoder().encode(${JSON.stringify(TAIL)});
          const bytes = new Uint8Array(2 ** 31 + tail.length);
          bytes.set([0x2f, 0x2a]); // "/*"
          bytes.set(tail, 2 ** 31);
          const result = await Bun.build({
            entrypoints: ["/app/big.css"],
            files: { "/app/big.css": bytes },
            throw: false,
          });
          console.log(JSON.stringify({
            success: result.success,
            logs: result.logs.map(log => ({ level: log.level, message: log.message, file: log.position?.file })),
          }));
          `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      success: false,
      logs: [{ level: "error", message: MESSAGE, file: "/app/big.css" }],
    });
    expect(exitCode).toBe(0);
  }, 30_000);

  // Windows only makes a file sparse on request, so seeking past 2 GiB there
  // would really write 2 GiB of zeros. The bound is the same code on every
  // platform and the test above already runs there.
  test.skipIf(isWindows)(
    "bun build --no-bundle reports an error",
    async () => {
      using dir = tempDir("css-too-large", {});
      const css = join(String(dir), "big.css");
      const tail = Buffer.from(TAIL);
      const fd = openSync(css, "w");
      try {
        writeSync(fd, Buffer.from("/*"), 0, 2, 0);
        writeSync(fd, tail, 0, tail.length, 2 ** 31);
      } finally {
        closeSync(fd);
      }
      expect(statSync(css).size).toBe(2 ** 31 + tail.length);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", css],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`error: ${MESSAGE}`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    },
    30_000,
  );
});
