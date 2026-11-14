import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

async function builtInsThatEscape(text: string) {
  using dir = tempDir("aot-the-reason-of-a-signal", { "main.ts": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  return stderr.split("\n").filter(line => line.includes("(escapes, ")).length;
}

describe.concurrent("a read of the reason of a signal", () => {
  test.each([
    ["of a signal that nobody has aborted", `console.log(String(new AbortController().signal.reason === undefined));`],
    [
      "of what the program handed in",
      `const controller = new AbortController();\ncontroller.abort("a text");\nconsole.log(String(controller.signal.reason));`,
    ],
    [
      "of the exception that native code makes",
      `const controller = new AbortController();\ncontroller.abort();\nconsole.log(controller.signal.reason.name);`,
    ],
  ])("%s", async (_, text) => {
    expect(await builtInsThatEscape(text)).toBeLessThan(100);
  });
});
