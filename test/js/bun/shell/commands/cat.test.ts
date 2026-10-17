import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";
import { closeSync, openSync } from "node:fs";

// On POSIX the builtin `cat` is only used with this flag set (see
// `Kind::DISABLED_ON_POSIX`); without it `cat` is the system binary. On Windows
// the builtin is the default and the flag does nothing.
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
// consumed a read (EOF or error), a later `cat` on the same fd must be the only
// listener notified by the read that serves it: on POSIX a new read of the fd,
// on Windows (where the reader closes the fd at EOF) the EOF already reached.
describe("cat (builtin) sharing one stdin reader", () => {
  describe("after the first cat reached EOF", () => {
    const scripts: [script: string, stdout: string][] = [
      ["cat; echo ---; cat", "hi\n---\n"],
      ["cat && echo --- && cat", "hi\n---\n"],
      // The second restart starts from a reader that was already restarted once.
      ["cat; cat; cat", "hi\n"],
      // On Windows every cat after the first finishes on the spot, from inside
      // the previous cat's completion. The debug build asserts (Yield.rs) if
      // those completions nest instead of following each other on the same
      // trampoline, which takes four or more cats in a row to show.
      ["cat; cat; cat; cat; cat; cat; echo ---", "hi\n---\n"],
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

    // Bun.spawn's stdin pipe is a socketpair on POSIX; this is the same thing
    // over an actual pipe. (On Windows it is a pipe to begin with.)
    test.concurrent.skipIf(isWindows)("stdin is a pipe", async () => {
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'printf "hi\\n" | "$0" -e "$1"', bunExe(), childCode("cat; echo ---; cat", true)],
        env: builtinEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hi\n---\nexit=0\n", stderr: "", exitCode: 0 });
    });

    // On a pipe the new read only reports EOF again, which looks the same as
    // completing the second cat on the spot. A tty's EOF (^D) is used up by the
    // read that sees it, so here the second cat only finishes if it really reads
    // the fd again and gets the input typed after the first cat is done. POSIX
    // only: on Windows the fd is closed at the first EOF, so the second cat
    // finishes on the spot there (the cases above).
    test.concurrent.skipIf(isWindows)("stdin is a tty: the second cat reads the input typed for it", async () => {
      let output = "";
      const separator = Promise.withResolvers<void>();
      const trailer = Promise.withResolvers<void>();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", childCode("cat; echo ---; cat", false)],
        env: builtinEnv,
        terminal: {
          data(_, chunk) {
            output += Buffer.from(chunk).toString();
            if (output.includes("---\n")) separator.resolve();
            if (/exit=\d+\n/.test(output)) trailer.resolve();
          },
          // Fires once the exited child's output has all been delivered, so a
          // child that dies early fails the await below instead of timing out.
          // (A no-op for whichever promise the output above already resolved.)
          exit() {
            const error = new Error(`child exited early, output so far: ${JSON.stringify(output)}`);
            (output.includes("---\n") ? trailer : separator).reject(error);
          },
        },
      });
      await using terminal = proc.terminal!;
      // Same values on Linux and macOS. Without these the typed input would be
      // echoed into `output` and the child's "\n" would come back as "\r\n".
      // The child has nothing to read yet, so nothing has been output either.
      const ECHO = 0x8;
      const OPOST = 0x1;
      terminal.localFlags &= ~ECHO;
      terminal.outputFlags &= ~OPOST;
      terminal.write("hi\n\x04");
      await separator.promise;
      terminal.write("more\n\x04");
      await trailer.promise;
      expect(output).toBe("hi\n---\nmore\nexit=0\n");
      expect(await proc.exited).toBe(0);
    });

    // The first cat fails its stdout write from inside the read that delivered
    // the chunk and unregisters itself. With captured output the rest of the
    // script runs before that read continues: the second cat attaches to it
    // (re-registering the poll that is being serviced) and is served by its
    // EOF; a third cat, started from the second one's EOF notification, is
    // served by the wakeup that re-registration produces; with a subprocess
    // after the second cat instead, that wakeup finds nobody to notify. With
    // stdout going through an IOWriter, `echo` completes later, so the read
    // reaches EOF with nobody listening and the second cat starts a new read.
    describe.if(isLinux)("first cat unregistering mid-read", () => {
      const first = "cat > /dev/full || echo first-failed";
      test.concurrent.each([
        [`${first}; cat && echo second-ok`, true, "first-failed\nsecond-ok\n"],
        [`${first}; cat && echo second-ok; cat && echo third-ok`, true, "first-failed\nsecond-ok\nthird-ok\n"],
        [`${first}; cat && echo second-ok; /bin/true`, true, "first-failed\nsecond-ok\n"],
        [`${first}; cat && echo second-ok`, false, "first-failed\nsecond-ok\n"],
      ])("%s (quiet: %p)", async (script, quiet, expected) => {
        const result = await runScript(script, { input: "hi\n" }, { quiet });
        expect(result).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
      });
    });
  });

  // Starting a new read after a failed one already worked everywhere (on
  // Windows too: a failed read leaves the fd open); what these pin down is that
  // its failure is reported to the second cat only.
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
