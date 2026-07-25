import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/9162
describe("bun test forwards args after -- to process.argv", () => {
  const fixture = `
    import { test } from "bun:test";
    test("argv", () => {
      console.log("ARGV=" + JSON.stringify(process.argv.slice(2)));
    });
  `;

  test.concurrent("with a file filter before --", async () => {
    using dir = tempDir("issue-9162-a", { "argv.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "argv.test.ts", "--", "--graphql-path", "https://example.com/graphql", "--ssl"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`ARGV=["--graphql-path","https://example.com/graphql","--ssl"]`);
    expect(stderr).not.toContain("did not match any test files");
    expect(exitCode).toBe(0);
  });

  test.concurrent("with no filters before --", async () => {
    using dir = tempDir("issue-9162-b", { "argv.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--", "--foo", "bar"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`ARGV=["--foo","bar"]`);
    expect(stderr).not.toContain("did not match any test files");
    expect(exitCode).toBe(0);
  });

  test.concurrent("with a runtime flag after the filter", async () => {
    using dir = tempDir("issue-9162-c", { "argv.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "argv.test.ts", "--timeout=10000", "--", "positional", "-t", "notapattern"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`ARGV=["positional","-t","notapattern"]`);
    expect(stderr).toContain("(pass) argv");
    expect(exitCode).toBe(0);
  });

  test.concurrent("no -- leaves argv empty", async () => {
    using dir = tempDir("issue-9162-d", { "argv.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "argv.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`ARGV=[]`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("trailing -- with nothing after it", async () => {
    using dir = tempDir("issue-9162-e", { "argv.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "argv.test.ts", "--"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`ARGV=[]`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--parallel forwards -- args to workers", async () => {
    using dir = tempDir("issue-9162-f", {
      "a.test.ts": fixture,
      "b.test.ts": fixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--", "--flag", "value"],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = stdout + stderr;
    const matches = [...out.matchAll(/ARGV=(\[[^\]]*\])/g)].map(m => m[1]);
    expect(matches).toEqual([`["--flag","value"]`, `["--flag","value"]`]);
    expect(exitCode).toBe(0);
  });
});
