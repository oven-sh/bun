import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// The operand (joined onto the cwd when relative) was written into a fixed
// size path buffer without a bounds check, so a long enough operand aborted
// the whole process. Runs in a child process so a crash shows up as a failed
// assertion instead of taking the test runner down with it.
test("operands longer than the path buffers are reported, not a crash", async () => {
  using dir = tempDir("touch-long-operand", {});

  const fixture = /* ts */ `
    import { $ } from "bun";
    import { existsSync } from "node:fs";
    $.nothrow();
    // Longer than the join buffer and than PATH_MAX on linux (4096) and macOS (1024).
    const LONG = Buffer.alloc(5000, "a").toString();
    // Longer than LONG as written, but it is the normalized length that has to
    // be within the limit, so this one must still be created.
    const CHAIN = Buffer.alloc(7500, "x/../").toString() + "via-chain.txt";
    const cwd = (await $\`pwd\`.text()).trim();
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`touch \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString().replaceAll(LONG, "<LONG>") };
    };
    const results = {
      relative: await run(LONG),
      absolute: await run(cwd + "/" + LONG),
      mixed: { ...(await run(LONG, "short.txt")), shortCreated: existsSync("short.txt") },
      chain: { ...(await run(CHAIN)), created: existsSync("via-chain.txt") },
    };
    console.log(JSON.stringify({ cwd, results }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { cwd, results } = JSON.parse(stdout);

  // touch hands the joined path straight to the OS: POSIX answers ENAMETOOLONG
  // past PATH_MAX, which error Windows picks for a 5000-byte name is up to it.
  const tooLong = {
    exitCode: 1,
    stderr: isWindows
      ? expect.stringMatching(/^touch: [^\n]*<LONG>[^\n]*\n$/)
      : `touch: ${cwd}/<LONG>: File name too long\n`,
  };
  expect(results).toEqual({
    relative: tooLong,
    absolute: tooLong,
    mixed: { ...tooLong, shortCreated: true },
    chain: { exitCode: 0, stderr: "", created: true },
  });
  expect(exitCode).toBe(0);
});
