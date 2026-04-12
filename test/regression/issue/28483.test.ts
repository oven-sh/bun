import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("data URL module imports", () => {
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

    expect(stderr).not.toContain("error:");
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

    expect(stderr).not.toContain("error:");
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

    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });

  test("percent-encoded data URL evaluates correctly", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const m = await import("data:text/javascript,export%20const%20x%20%3D%20%22hi%22");
console.log(m.x);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("hi\n");
    expect(exitCode).toBe(0);
  });

  test("base64 data URL evaluates correctly", async () => {
    const code = Buffer.from('export const x = "b64"').toString("base64");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const m = await import("data:text/javascript;base64,${code}");
console.log(m.x);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("b64\n");
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

    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("42\n");
    expect(exitCode).toBe(0);
  });

  test("uncaught error thrown inside data URL module reports correctly", async () => {
    // Exercises the .print_source exception-display path which re-reads the
    // data URL body. ASAN catches any use-after-free here.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `await import("data:text/javascript,throw new Error('boom-from-data-url')");`],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("boom-from-data-url");
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  });
}); // describe.concurrent
