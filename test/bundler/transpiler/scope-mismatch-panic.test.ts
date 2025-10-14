import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("scope mismatch panic regression test", () => {
  test("should not panic with scope mismatch when arrow function is followed by array literal", async () => {
    // This test reproduces the exact panic that was fixed
    // The bug caused: "panic(main thread): Scope mismatch while visiting"

    using dir = tempDir("scope-mismatch", {
      "index.tsx": `
const Layout = () => {
  return (
    <html>
    </html>
  )
}

['1', 'p'].forEach(i =>
  app.get(\`/\${i === 'home' ? '' : i}\`, c => c.html(
    <Layout selected={i}>
      Hello {i}
    </Layout>
  ))
)`,
    });

    // With the bug, this would panic with "Scope mismatch while visiting"
    // With the fix, it should fail with a normal ReferenceError for 'app'
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.tsx"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The key assertion: should NOT panic with scope mismatch
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");

    // Should fail with a normal error instead (ReferenceError for undefined 'app')
    expect(stderr).toContain("ReferenceError");
    expect(stderr).toContain("app is not defined");
    expect(exitCode).not.toBe(0);
  });

  test("should not panic with simpler arrow function followed by array", async () => {
    using dir = tempDir("scope-mismatch-simple", {
      "test.js": `
const fn = () => {
  return 1
}
['a', 'b'].forEach(x => console.log(x))`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not panic
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");

    // Should successfully execute
    expect(stdout).toBe("a\nb\n");
    expect(exitCode).toBe(0);
  });

  test("correctly rejects direct indexing into block body arrow function", async () => {
    using dir = tempDir("scope-mismatch-reject", {
      "test.js": `const fn = () => {return 1}['x']`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should fail with a parse error, not a panic
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Scope mismatch");
    expect(stderr).toContain("error"); // Parse error or similar
    expect(exitCode).not.toBe(0);
  });
});
