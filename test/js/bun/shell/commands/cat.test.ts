import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { closeSync, openSync } from "node:fs";

// On POSIX `cat` is the system binary unless this flag is set. On Windows the builtin is the default.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// Runs `script` in a child and returns its output, which ends with an `exit=<code>` line unless the child hung or crashed.
async function runScript(script: string, stdin: string | number, quiet: boolean) {
  const run = `Bun.$\`\${{ raw: ${JSON.stringify(script)} }}\`.nothrow()`;
  const trailer = `process.stdout.write("exit=" + r.exitCode + "\\n");`;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      quiet
        ? `const r = await ${run}.quiet(); process.stdout.write(r.stdout); ${trailer}`
        : `const r = await ${run}; ${trailer}`,
    ],
    env: builtinEnv,
    stdin: typeof stdin === "number" ? stdin : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (typeof stdin === "string") {
    proc.stdin!.write(stdin);
    proc.stdin!.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every `cat` reading the same stdin registers with one shared reader.
describe.concurrent("cat (builtin) sharing one stdin reader", () => {
  test.each([
    ["cat; echo ---; cat", "hi\n", true, "hi\n---\n"],
    // With inherited stdout, a command can also finish in a write callback after the EOF callback returned.
    ["cat; echo ---; cat", "hi\n", false, "hi\n---\n"],
    ["cat; cat; cat; cat; cat; cat; echo ---", "hi\n", true, "hi\n---\n"],
    // The subshell reuses the first cat's node id, so a stale listener would call into a node that isn't a cat.
    ["cat; (echo ---; cat)", "hi\n", true, "hi\n---\n"],
    ["echo hi | (cat; echo ---; cat)", "", true, "hi\n---\n"],
  ] as const)("a later cat reads EOF: %s (stdin %j, quiet %p)", async (script, input, quiet, expected) => {
    expect(await runScript(script, input, quiet)).toEqual({ stdout: `${expected}exit=0\n`, stderr: "", exitCode: 0 });
  });

  test("a later cat also fails after the first cat failed to read", async () => {
    // read() fails on a directory.
    const fd = openSync(import.meta.dir, "r");
    try {
      const script = "cat || echo first-failed; (echo ---; cat) || echo second-failed";
      expect(await runScript(script, fd, true)).toEqual({
        stdout: "first-failed\n---\nsecond-failed\nexit=0\n",
        stderr: "",
        exitCode: 0,
      });
    } finally {
      closeSync(fd);
    }
  });
});
