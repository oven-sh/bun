import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Relative operands used to be joined onto the cwd through a fixed 4096-byte
// buffer with no bounds check, so a long enough operand aborted the whole
// process, and absolute ones past PATH_MAX were reported as ENOENT. Runs in a
// child process so a crash shows up as a failed assertion instead of taking
// the test runner down with it.
test("operands longer than the path buffers are reported, not a crash", async () => {
  using dir = tempDir("mkdir-long-operand", {});

  const fixture = /* ts */ `
    import { $ } from "bun";
    import { existsSync } from "node:fs";
    $.nothrow();
    // Longer than the join buffer and than PATH_MAX on linux (4096) and macOS (1024).
    const LONG = Buffer.alloc(5000, "a").toString();
    // Longer than MAX_PATH_BYTES on Windows as well (32767 * 3 + 1).
    const HUGE = Buffer.alloc(100_000, "b").toString();
    // Longer than all of the above as written, but it is the normalized length
    // that has to be within the limit, so this one must still be created.
    const CHAIN = Buffer.alloc(7500, "x/../").toString() + "via-chain";
    const cwd = (await $\`pwd\`.text()).trim();
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`mkdir \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString().replaceAll(LONG, "<LONG>").replaceAll(HUGE, "<HUGE>") };
    };
    const results = {
      relative: await run(LONG),
      parents: await run("-p", LONG),
      parentsChild: await run("-p", LONG + "/child"),
      absolute: await run(cwd + "/" + LONG),
      absoluteParents: await run("-p", cwd + "/" + LONG),
      huge: await run(HUGE),
      mixed: { ...(await run(LONG, "short")), shortCreated: existsSync("short") },
      chain: { ...(await run(CHAIN)), created: existsSync("via-chain") },
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

  // A 5000-byte name is below MAX_PATH_BYTES on Windows, so there the errno is
  // up to the OS; on POSIX (and for HUGE everywhere) mkdir rejects it itself.
  const tooLong = (shown: string) => ({
    exitCode: 1,
    stderr: isWindows
      ? expect.stringMatching(/^mkdir: [^\n]*<LONG>[^\n]*\n$/)
      : `mkdir: ${cwd}/${shown}: File name too long\n`,
  });
  expect(results).toEqual({
    relative: tooLong("<LONG>"),
    parents: tooLong("<LONG>"),
    parentsChild: tooLong("<LONG>/child"),
    absolute: tooLong("<LONG>"),
    absoluteParents: tooLong("<LONG>"),
    huge: {
      exitCode: 1,
      stderr: isWindows
        ? expect.stringMatching(/^mkdir: [^\n]*<HUGE>: File name too long\n$/)
        : `mkdir: ${cwd}/<HUGE>: File name too long\n`,
    },
    mixed: { ...tooLong("<LONG>"), shortCreated: true },
    chain: { exitCode: 0, stderr: "", created: true },
  });
  expect(exitCode).toBe(0);
});
