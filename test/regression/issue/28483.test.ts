import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("data URL with nested imports propagates errors", async () => {
  using dir = tempDir("28483", {
    "main.mjs": `
process.on('uncaughtException', () => console.log('uncaught'));

try {
  await import(\`data:text/javascript,
        import "data:text/javascript,console.log('before')";
        import "\${import.meta.url}.cjs";
    \`);
} catch {
  console.log('caught');
}
`,
    "main.mjs.cjs": `throw Error('abc');`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("before\ncaught\n");
  expect(exitCode).toBe(0);
});

test("data URL with nested data URL import executes code", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const m = await import("data:text/javascript,import 'data:text/javascript,console.log(1)'; export const x = 2;");
console.log(m.x);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("1\n2\n");
  expect(exitCode).toBe(0);
});

test("data URL with dots in code evaluates correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const m = await import("data:text/javascript,export default Math.floor(1.5)");
console.log(m.default);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});

test("simple data URL import still works", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const m = await import("data:text/javascript,export const x = 42");
console.log(m.x);`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});
