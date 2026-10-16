// Runs run-test-file.js for one test in a process of its own and returns what it printed.
import { join } from "node:path";
import { resultPrefix } from "./test-files.js";

// testharness.js gives up after 10 s, or 60 s with `timeout=long`, and still reports each subtest. This limit is for a process that hangs.
const processTimeout = 75_000;

export async function runTestFile({ bun = process.execPath, env = process.env, wptDirectory, path, timeoutMultiplier = 1 }) {
  const child = Bun.spawn({
    cmd: [
      bun,
      "--expose-internals",
      join(import.meta.dir, "run-test-file.js"),
      wptDirectory,
      path,
      `--timeout-multiplier=${timeoutMultiplier}`,
    ],
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: processTimeout * timeoutMultiplier,
    killSignal: "SIGKILL",
  });
  const [output, errors] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const line = output.split("\n").findLast(line => line.startsWith(resultPrefix));
  if (line) return JSON.parse(line.slice(resultPrefix.length));
  const status = child.signalCode === "SIGKILL" ? "HANG" : child.signalCode ? "CRASH" : "EXITED";
  const cause = /^(?:panic|ASSERTION FAILED|error|\w*Error).*$/m.exec(errors)?.[0] ?? errors.slice(0, 200);
  return { test: path, status, message: `exit ${child.exitCode ?? child.signalCode}: ${cause}`, subtests: [] };
}
