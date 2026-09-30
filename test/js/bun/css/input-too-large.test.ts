import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Every byte offset the CSS parser hands to the rest of bun (import records,
// CSS module symbols, `composes`) and every line/column in its diagnostics is
// an i32, so once the tokenizer got past byte 2**31 of a stylesheet the process
// aborted with `panic: int cast: TryFromIntError(PosOverflow)`. The parser now
// refuses input longer than MAX_INPUT_LEN up front with an ordinary error,
// before reading it.
//
// Each stylesheet here is one comment covering almost all of it followed by a
// `composes` declaration, a cast site that every entry point reaches (a url()
// only becomes an import record when bundling). The comment body is all zero
// bytes or spaces, so it is cheap to produce: untouched pages of a Uint8Array,
// a hole in a sparse file, or one Buffer.alloc. Handing it to bun still costs
// the child 2 to 4.5 GiB of memory, hence the memory gate (the same one
// fs-oom.test.ts uses for its 2 GiB reads) and the timeout: a child takes 3 to
// 8 s in a debug build. The tests are deliberately not concurrent, so at most
// one such child exists at a time.
const MAX_INPUT_LEN = 2 ** 31 - 2;
const TAIL = "*/.a{composes:b}\n";
const MESSAGE = "CSS file is too large to parse (2 GiB maximum)";
const CHILD_TIMEOUT = 30_000;

// Inside a container os.totalmem() reports the host's RAM;
// process.constrainedMemory() reports the cgroup limit there.
const memory = Math.min(os.totalmem(), process.constrainedMemory() || Infinity);

// Builds an in-memory stylesheet of `length` bytes with `Bun.build` and prints
// the outcome. The comment closes `TAIL.length` bytes before the end.
function bunBuildScript(length: number): string {
  return `
    const tail = new TextEncoder().encode(${JSON.stringify(TAIL)});
    const bytes = new Uint8Array(${length});
    bytes.set([0x2f, 0x2a]); // "/*"
    bytes.set(tail, bytes.length - tail.length);
    const result = await Bun.build({
      entrypoints: ["/app/big.css"],
      files: { "/app/big.css": bytes },
      throw: false,
    });
    console.log(JSON.stringify({
      success: result.success,
      logs: result.logs.map(log => ({ level: log.level, message: log.message, file: log.position?.file })),
    }));
  `;
}

describe.skipIf(memory < 10 * 1024 ** 3)("stylesheet of 2 GiB or more", () => {
  // The `composes` sits past byte 2**31, where its offset no longer fits an
  // i32. This is the input that aborted before.
  test(
    "Bun.build reports an error naming the file",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", bunBuildScript(2 ** 31 + TAIL.length)],
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
    },
    CHILD_TIMEOUT,
  );

  // One byte past the limit is rejected too, even though every offset in it
  // still fits an i32. (At the limit the stylesheet parses, but a 2 GiB
  // tokenize takes minutes in a debug build, so that side is not tested.)
  test(
    "Bun.build rejects MAX_INPUT_LEN + 1 bytes",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", bunBuildScript(MAX_INPUT_LEN + 1)],
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
    },
    CHILD_TIMEOUT,
  );

  // Windows only makes a file sparse on request, so seeking past 2 GiB there
  // would really write 2 GiB of zeros. The bound is the same code on every
  // platform and the tests above already run there.
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
      expect(stderr).toBe(`error: ${MESSAGE} parsing\n`);
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    },
    CHILD_TIMEOUT,
  );

  // A style attribute goes through `StyleAttribute::parse`, the other entry
  // point with the bound. A JS string holds at most 2**31 - 1 code units, so
  // the tail is Latin-1 text that grows when encoded as UTF-8: that puts the
  // `composes` past byte 2**31 and its offset out of i32 range.
  test(
    "StyleAttribute::parse reports an error",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { cssInternals } = require("bun:internal-for-testing");
            const length = 2 ** 31 - 1;
            const buf = Buffer.alloc(length, 0x20);
            const tail = Buffer.from("/*" + "\\u00e9".repeat(40) + "*/composes:b", "latin1");
            tail.copy(buf, length - tail.length);
            try {
              cssInternals.attrTest(buf.toString("latin1"), "", false);
              console.log("parsed");
            } catch (error) {
              console.log(error.message);
            }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe(`parsing failed: ${MESSAGE}\n`);
      expect(exitCode).toBe(0);
    },
    CHILD_TIMEOUT,
  );
});
