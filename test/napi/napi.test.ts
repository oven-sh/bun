import { spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

  it("threadsafe function does not hang on finalize", () => {
    const result = checkSameOutput("test_napi_threadsafe_function_does_not_hang_after_finalize", []);
    expect(result).toBe("success!");
  });

  it("#1288", async () => {
    const result = checkSameOutput("self", []);
    expect(result).toBe("hello world!");
  });

  describe("handle_scope", () => {
    it("keeps strings alive", () => {
      checkSameOutput("test_napi_handle_scope_string", []);
    });
    it("keeps bigints alive", () => {
      checkSameOutput("test_napi_handle_scope_bigint", []);
    }, 10000);
    it("keeps the parent handle scope alive", () => {
      checkSameOutput("test_napi_handle_scope_nesting", []);
    });
    it("exists when calling a napi constructor", () => {
      checkSameOutput("test_napi_class_constructor_handle_scope", []);
    });
    it("exists while calling a napi_async_complete_callback", () => {
      checkSameOutput("create_promise", []);
    });
  });

  describe("escapable_handle_scope", () => {
    it("keeps the escaped value alive in the outer scope", () => {
      checkSameOutput("test_napi_escapable_handle_scope", []);
    });
  });

  describe("napi_delete_property", () => {
    it("returns a valid boolean", () => {
      checkSameOutput(
        "test_napi_delete_property",
        // generate a string representing an array around an IIFE which main.js will eval
        // we do this as the napi_delete_property test needs an object with an own non-configurable
        // property
        "[(" +
          function () {
            const object = { foo: 42 };
            Object.defineProperty(object, "bar", {
              get() {
                return 1;
              },
              configurable: false,
            });
            return object;
          }.toString() +
          ")()]",
      );
    });
  });

  describe("napi_ref", () => {
    it("can recover the value from a weak ref", () => {
      checkSameOutput("test_napi_ref", []);
    });
  });
});

function checkSameOutput(test: string, args: any[] | string) {
  const nodeResult = runOn("node", test, args).trim();
  let bunResult = runOn(bunExe(), test, args);
  // remove all debug logs
  bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  expect(bunResult).toBe(nodeResult);
  return nodeResult;
}

function runOn(executable: string, test: string, args: any[] | string) {
  const exec = spawnSync({
    cmd: [executable, join(__dirname, "napi-app/main.js"), test, typeof args == "string" ? args : JSON.stringify(args)],
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success).toBeTrue();
  return exec.stdout.toString();
}
