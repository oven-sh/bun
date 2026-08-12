import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { closeSync, openSync } from "node:fs";

// On POSIX the builtin `cat` is only used with this flag set (see
// `Kind::DISABLED_ON_POSIX`); without it `cat` is the system binary.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// Code for a child bun that runs `script` and prints the script's stdout
// followed by an `exit=<code>` trailer. A hang or a crash in the child shows up
// as a missing trailer. (Both go through process.stdout: console.log takes a
// separate path to fd 1 and can overtake a large pending process.stdout.write.)
function childCode(script: string, quiet: boolean): string {
  const run = `Bun.$\`\${{ raw: ${JSON.stringify(script)} }}\`.nothrow()`;
  const trailer = `process.stdout.write("exit=" + r.exitCode + "\\n");`;
  return quiet
    ? `const r = await ${run}.quiet(); process.stdout.write(r.stdout); ${trailer}`
    : `const r = await ${run}; ${trailer}`;
}

type Stdin =
  // Written to a pipe that is closed right away, so stdin reaches EOF.
  | { input: string }
  // Reading a directory fails, so every `cat` reading stdin fails.
  | { directory: string };

function spawnChild(script: string, stdin: Stdin, quiet: boolean) {
  const cmd = [bunExe(), "-e", childCode(script, quiet)];
  if ("directory" in stdin) {
    const fd = openSync(stdin.directory, "r");
    try {
      return Bun.spawn({ cmd, env: builtinEnv, stdin: fd, stdout: "pipe", stderr: "pipe" });
    } finally {
      closeSync(fd);
    }
  }
  const proc = Bun.spawn({ cmd, env: builtinEnv, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(stdin.input);
  proc.stdin.end();
  return proc;
}

async function runScript(script: string, stdin: Stdin, { quiet = true } = {}) {
  await using proc = spawnChild(script, stdin, quiet);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every `cat` reading the script's stdin (or a pipeline stage's stdin)
// registers on the single IOReader owned by that fd. Once the first `cat` has
// consumed a read cycle (EOF or error), a later `cat` on the same fd has to
// start a new one and must be the only listener notified by it.
//
// Skipped on Windows, where the reader closes its libuv source at EOF; a second
// `cat` on the same fd there is covered by the fix in #29986.
describe.skipIf(isWindows)("cat (builtin) sharing one stdin reader", () => {
  describe("after the first cat reached EOF", () => {
    const scripts: [script: string, stdout: string][] = [
      ["cat; echo ---; cat", "hi\n---\n"],
      ["cat && echo --- && cat", "hi\n---\n"],
      // The second restart starts from a reader that was already restarted once.
      ["cat; cat; cat", "hi\n"],
      // The subshell / if node is allocated before the second cat, so the second
      // cat does not reuse the first cat's node id: a listener entry left over
      // from the first cat would be dispatched to a node that is not a cat.
      ["cat; (echo ---; cat)", "hi\n---\n"],
      ["cat; if true; then echo ---; cat; fi", "hi\n---\n"],
    ];

    // With captured output, the first cat's completion runs the rest of the
    // script synchronously, so the second cat registers from inside the
    // reader's EOF callback.
    describe("captured stdout", () => {
      test.concurrent.each(scripts)("%s", async (script, expected) => {
        const result = await runScript(script, { input: "hi\n" });
        expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
      });
    });

    // With stdout going through an IOWriter, a command can also complete from a
    // write callback, after the EOF callback has returned.
    describe("inherited stdout", () => {
      test.concurrent.each(scripts)("%s", async (script, expected) => {
        const result = await runScript(script, { input: "hi\n" }, { quiet: false });
        expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
      });
    });

    test.concurrent("input spanning several reads", async () => {
      const input = Buffer.alloc(300_000, "abcdefghij\n").toString();
      const result = await runScript("cat; cat", { input });
      expect(result.stderr).toBe("");
      expect(result.stdout.length).toBe(input.length + "exit=0\n".length);
      expect(result.stdout).toBe(`${input}exit=0\n`);
      expect(result.exitCode).toBe(0);
    });

    test.concurrent("stdin of a pipeline stage", async () => {
      const result = await runScript("echo hi | (cat; echo ---; cat)", { input: "" });
      expect(result).toEqual({ stdout: "hi\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // Bun.spawn's stdin pipe is a socketpair; this is the same thing over an
    // actual pipe.
    test.concurrent("stdin is a pipe", async () => {
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'printf "hi\\n" | "$0" -e "$1"', bunExe(), childCode("cat; echo ---; cat", true)],
        env: builtinEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hi\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // The first cat fails on its stdout write while the read that delivered the
    // chunk is still running and unregisters itself. With captured output the
    // second cat registers right away, while that read is still in flight, and
    // is served by it. With stdout going through an IOWriter, `echo` completes
    // later, so the read reaches EOF with nobody listening and the second cat
    // registers only after that.
    describe.if(isLinux)("first cat unregistering mid-read", () => {
      test.concurrent.each([true, false])("quiet: %p", async quiet => {
        const result = await runScript(
          "cat > /dev/full || echo first-failed; cat && echo second-ok",
          { input: "hi\n" },
          { quiet },
        );
        expect(result).toEqual({ stdout: "first-failed\nsecond-ok\nexit=0\n", stderr: "", exitCode: 0 });
      });
    });
  });

  describe("after the first cat failed to read", () => {
    test.concurrent.each([
      "cat || echo first-failed; echo ---; cat || echo second-failed",
      // Second cat in a node id different from the first cat's (see above).
      "cat || echo first-failed; (echo ---; cat) || echo second-failed",
    ])("%s", async script => {
      const result = await runScript(script, { directory: import.meta.dir });
      expect(result).toEqual({ stdout: "first-failed\n---\nsecond-failed\nexit=0\n", stderr: "", exitCode: 0 });
    });
  });
});
