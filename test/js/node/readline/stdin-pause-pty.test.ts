import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// run-with-pty.py stops the scenario after this many seconds and prints how far it came. The scenario starts the
// runtime three times, and a debug build needs about 1 s for each start.
const scenarioSeconds = isDebug ? 30 : 3;
// Longer than the scenario: a scenario that hangs then fails with its output and not with a bare timeout. Every other
// build keeps the default.
const timeout = isDebug ? (scenarioSeconds + 10) * 1000 : undefined;

test.skipIf(isWindows)("stdin pause should stop reading so child can read from stdin", { timeout }, async () => {
  const script = join(__dirname, "stdin-pause-child-reads.mjs");
  const pty = join(__dirname, "run-with-pty.py");
  const runtime = process.env.TEST_RUNTIME || bunExe();

  await using proc = Bun.spawn({
    cmd: [Bun.which("python3") ?? Bun.which("python") ?? "python", pty, String(scenarioSeconds), runtime, script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lfilter = (l: string): boolean => {
    if (!l) return false;
    if (l.startsWith("%ready%")) return false;
    if (l.startsWith("PYTHON:")) return false;
    return true;
  };
  expect(
    stdout
      .trim()
      .split("\n")
      .map(l => l.trim())
      .filter(lfilter),
  ).toMatchInlineSnapshot(`
    [
      "PARENT: reading",
      "PARENT: received "1"",
      "PARENT: received "2"",
      "PARENT: received "3"",
      "PARENT: received "\\r\\n"",
      "PARENT: pause",
      "CHILD: reading",
      "CHILD: received "A"",
      "CHILD: received "B"",
      "CHILD: received "C"",
      "CHILD: received "D"",
      "CHILD: received "E"",
      "CHILD: received "F"",
      "CHILD: received "G"",
      "CHILD: received "\\r\\n"",
      "CHILD: exiting",
      "PARENT: child exited with code 0. reading again.",
      "PARENT: received "4"",
      "PARENT: received "5"",
      "PARENT: received "6"",
      "PARENT: received "\\r\\n"",
      "PARENT: pause",
      "CHILD: reading",
      "CHILD: received "H"",
      "CHILD: received "I"",
      "CHILD: received "J"",
      "CHILD: received "K"",
      "CHILD: received "L"",
      "CHILD: received "M"",
      "CHILD: received "N"",
      "CHILD: received "O"",
      "CHILD: received "P"",
      "CHILD: received "\\r\\n"",
      "CHILD: exiting",
      "PARENT: child exited with code 0. reading again.",
      "PARENT: received "\\u0003"",
      "PARENT: exiting.",
    ]
  `);
  expect(exitCode).toBe(0);
});
