import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { open } from "node:fs/promises";
import { join } from "path";

// `bun <(cmd)` hands bun a /dev/fd/N path that opens to a pipe. The CLI used
// to readlink that to `pipe:[inode]` (Linux) or fail F_GETPATH (macOS) and
// then try to load the module from that non-path. A named FIFO is the same
// shape without a bash dependency.
describe.skipIf(!isPosix)("entry point is a pipe/FIFO", () => {
  test.concurrent("runs a named FIFO entry point", async () => {
    using dir = tempDir("run-fifo", {});
    const fifo = join(String(dir), "script");
    mkfifo(fifo);

    await using proc = Bun.spawn({
      cmd: [bunExe(), fifo, "extra"],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // `open(O_WRONLY)` on a FIFO blocks in the threadpool until the child
    // opens the read end; closing then delivers EOF to the child.
    const feed = (async () => {
      const w = await open(fifo, "w");
      await w.writeFile(`console.log(JSON.stringify({ argv: process.argv.slice(1), file: __filename }));\n`);
      await w.close();
    })().catch(e => e);

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    await feed;
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ argv: [fifo, "extra"], file: fifo });
    expect(exitCode).toBe(0);
  });

  const bash = Bun.which("bash");
  test.concurrent.skipIf(!bash)("runs a process-substitution entry point (bash <())", async () => {
    const script = `console.log(JSON.stringify({ argv1: process.argv[1], file: import.meta.path, main: import.meta.main, bunMain: Bun.main, sum: 1 + 2 }))`;
    await using proc = Bun.spawn({
      cmd: [bash!, "-c", `exec "$BUN" <(printf %s "$SCRIPT")`],
      env: { ...bunEnv, BUN: bunExe(), SCRIPT: script },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.file).toMatch(/^\/dev\/fd\/\d+$/);
    expect(parsed).toEqual({ argv1: parsed.file, file: parsed.file, main: true, bunMain: parsed.file, sum: 3 });
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!bash)("error stack points at the given /dev/fd path", async () => {
    await using proc = Bun.spawn({
      cmd: [bash!, "-c", `exec "$BUN" <(printf %s 'throw new Error("boom")')`],
      env: { ...bunEnv, BUN: bunExe() },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("boom");
    expect(stderr).toMatch(/\/dev\/fd\/\d+/);
    expect(stderr).not.toMatch(/pipe:\[\d+\]/);
    expect(exitCode).toBe(1);
  });
});
