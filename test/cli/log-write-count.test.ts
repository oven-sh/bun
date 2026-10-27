import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, canCountWriteSyscalls, runCommandWriteCount, tempDir } from "harness";

// A command prints its log (errors, warnings and their notes) to stderr through a 4 KB buffer,
// not with one write(2) for each piece of a message or for each space under a source line.
//
// write(2) calls are counted from /proc/<pid>/io: Linux, with task I/O accounting in the kernel.
describe.skipIf(!canCountWriteSyscalls())("bun build writes its log to stderr a buffer at a time", () => {
  const colors = {
    NO_COLOR: { ...bunEnv, NO_COLOR: "1" },
    FORCE_COLOR: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: "0" },
  };

  for (const [color, env] of Object.entries(colors)) {
    /** Builds `entry` in a directory that holds `files`. `bytes` is the length of stderr with its colors. */
    async function build(files: Record<string, string>, entry: string) {
      using dir = tempDir("log-write-count", files);
      const result = await runCommandWriteCount({
        cmd: [bunExe(), "build", entry, "--outdir", "out"],
        cwd: String(dir),
        env,
      });
      return { ...result, stderr: Bun.stripANSI(result.stderr), bytes: result.stderr.length };
    }

    describe.concurrent(color, () => {
      test("one error", async () => {
        const { stderr, writes, exitCode } = await build(
          { "one.mjs": "const aaaaaaaaaaaaaaa = 1, bbbbbbbbbbbb = 2 +;\n" },
          "./one.mjs",
        );
        expect(stderr).toStartWith(
          `1 | const aaaaaaaaaaaaaaa = 1, bbbbbbbbbbbb = 2 +;\n${Buffer.alloc(49, " ")}^\nerror: Unexpected ;\n`,
        );
        // One write holds the log. The others do not go to stderr.
        expect(writes).toBeLessThan(8);
        expect(exitCode).toBe(1);
      });

      test("100 errors on one line", async () => {
        // Each assignment is an error with a note, and its caret is 15 columns further right.
        const { stderr, bytes, writes, exitCode } = await build(
          { "many.mjs": `const c=0;${Buffer.alloc(100 * 15, "try{c=1}catch{}")}\n` },
          "./many.mjs",
        );
        expect(stderr.match(/^error: Cannot assign to "c" because it is a constant$/gm)).toHaveLength(100);
        expect(bytes).toBeGreaterThan(4 * 4096);
        // Two writes in a row hold more than 4 KB together.
        expect(writes).toBeLessThan(bytes / 2048 + 8);
        expect(exitCode).toBe(1);
      });

      test("an error in bunfig.toml, with a masked password", async () => {
        // The loader of bunfig.toml prints its own log.
        const { stderr, writes, exitCode } = await build(
          { "ok.mjs": "export default 1;\n", "bunfig.toml": `l;password = "${Buffer.alloc(64, "x")}"\n` },
          "./ok.mjs",
        );
        expect(stderr).toStartWith(
          `1 | l;password = "${Buffer.alloc(64, "*")}"\n     ^\nerror: Expected '=' after a key but found (redacted)\n`,
        );
        expect(writes).toBeLessThan(8);
        expect(exitCode).toBe(1);
      });
    });
  }
});
