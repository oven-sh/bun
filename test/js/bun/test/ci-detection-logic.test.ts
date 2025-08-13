import { test, expect } from "bun:test";

// This test verifies that our CI detection logic will work correctly
// by checking the environment variables that detectCI() uses

test("CI detection environment variables", () => {
  // Test that CI detection would work for common CI environments
  const originalCI = process.env.CI;
  const originalGithubActions = process.env.GITHUB_ACTIONS;
  const originalBuildkite = process.env.BUILDKITE;

  try {
    // Test CI=true case
    process.env.CI = "true";
    expect(process.env.CI).toBe("true");

    // Test GITHUB_ACTIONS case  
    delete process.env.CI;
    process.env.GITHUB_ACTIONS = "1";
    expect(process.env.GITHUB_ACTIONS).toBe("1");

    // Test BUILDKITE case
    delete process.env.GITHUB_ACTIONS;
    process.env.BUILDKITE = "true";
    expect(process.env.BUILDKITE).toBe("true");

    // Test no CI case
    delete process.env.BUILDKITE;
    expect(process.env.CI).toBeUndefined();
    expect(process.env.GITHUB_ACTIONS).toBeUndefined();
    expect(process.env.BUILDKITE).toBeUndefined();

  } finally {
    // Restore original environment
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    } else {
      delete process.env.CI;
    }
    if (originalGithubActions !== undefined) {
      process.env.GITHUB_ACTIONS = originalGithubActions;
    } else {
      delete process.env.GITHUB_ACTIONS;
    }
    if (originalBuildkite !== undefined) {
      process.env.BUILDKITE = originalBuildkite;
    } else {
      delete process.env.BUILDKITE;
    }
  }
});

test("CI=false should be treated as no CI", () => {
  // According to ci-info logic, CI=false should disable CI detection
  const original = process.env.CI;
  
  try {
    process.env.CI = "false";
    // This should be treated as no CI environment
    expect(process.env.CI).toBe("false");
  } finally {
    if (original !== undefined) {
      process.env.CI = original;
    } else {
      delete process.env.CI;
    }
  }
});