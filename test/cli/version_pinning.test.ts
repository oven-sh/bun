import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Sequential: each test spawns a bun subprocess; under ASAN these are too
// heavy (~1s each) to run concurrently without exhausting resources.
describe("version pinning via bunfig.toml", () => {
  // Note: version pinning works for commands that auto-load bunfig.toml.
  // `bun <file>` (AutoCommand) auto-loads bunfig.toml when the file has
  // a recognized extension. We use `bun index.ts` in all tests.

  test("matching version constraint does not produce warnings", async () => {
    const ver = Bun.version.replace("-debug", "");
    using dir = tempDir("version-pin", {
      "bunfig.toml": `version = ">=${ver}"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("exact matching version does not warn", async () => {
    const ver = Bun.version.replace("-debug", "");
    using dir = tempDir("version-pin-exact", {
      "bunfig.toml": `version = "${ver}"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("caret range matching current version does not warn", async () => {
    const ver = Bun.version.replace("-debug", "");
    using dir = tempDir("version-pin-caret", {
      "bunfig.toml": `version = "^${ver}"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("mismatched version prints warning in non-TTY", async () => {
    using dir = tempDir("version-pin-mismatch", {
      "bunfig.toml": `version = "0.0.1"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should warn about version mismatch but still run
    expect(stderr).toContain("requires Bun");
    expect(stderr).toContain("0.0.1");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("mismatched range version prints warning", async () => {
    using dir = tempDir("version-pin-range-mismatch", {
      "bunfig.toml": `version = "~0.0.1"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toContain("requires Bun");
    expect(stderr).toContain("~0.0.1");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("wildcard version always matches", async () => {
    using dir = tempDir("version-pin-wildcard", {
      "bunfig.toml": `version = "*"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("tilde range matching current major.minor does not warn", async () => {
    const ver = Bun.version.replace("-debug", "");
    const parts = ver.split(".");
    const tildeVer = `${parts[0]}.${parts[1]}.0`;
    using dir = tempDir("version-pin-tilde", {
      "bunfig.toml": `version = "~${tildeVer}"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("no bunfig version field means no version check", async () => {
    using dir = tempDir("version-pin-none", {
      "bunfig.toml": `logLevel = "warn"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("requires Bun");
    expect(exitCode).toBe(0);
  });

  test("invalid semver version field emits warning", async () => {
    using dir = tempDir("version-pin-invalid", {
      "bunfig.toml": `version = "latest"`,
      "index.ts": `console.log("ok")`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toContain("Invalid version range");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
