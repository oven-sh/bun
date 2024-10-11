import { spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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

  describe.each(["esm", "cjs"])("bundle .node files to %s via", format => {
    describe.each(["node", "bun"])("target %s", target => {
      it("Bun.build", async () => {
        const dir = tempDirWithFiles("node-file-cli", {
          "package.json": JSON.stringify({
            name: "napi-app",
            version: "1.0.0",
            type: format === "esm" ? "module" : "commonjs",
          }),
        });
        const build = spawnSync({
          cmd: [
            bunExe(),
            "build",
            "--target",
            target,
            "--outdir",
            dir,
            "--format=" + format,
            join(__dirname, "napi-app/main.js"),
          ],
          cwd: join(__dirname, "napi-app"),
          env: bunEnv,
          stdout: "inherit",
          stderr: "inherit",
        });
        expect(build.success).toBeTrue();

        for (let exec of target === "bun" ? [bunExe()] : [bunExe(), "node"]) {
          const result = spawnSync({
            cmd: [exec, join(dir, "main.js"), "self"],
            env: bunEnv,
            stdin: "inherit",
            stderr: "inherit",
            stdout: "pipe",
          });
          const stdout = result.stdout.toString().trim();
          expect(stdout).toBe("hello world!");
          expect(result.success).toBeTrue();
        }
      });

      if (target === "bun") {
        it("should work with --compile", async () => {
          const dir = tempDirWithFiles("napi-app-compile-" + format, {
            "package.json": JSON.stringify({
              name: "napi-app",
              version: "1.0.0",
              type: format === "esm" ? "module" : "commonjs",
            }),
          });

          const exe = join(dir, "main" + (process.platform === "win32" ? ".exe" : ""));
          const build = spawnSync({
            cmd: [
              bunExe(),
              "build",
              "--target=" + target,
              "--format=" + format,
              "--compile",
              join(__dirname, "napi-app", "main.js"),
            ],
            cwd: dir,
            env: bunEnv,
            stdout: "inherit",
            stderr: "inherit",
          });
          expect(build.success).toBeTrue();

          const result = spawnSync({
            cmd: [exe, "self"],
            env: bunEnv,
            stdin: "inherit",
            stderr: "inherit",
            stdout: "pipe",
          });
          const stdout = result.stdout.toString().trim();

          expect(stdout).toBe("hello world!");
          expect(result.success).toBeTrue();
        });
      }

      it("`bun build`", async () => {
        const dir = tempDirWithFiles("node-file-build", {
          "package.json": JSON.stringify({
            name: "napi-app",
            version: "1.0.0",
            type: format === "esm" ? "module" : "commonjs",
          }),
        });
        const build = await Bun.build({
          entrypoints: [join(__dirname, "napi-app/main.js")],
          outdir: dir,
          target,
          format,
        });

        expect(build.logs).toBeEmpty();

        for (let exec of target === "bun" ? [bunExe()] : [bunExe(), "node"]) {
          const result = spawnSync({
            cmd: [exec, join(dir, "main.js"), "self"],
            env: bunEnv,
            stdin: "inherit",
            stderr: "inherit",
            stdout: "pipe",
          });
          const stdout = result.stdout.toString().trim();

          expect(stdout).toBe("hello world!");
          expect(result.success).toBeTrue();
        }
      });
    });
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
      checkSameOutput("create_promise", [false]);
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
    it("allows creating a handle scope in the finalizer", () => {
      checkSameOutput("test_napi_handle_scope_finalizer", []);
    });
  });

  describe("napi_threadsafe_function", () => {
    it("keeps the event loop alive without async_work", () => {
      checkSameOutput("test_promise_with_threadsafe_function", []);
    });

    it("does not hang on finalize", () => {
      const result = checkSameOutput("test_napi_threadsafe_function_does_not_hang_after_finalize", []);
      expect(result).toBe("success!");
    });
  });

  describe("exception handling", () => {
    it("can check for a pending error and catch the right value", () => {
      checkSameOutput("test_get_exception", [5]);
      checkSameOutput("test_get_exception", [{ foo: "bar" }]);
    });
    it("can throw an exception from an async_complete_callback", () => {
      checkSameOutput("create_promise", [true]);
    });
  });

  describe("napi_run_script", () => {
    it("evaluates a basic expression", () => {
      checkSameOutput("eval_wrapper", ["5 * (1 + 2)"]);
    });
    it("provides the right this value", () => {
      checkSameOutput("eval_wrapper", ["this === global"]);
    });
    it("propagates exceptions", () => {
      checkSameOutput("eval_wrapper", ["(()=>{ throw new TypeError('oops'); })()"]);
    });
    it("cannot see locals from around its invocation", () => {
      // variable should_not_exist is declared on main.js:18, but it should not be in scope for the eval'd code
      // this doesn't use checkSameOutput because V8 and JSC use different error messages for a missing variable
      let bunResult = runOn(bunExe(), "eval_wrapper", ["shouldNotExist"]);
      // remove all debug logs
      bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
      expect(bunResult).toBe(
        `synchronously threw ReferenceError: message "Can't find variable: shouldNotExist", code undefined`,
      );
    });
  });

  describe("napi_get_named_property", () => {
    it("handles edge cases", () => {
      checkSameOutput("test_get_property", []);
    });
  });

  describe("napi_value <=> integer conversion", () => {
    it("works", () => {
      checkSameOutput("test_number_integer_conversions_from_js", []);
      checkSameOutput("test_number_integer_conversions", []);
    });
  });

  describe("arrays", () => {
    describe("napi_create_array_with_length", () => {
      it("creates an array with empty slots", () => {
        checkSameOutput("test_create_array_with_length", []);
      });
    });
  });

  describe("napi_throw functions", () => {
    it("has the right code and message", () => {
      checkSameOutput("test_throw_functions_exhaustive", []);
    });
  });
  describe("napi_create_error functions", () => {
    it("has the right code and message", () => {
      checkSameOutput("test_create_error_functions_exhaustive", []);
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
    cmd: [
      executable,
      "--expose-gc",
      join(__dirname, "napi-app/main.js"),
      test,
      typeof args == "string" ? args : JSON.stringify(args),
    ],
    env: bunEnv,
  });
  const errs = exec.stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(exec.success).toBeTrue();
  return exec.stdout.toString();
}
