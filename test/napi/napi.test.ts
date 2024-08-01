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

  describe("v8 c++", () => {
    describe("Number", () => {
      it("can create small integer", () => {
        checkSameOutput("test_v8_number_int", []);
      });
      it("can create large integer", () => {
        checkSameOutput("test_v8_number_large_int", []);
      });
      it("can create fraction", () => {
        checkSameOutput("test_v8_number_fraction", []);
      });
    });
    describe("String", () => {
      it("can create and read back strings with only ASCII characters", () => {
        checkSameOutput("test_v8_string_ascii", []);
      });
    });
    describe("External", () => {
      it("can create an external and read back the correct value", () => {
        checkSameOutput("test_v8_external", []);
      });
    });
    describe("Object", () => {
      it("can create an object and set properties", () => {
        checkSameOutput("test_v8_object", []);
      });
    });
    describe("Array", () => {
      it("can create an array from a C array of Locals", () => {
        checkSameOutput("test_v8_array_new", []);
      });
    });
    describe("ObjectTemplate", () => {
      it("creates objects with internal fields", () => {
        checkSameOutput("test_v8_object_template", []);
      });
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

  it("threadsafe function does not hang on finalize", () => {
    const result = checkSameOutput("test_napi_threadsafe_function_does_not_hang_after_finalize", []);
    expect(result).toBe("success!");
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
