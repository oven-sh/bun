import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";
import path from "path";

// This test verifies the fix for environment variable encoding issues on Windows
// where std.os.environ could potentially point to multibyte encoded data that
// wasn't properly decoded, leading to corrupted environment variable values.
//
// Before the fix: std.os.environ on Windows would return raw multibyte data
// After the fix: std.process.getEnvMap() properly handles cross-platform encoding
//
// For issue:https://github.com/oven-sh/bun/issues/17773
// PR: https://github.com/oven-sh/bun/pull/22114
describe("Windows environment variable encoding regression test", () => {
  test.if(isWindows)("correctly handles multibyte characters in environment variables", () => {
    // This test would fail before the fix because std.os.environ on Windows
    // could return multibyte encoded data that wasn't properly decoded
    const testVar = "MULTIBYTE_TEST";
    const testValue = "测试值_中文_🎉"; // Chinese characters + emoji

    const dir = tempDirWithFiles("env-encoding-regression", {
      "test.ts": `
                const value = process.env.${testVar};
                console.log("Value:", value);
                console.log("Correct:", value === "${testValue}");
                console.log("Length:", value?.length || 0);
            `,
    });

    const result = spawnSync({
      cmd: [bunExe(), path.join(dir, "test.ts")],
      env: {
        ...bunEnv,
        [testVar]: testValue,
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString("utf-8");

    // With the fix, these should work correctly
    expect(output).toContain(`Value: ${testValue}`);
    expect(output).toContain("Correct: true");
    expect(output).toContain(`Length: ${testValue.length}`);
  });

  test.if(isWindows)("handles various Unicode characters correctly", () => {
    // Test various Unicode categories that were problematic before the fix
    const testCases = [
      { name: "CHINESE", value: "中文测试" },
      { name: "JAPANESE", value: "日本語テスト" },
      { name: "KOREAN", value: "한글테스트" },
      { name: "EMOJI", value: "🎉✨🚀" },
      { name: "ACCENTED", value: "café résumé" },
      { name: "MIXED", value: "Test_测试_🎉_café" },
    ];

    const envVars: Record<string, string> = {};
    let testScript = "";

    for (const testCase of testCases) {
      envVars[testCase.name] = testCase.value;
      testScript += `console.log("${testCase.name}:", process.env.${testCase.name} === "${testCase.value}");\n`;
    }

    const dir = tempDirWithFiles("env-unicode-test", {
      "test.ts": testScript,
    });

    const result = spawnSync({
      cmd: [bunExe(), path.join(dir, "test.ts")],
      env: {
        ...bunEnv,
        ...envVars,
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString("utf-8");

    // All should be true with the fix
    for (const testCase of testCases) {
      expect(output).toContain(`${testCase.name}: true`);
    }
  });
});

// Ensure ASCII variables still work (they should work both before and after the fix)
describe("Environment variable compatibility", () => {
  test("ASCII environment variables work correctly", () => {
    const testVar = "ASCII_TEST";
    const testValue = "simple_ascii_123";

    const dir = tempDirWithFiles("env-ascii-test", {
      "test.ts": `console.log("Result:", process.env.${testVar} === "${testValue}");`,
    });

    const result = spawnSync({
      cmd: [bunExe(), path.join(dir, "test.ts")],
      env: {
        ...bunEnv,
        [testVar]: testValue,
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString("utf-8")).toContain("Result: true");
  });

  test.if(isWindows)("case insensitive behavior", () => {
    const testCases = [
      { name: "ASCII_TEST_VAR", mixedCase: "ascii_test_var", value: "ascii_value" },
      { name: "SIMPLE_VAR", mixedCase: "Simple_Var", value: "simple_value" },
      { name: "测试_VAR", mixedCase: "测试_var", value: "unicode_test1" },
      { name: "TEST_变量", mixedCase: "test_变量", value: "unicode_test2" },
      { name: "CAFÉ_VAR", mixedCase: "café_var", value: "unicode_test3" },
    ];

    let testScript = "";
    const envVars: Record<string, string> = {};

    for (const testCase of testCases) {
      // Set the environment variable with original case
      envVars[testCase.name] = testCase.value;

      // Test access with original case
      testScript += `console.log("${testCase.name}_original:", process.env["${testCase.name}"] === "${testCase.value}");\n`;

      // Test access with mixed case (should work for ASCII due to case insensitivity)
      testScript += `console.log("${testCase.name}_mixed:", process.env["${testCase.mixedCase}"] === "${testCase.value}");\n`;

      // Test that we can find the variable in Object.keys()
      testScript += `console.log("${testCase.name}_in_keys:", Object.keys(process.env).some(k => k === "${testCase.name}"));\n`;
    }

    const dir = tempDirWithFiles("env-case-test", {
      "test.ts": testScript,
    });

    const result = spawnSync({
      cmd: [bunExe(), path.join(dir, "test.ts")],
      env: {
        ...bunEnv,
        ...envVars,
      },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString("utf-8");

    expect(output).toContain("ASCII_TEST_VAR_original: true");
    expect(output).toContain("ASCII_TEST_VAR_mixed: true");
    expect(output).toContain("SIMPLE_VAR_original: true");
    expect(output).toContain("SIMPLE_VAR_mixed: true");

    expect(output).toContain("测试_VAR_original: true");
    expect(output).toContain("测试_VAR_mixed: true");
    expect(output).toContain("TEST_变量_original: true");
    expect(output).toContain("TEST_变量_mixed: true");
    expect(output).toContain("CAFÉ_VAR_original: true");
    expect(output).toContain("CAFÉ_VAR_mixed: true");

    expect(output).toContain("ASCII_TEST_VAR_in_keys: true");
    expect(output).toContain("SIMPLE_VAR_in_keys: true");
    expect(output).toContain("测试_VAR_in_keys: true");
    expect(output).toContain("TEST_变量_in_keys: true");
    expect(output).toContain("CAFÉ_VAR_in_keys: true");
  });
});
