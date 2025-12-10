import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bundler feature flags", () => {
  test("feature() returns true when flag is enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

if (feature("SUPER_SECRET")) {
  console.log("feature enabled");
} else {
  console.log("feature disabled");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--feature=SUPER_SECRET", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // The output should contain `if (true)` since the feature is enabled
    expect(stdout).toContain("true");
    expect(stdout).not.toContain("feature(");
    expect(stdout).not.toContain("bun:bundler");
  });

  test("feature() returns false when flag is not enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

if (feature("SUPER_SECRET")) {
  console.log("feature enabled");
} else {
  console.log("feature disabled");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // The output should contain `if (false)` since the feature is not enabled
    expect(stdout).toContain("false");
    expect(stdout).not.toContain("feature(");
    expect(stdout).not.toContain("bun:bundler");
  });

  test("multiple feature flags can be enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

const a = feature("FLAG_A");
const b = feature("FLAG_B");
const c = feature("FLAG_C");

console.log(a, b, c);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--feature=FLAG_A", "--feature=FLAG_C", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // FLAG_A and FLAG_C are enabled, FLAG_B is not
    // The output should show the assignments
    expect(stdout).toContain("a = true");
    expect(stdout).toContain("b = false");
    expect(stdout).toContain("c = true");
  });

  test("dead code elimination works with feature flags", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

if (feature("ENABLED_FEATURE")) {
  console.log("this should be kept");
}

if (feature("DISABLED_FEATURE")) {
  console.log("this should be removed");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "--feature=ENABLED_FEATURE", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // With minification, dead code should be eliminated
    expect(stdout).toContain("this should be kept");
    expect(stdout).not.toContain("this should be removed");
  });

  test("feature() with non-string argument produces error", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

const flag = "DYNAMIC";
if (feature(flag)) {
  console.log("dynamic");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should produce an error about string literal requirement
    expect(stderr).toContain("string literal");
  });

  test("feature() with no arguments produces error", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

if (feature()) {
  console.log("no args");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should produce an error about argument requirement
    expect(stderr).toContain("one string argument");
  });

  test("bun:bundler import is removed from output", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundler";

const x = feature("TEST");
console.log(x);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // The import should be completely removed
    expect(stdout).not.toContain("bun:bundler");
    expect(stdout).not.toContain("import");
  });
});
