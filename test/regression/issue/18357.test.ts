import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("structuredClone() should not lose Error stack trace", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function okay() {
  const error = new Error("OKAY");
  console.error(error);
}

function broken() {
  const error = new Error("BROKEN");
  structuredClone(error);
  console.error(error);
}

function main() {
  okay();
  broken();
}

main();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Both errors should have full stack traces
  // The "okay" error should have the full stack
  expect(stderr).toContain("at okay");
  expect(stderr).toContain("at main");

  // The "broken" error should ALSO have the full stack after structuredClone
  const lines = stderr.split("\n");
  const brokenErrorIndex = lines.findIndex(line => line.includes("BROKEN"));
  expect(brokenErrorIndex).toBeGreaterThan(-1);

  // Find the stack trace lines after BROKEN
  const stackLinesAfterBroken = lines.slice(brokenErrorIndex);
  const stackTraceStr = stackLinesAfterBroken.join("\n");

  // Should have "at broken" in the stack
  expect(stackTraceStr).toContain("at broken");
  // Should also have "at main" in the stack (not just the first line)
  expect(stackTraceStr).toContain("at main");

  // CRITICAL: Should also have the top-level frame (the one that calls main())
  // This is the frame that was being lost after structuredClone
  // It appears as "at /path/to/file:line" without a function name
  // Count the number of "at " occurrences in the BROKEN error stack trace
  const brokenStackMatches = stackTraceStr.match(/\s+at\s+/g);
  const okayErrorIndex = lines.findIndex(line => line.includes("OKAY"));
  const okayStackLines = lines.slice(okayErrorIndex);
  const okayStackTraceStr = okayStackLines.slice(0, brokenErrorIndex - okayErrorIndex).join("\n");
  const okayStackMatches = okayStackTraceStr.match(/\s+at\s+/g);

  // Both errors should have the same number of stack frames (or at least 3)
  // Before the fix, BROKEN would only show 2 frames instead of 3+
  expect(brokenStackMatches?.length).toBeGreaterThanOrEqual(3);
  expect(okayStackMatches?.length).toBeGreaterThanOrEqual(3);

  expect(exitCode).toBe(0);
});

test("error.stack should remain intact after structuredClone", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function broken() {
  const error = new Error("BROKEN");
  structuredClone(error);
  console.log(error.stack);
}

broken();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  // The stack should contain both "at broken" and be properly formatted
  expect(stdout).toContain("Error: BROKEN");
  expect(stdout).toContain("at broken");

  expect(exitCode).toBe(0);
});
