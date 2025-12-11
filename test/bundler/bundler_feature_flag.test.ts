import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bundler feature flags", () => {
  test("feature() returns true when flag is enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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

    // The output should contain `if (true)` since the feature is enabled
    expect(stdout).toContain("true");
    expect(stdout).not.toContain("feature(");
    expect(stdout).not.toContain("bun:bundle");
    expect(exitCode).toBe(0);
  });

  test("feature() returns false when flag is not enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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

    // The output should contain `if (false)` since the feature is not enabled
    expect(stdout).toContain("false");
    expect(stdout).not.toContain("feature(");
    expect(stdout).not.toContain("bun:bundle");
    expect(exitCode).toBe(0);
  });

  test("multiple feature flags can be enabled", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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

    // FLAG_A and FLAG_C are enabled, FLAG_B is not
    // The output should show the assignments
    expect(stdout).toContain("a = true");
    expect(stdout).toContain("b = false");
    expect(stdout).toContain("c = true");
    expect(exitCode).toBe(0);
  });

  test("dead code elimination works with feature flags", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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

    // With minification, dead code should be eliminated
    expect(stdout).toContain("this should be kept");
    expect(stdout).not.toContain("this should be removed");
    expect(exitCode).toBe(0);
  });

  test("feature() with non-string argument produces error", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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
    expect(exitCode).not.toBe(0);
  });

  test("feature() with no arguments produces error", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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
    expect(exitCode).not.toBe(0);
  });

  test("bun:bundle import is removed from output", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

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

    // The import should be completely removed
    expect(stdout).not.toContain("bun:bundle");
    expect(stdout).not.toContain("import");
    expect(exitCode).toBe(0);
  });

  test("dead code elimination removes entire if block when condition is false", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

function expensiveComputation() {
  return "expensive result";
}

if (feature("DISABLED")) {
  const result = expensiveComputation();
  console.log("This entire block should be removed:", result);
}

console.log("This should remain");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "./index.ts"],
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

    // The expensive computation and related code should be completely eliminated
    expect(stdout).not.toContain("expensiveComputation");
    expect(stdout).not.toContain("expensive result");
    expect(stdout).not.toContain("This entire block should be removed");
    expect(stdout).toContain("This should remain");
    expect(exitCode).toBe(0);
  });

  test("dead code elimination keeps else branch when condition is false", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

if (feature("DISABLED")) {
  console.log("if branch - should be removed");
} else {
  console.log("else branch - should be kept");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "./index.ts"],
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

    expect(stdout).not.toContain("if branch - should be removed");
    expect(stdout).toContain("else branch - should be kept");
    expect(exitCode).toBe(0);
  });

  test("dead code elimination removes else branch when condition is true", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

if (feature("ENABLED")) {
  console.log("if branch - should be kept");
} else {
  console.log("else branch - should be removed");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "--feature=ENABLED", "./index.ts"],
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

    expect(stdout).toContain("if branch - should be kept");
    expect(stdout).not.toContain("else branch - should be removed");
    expect(exitCode).toBe(0);
  });

  test("works correctly at runtime with bun run", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

if (feature("RUNTIME_FLAG")) {
  console.log("runtime flag enabled");
} else {
  console.log("runtime flag disabled");
}
`,
    });

    // First, test without the flag
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "run", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([
      new Response(proc1.stdout).text(),
      new Response(proc1.stderr).text(),
      proc1.exited,
    ]);

    expect(stdout1.trim()).toBe("runtime flag disabled");
    expect(exitCode1).toBe(0);

    // Now test with the flag enabled
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "run", "--feature=RUNTIME_FLAG", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([
      new Response(proc2.stdout).text(),
      new Response(proc2.stderr).text(),
      proc2.exited,
    ]);

    expect(stdout2.trim()).toBe("runtime flag enabled");
    expect(exitCode2).toBe(0);
  });

  test("works correctly in bun test", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "test.test.ts": `
import { test, expect } from "bun:test";
import { feature } from "bun:bundle";

test("feature flag in test", () => {
  if (feature("TEST_FLAG")) {
    console.log("TEST_FLAG_ENABLED");
  } else {
    console.log("TEST_FLAG_DISABLED");
  }
  expect(true).toBe(true);
});
`,
    });

    // First, test without the flag
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "test", "./test.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([
      new Response(proc1.stdout).text(),
      new Response(proc1.stderr).text(),
      proc1.exited,
    ]);

    expect(stdout1).toContain("TEST_FLAG_DISABLED");
    expect(stdout1).not.toContain("TEST_FLAG_ENABLED");
    expect(exitCode1).toBe(0);

    // Now test with the flag enabled
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "test", "--feature=TEST_FLAG", "./test.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([
      new Response(proc2.stdout).text(),
      new Response(proc2.stderr).text(),
      proc2.exited,
    ]);

    expect(stdout2).toContain("TEST_FLAG_ENABLED");
    expect(stdout2).not.toContain("TEST_FLAG_DISABLED");
    expect(exitCode2).toBe(0);
  });

  test("feature flag with aliased import works", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature as checkFeature } from "bun:bundle";

if (checkFeature("ALIASED")) {
  console.log("aliased feature enabled");
} else {
  console.log("aliased feature disabled");
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--feature=ALIASED", "./index.ts"],
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

    expect(stdout).toContain("true");
    expect(stdout).not.toContain("checkFeature");
    expect(exitCode).toBe(0);
  });

  test("ternary operator dead code elimination", async () => {
    using dir = tempDir("bundler-feature-flag", {
      "index.ts": `
import { feature } from "bun:bundle";

const result = feature("TERNARY_FLAG") ? "ternary_enabled" : "ternary_disabled";
console.log(result);
`,
    });

    // Without the flag
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, , exitCode1] = await Promise.all([
      new Response(proc1.stdout).text(),
      new Response(proc1.stderr).text(),
      proc1.exited,
    ]);

    expect(stdout1).toContain("ternary_disabled");
    expect(stdout1).not.toContain("ternary_enabled");
    expect(exitCode1).toBe(0);

    // With the flag
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", "--feature=TERNARY_FLAG", "./index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, , exitCode2] = await Promise.all([
      new Response(proc2.stdout).text(),
      new Response(proc2.stderr).text(),
      proc2.exited,
    ]);

    expect(stdout2).toContain("ternary_enabled");
    expect(stdout2).not.toContain("ternary_disabled");
    expect(exitCode2).toBe(0);
  });
});
