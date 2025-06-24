import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("napi", () => {
  beforeAll(() => {
    // build gyp
    console.time("Building node-gyp");
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (!install.success) {
      console.error("build failed, bailing out!");
      process.exit(1);
    }
    console.timeEnd("Building node-gyp");
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
        it(
          "should work with --compile",
          async () => {
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
            const tmpdir = tempDirWithFiles("should-be-empty-except", {});
            const result = spawnSync({
              cmd: [exe, "self"],
              env: { ...bunEnv, BUN_TMPDIR: tmpdir },
              stdin: "inherit",
              stderr: "inherit",
              stdout: "pipe",
            });
            const stdout = result.stdout.toString().trim();
            expect(stdout).toBe("hello world!");
            expect(result.success).toBeTrue();
            if (process.platform !== "win32") {
              expect(readdirSync(tmpdir), "bun should clean up .node files").toBeEmpty();
            } else {
              // On Windows, we have to mark it for deletion on reboot.
              // Not clear how to test for that.
            }
          },
          10 * 1000,
        );
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
    it("works", async () => {
      const args = [...Array(20).keys()];
      await checkSameOutput("test_issue_7685", args);
    });
  });

  describe("issue_11949", () => {
    it("napi_call_threadsafe_function should accept null", async () => {
      const result = await checkSameOutput("test_issue_11949", []);
      expect(result).toStartWith("data = 1234, context = 42");
    });
  });

  describe("napi_get_value_string_utf8 with buffer", () => {
    // see https://github.com/oven-sh/bun/issues/6949
    it("copies one char", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 2]);
      expect(result).toEndWith("str: a");
    });

    it("copies null terminator", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 1]);
      expect(result).toEndWith("str:");
    });

    it("copies zero char", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 0]);
      expect(result).toEndWith("str: *****************************");
    });

    it("copies more than given len", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 25]);
      expect(result).toEndWith("str: abcdef");
    });

    it("copies auto len", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 424242]);
      expect(result).toEndWith("str:");
    });
  });

  describe("napi_get_value_string_*", () => {
    it("behaves like node on edge cases", async () => {
      await checkSameOutput("test_get_value_string", []);
    });
  });

  it("#1288", async () => {
    const result = await checkSameOutput("self", []);
    expect(result).toBe("hello world!");
  });

  describe("handle_scope", () => {
    it("keeps strings alive", async () => {
      await checkSameOutput("test_napi_handle_scope_string", []);
    });
    it("keeps bigints alive", async () => {
      await checkSameOutput("test_napi_handle_scope_bigint", []);
    }, 10000);
    it("keeps the parent handle scope alive", async () => {
      await checkSameOutput("test_napi_handle_scope_nesting", []);
    });
    it("exists when calling a napi constructor", async () => {
      await checkSameOutput("test_napi_class_constructor_handle_scope", []);
    });
    it("exists while calling a napi_async_complete_callback", async () => {
      await checkSameOutput("create_promise", [false]);
    });
    it("keeps arguments moved off the stack alive", async () => {
      await checkSameOutput("test_napi_handle_scope_many_args", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    });
  });

  describe("escapable_handle_scope", () => {
    it("keeps the escaped value alive in the outer scope", async () => {
      await checkSameOutput("test_napi_escapable_handle_scope", []);
    });
  });

  describe("napi_delete_property", () => {
    it("returns a valid boolean", async () => {
      await checkSameOutput(
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
    it("can recover the value from a weak ref", async () => {
      await checkSameOutput("test_napi_ref", []);
    });
    it("allows creating a handle scope in the finalizer", async () => {
      await checkSameOutput("test_napi_handle_scope_finalizer", []);
    });
  });

  describe("napi_async_work", () => {
    it("null checks execute callbacks", async () => {
      const output = await checkSameOutput("test_napi_async_work_execute_null_check", []);
      expect(output).toContain("success!");
      expect(output).not.toContain("failure!");
    });
    it("null checks complete callbacks after scheduling", async () => {
      await checkSameOutput("test_napi_async_work_complete_null_check", []);
    });
    it("works with cancelation", async () => {
      const output = await checkSameOutput("test_napi_async_work_cancel", [], { "UV_THREADPOOL_SIZE": "2" });
      expect(output).toContain("success!");
      expect(output).not.toContain("failure!");
    });
  });

  describe("napi_threadsafe_function", () => {
    it("keeps the event loop alive without async_work", async () => {
      const result = await checkSameOutput("test_promise_with_threadsafe_function", []);
      expect(result).toContain("tsfn_callback");
      expect(result).toContain("resolved to 1234");
      expect(result).toContain("tsfn_finalize_callback");
    });

    it("does not hang on finalize", async () => {
      const result = await checkSameOutput("test_napi_threadsafe_function_does_not_hang_after_finalize", []);
      expect(result).toBe("success!");
    });
  });

  describe("exception handling", () => {
    it("can check for a pending error and catch the right value", async () => {
      await checkSameOutput("test_get_exception", [5]);
      await checkSameOutput("test_get_exception", [{ foo: "bar" }]);
    });
    it("can throw an exception from an async_complete_callback", async () => {
      const count = 10;
      await Promise.all(Array.from({ length: count }, () => checkSameOutput("create_promise", [true])));
    });
  });

  describe("napi_run_script", () => {
    it("evaluates a basic expression", async () => {
      await checkSameOutput("test_napi_run_script", ["5 * (1 + 2)"]);
    });
    it("provides the right this value", async () => {
      await checkSameOutput("test_napi_run_script", ["this === global"]);
    });
    it("propagates exceptions", async () => {
      await checkSameOutput("test_napi_run_script", ["(()=>{ throw new TypeError('oops'); })()"]);
    });
    it("cannot see locals from around its invocation", async () => {
      // variable should_not_exist is declared on main.js:18, but it should not be in scope for the eval'd code
      // this doesn't use await checkSameOutput because V8 and JSC use different error messages for a missing variable
      let bunResult = await runOn(bunExe(), "test_napi_run_script", ["shouldNotExist"]);
      // remove all debug logs
      bunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
      expect(bunResult).toBe(
        `synchronously threw ReferenceError: message "shouldNotExist is not defined", code undefined`,
      );
    });
  });

  describe("napi_get_named_property", () => {
    it("handles edge cases", async () => {
      await checkSameOutput("test_get_property", []);
    });
  });

  describe("napi_set_named_property", () => {
    it("handles edge cases", async () => {
      await checkSameOutput("test_set_property", []);
    });
  });

  describe("napi_value <=> integer conversion", () => {
    it("works", async () => {
      await checkSameOutput("test_number_integer_conversions_from_js", []);
      await checkSameOutput("test_number_integer_conversions", []);
    });
  });

  describe("arrays", () => {
    describe("napi_create_array_with_length", () => {
      it("creates an array with empty slots", async () => {
        await checkSameOutput("test_create_array_with_length", []);
      });
    });
  });

  describe("napi_throw functions", () => {
    it("has the right code and message", async () => {
      await checkSameOutput("test_throw_functions_exhaustive", []);
    });

    it("does not throw with nullptr", async () => {
      await checkSameOutput("test_napi_throw_with_nullptr", []);
    });
  });
  describe("napi_create_error functions", () => {
    it("has the right code and message", async () => {
      await checkSameOutput("test_create_error_functions_exhaustive", []);
    });
  });

  describe("napi_type_tag_object", () => {
    it("works", async () => {
      await checkSameOutput("test_type_tag", []);
    });
  });

  // TODO(@190n) test allocating in a finalizer from a napi module with the right version

  describe("napi_wrap", () => {
    it("accepts the right kinds of values", async () => {
      await checkSameOutput("test_napi_wrap", []);
    });

    it("is shared between addons", async () => {
      await checkSameOutput("test_napi_wrap_cross_addon", []);
    });

    it("does not follow prototypes", async () => {
      await checkSameOutput("test_napi_wrap_prototype", []);
    });

    it("does not consider proxies", async () => {
      await checkSameOutput("test_napi_wrap_proxy", []);
    });

    it("can remove a wrap", async () => {
      await checkSameOutput("test_napi_remove_wrap", []);
    });

    it("has the right lifetime", async () => {
      await checkSameOutput("test_wrap_lifetime_without_ref", []);
      await checkSameOutput("test_wrap_lifetime_with_weak_ref", []);
      await checkSameOutput("test_wrap_lifetime_with_strong_ref", []);
      await checkSameOutput("test_remove_wrap_lifetime_with_weak_ref", []);
      await checkSameOutput("test_remove_wrap_lifetime_with_strong_ref", []);
      // check that napi finalizers also run at VM exit, even if they didn't get run by GC
      await checkSameOutput("test_ref_deleted_in_cleanup", []);
      // check that calling napi_delete_ref in the ref's finalizer is not use-after-free
      await checkSameOutput("test_ref_deleted_in_async_finalize", []);
    });
  });

  describe("napi_define_class", () => {
    it("handles edge cases in the constructor", async () => {
      await checkSameOutput("test_napi_class", []);
      await checkSameOutput("test_subclass_napi_class", []);
      await checkSameOutput("test_napi_class_non_constructor_call", []);
      await checkSameOutput("test_reflect_construct_napi_class", []);
    });

    it("does not crash with Reflect.construct when newTarget has no prototype", async () => {
      await checkSameOutput("test_reflect_construct_no_prototype_crash", []);
    });
  });

  describe("bigint conversion to int64/uint64", () => {
    it("works", async () => {
      const tests = [-1n, 0n, 1n];
      for (const power of [63, 64, 65]) {
        for (const sign of [-1, 1]) {
          const boundary = BigInt(sign) * 2n ** BigInt(power);
          tests.push(boundary, boundary - 1n, boundary + 1n);
        }
      }

      const testsString = "[" + tests.map(bigint => bigint.toString() + "n").join(",") + "]";
      await checkSameOutput("bigint_to_i64", testsString);
      await checkSameOutput("bigint_to_u64", testsString);
    });
    it("returns the right error code", async () => {
      const badTypes = '[null, undefined, 5, "123", "abc"]';
      await checkSameOutput("bigint_to_i64", badTypes);
      await checkSameOutput("bigint_to_u64", badTypes);
      await checkSameOutput("bigint_to_64_null", []);
    });
  });

  describe("create_bigint_words", () => {
    it("works", async () => {
      await checkSameOutput("test_create_bigint_words", []);
    });
  });

  describe("napi_get_last_error_info", () => {
    it("returns information from the most recent call", async () => {
      await checkSameOutput("test_extended_error_messages", []);
    });
  });

  describe.each(["buffer", "typedarray"])("napi_is_%s", kind => {
    const tests: Array<[string, boolean]> = [
      ["new Uint8Array()", true],
      ["new BigUint64Array()", true],
      ["new ArrayBuffer()", false],
      ["Buffer.alloc(0)", true],
      ["new DataView(new ArrayBuffer())", kind == "buffer"],
      ["new (class Foo extends Uint8Array {})()", true],
      ["false", false],
      ["[1, 2, 3]", false],
      ["'hello'", false],
    ];
    it("returns consistent values with node.js", async () => {
      for (const [value, expected] of tests) {
        // main.js does eval then spread so to pass a single value we need to wrap in an array
        const output = await checkSameOutput(`test_is_${kind}`, "[" + value + "]");
        expect(output).toBe(`napi_is_${kind} -> ${expected.toString()}`);
      }
    });
  });

  it.each([
    ["nullptr", { number: 123 }],
    ["null", null],
    ["undefined", undefined],
  ])("works when the module register function returns %s", (returnKind, expected) => {
    expect(require(`./napi-app/build/Debug/${returnKind}_addon.node`)).toEqual(expected);
  });
  it("works when the module register function throws", async () => {
    expect(() => require("./napi-app/build/Debug/throw_addon.node")).toThrow(new Error("oops!"));
  });
});

async function checkSameOutput(test: string, args: any[] | string, envArgs: Record<string, string> = {}) {
  let [nodeResult, bunResult] = await Promise.all([
    runOn("node", test, args, envArgs),
    runOn(bunExe(), test, args, envArgs),
  ]);
  nodeResult = nodeResult.trim();
  // remove all debug logs
  bunResult = bunResult
    .replaceAll(/^\[\w+\].+$/gm, "")
    // TODO: we don't seem to print ProxyObject in this case.
    .replaceAll("function ProxyObject()", "function ()")
    .trim();
  expect(bunResult).toEqual(nodeResult);
  return nodeResult;
}

async function runOn(executable: string, test: string, args: any[] | string, envArgs: Record<string, string> = {}) {
  // when the inspector runs (can be due to VSCode extension), there is
  // a bug that in debug modes the console logs extra stuff
  const { BUN_INSPECT_CONNECT_TO: _, ...rest } = bunEnv;
  const env = { ...rest, ...envArgs };
  const exec = spawn({
    cmd: [
      executable,
      "--expose-gc",
      join(__dirname, "napi-app/main.js"),
      test,
      typeof args == "string" ? args : JSON.stringify(args),
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  const [stdout, stderr, result] = await Promise.all([
    new Response(exec.stdout).text(),
    new Response(exec.stderr).text(),
    exec.exited,
  ]);
  const errs = stderr.toString();
  if (errs !== "") {
    throw new Error(errs);
  }
  expect(result).toBe(0);
  return stdout;
}
