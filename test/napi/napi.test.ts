import { it, expect, test, beforeAll, describe } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { spawnSync } from "bun";
import { join } from "path";

describe("napi", () => {
  beforeAll(() => {
    // build gyp
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) {
      throw new Error("build failed");
    }
  });
  describe("issue_7685", () => {
    it("works", () => {
      const args = [...Array(20).keys()];
      checkSameOutput("test_issue_7685", args);
    });
  });
  describe("issue_11949", () => {
    it("napi_call_threadsafe_function should accept null", () => {
      const result = checkSameOutput("test_issue_11949", []);
      expect(result).toStartWith("data: nullptr");
    });
  });

  describe("napi_get_value_string_utf8 with buffer", () => {
    // see https://github.com/oven-sh/bun/issues/6949
    it("copies one char", () => {
      const result = checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 2]);
      expect(result).toEndWith("str: a");
    });

    it("copies null terminator", () => {
      const result = checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 1]);
      expect(result).toEndWith("str:");
    });

    it("copies zero char", () => {
      const result = checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 0]);
      expect(result).toEndWith("str: *****************************");
    });

    it("copies more than given len", () => {
      const result = checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 25]);
      expect(result).toEndWith("str: abcdef");
    });

    it("copies auto len", () => {
      const result = checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 424242]);
      expect(result).toEndWith("str:");
    });
  });

  it("#1288", async () => {
    const result = checkSameOutput("self", []);
    expect(result).toBe("hello world!");
  });
});

function checkSameOutput(test: string, args: any[]) {
  const nodeResult = runOn("node", test, args).trim();
  let bunResult = runOn(bunExe(), test, args);
  // remove all debug logs
  bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  expect(bunResult).toBe(nodeResult);
  return nodeResult;
}

function runOn(executable: string, test: string, args: any[]) {
  const exec = spawnSync({
    cmd: [executable, join(__dirname, "napi-app/main.js"), test, JSON.stringify(args)],
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success).toBeTrue();
  return exec.stdout.toString();
}
