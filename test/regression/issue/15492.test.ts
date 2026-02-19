import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/15492
// Tagged template literal .raw strings should preserve non-ASCII Unicode
// characters instead of escaping them to \uXXXX sequences.
test("tagged template raw strings preserve non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `(function (s) {
  console.log(JSON.stringify(s.raw[0]));
  console.log(JSON.stringify(s[0]));
})\`\uFEFFtest\`;

console.log(JSON.stringify(\`\uFEFFtest\`));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stdout.trim().split("\n");
  // All three should be identical: raw, cooked, and regular template
  // The BOM character should be preserved as-is in raw strings, not escaped to \uFEFF
  const expected = JSON.stringify("\uFEFFtest");
  expect(lines[0]).toBe(expected); // raw
  expect(lines[1]).toBe(expected); // cooked
  expect(lines[2]).toBe(expected); // regular template
  expect(exitCode).toBe(0);
});
