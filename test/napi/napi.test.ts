import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, isCI, isMacOS, isMusl, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

describe.concurrent("napi", () => {
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

    // TODO: once we upgrade the Node version on macOS and musl to Node v24.3.0, remove this TODO
    it.todoIf(isCI && (isMacOS || isMusl))("copies auto len", async () => {
      const result = await checkSameOutput("test_napi_get_value_string_utf8_with_buffer", ["abcdef", 424242]);
      expect(result).toEndWith("str: abcdef");
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
    it("prevents underflow when unref called on zero refcount", async () => {
      // This tests the fix for napi_reference_unref underflow protection
      await checkSameOutput("test_ref_unref_underflow", []);
    });
  });

  describe("napi_create_external_buffer", () => {
    it("handles empty/null data without throwing", async () => {
      const result = await checkSameOutput("test_napi_create_external_buffer_empty", []);
      expect(result).toContain("PASS: napi_create_external_buffer with nullptr and zero length");
      expect(result).toContain("PASS: napi_create_external_buffer with non-null data and zero length");
      expect(result).toContain("PASS: napi_create_external_buffer with nullptr finalizer");
      expect(result).not.toContain("FAIL");
    });

    it("finalize_cb is tied to the ArrayBuffer lifetime, not the Buffer view", async () => {
      const result = await checkSameOutput("test_external_buffer_data_lifetime", []);
      expect(result).toContain("PASS: external buffer data intact through ArrayBuffer after GC");
      expect(result).not.toContain("FAIL");
    });

    it("empty buffer returns null pointer and 0 length from napi_get_buffer_info and napi_get_typedarray_info", async () => {
      const result = await checkSameOutput("test_napi_empty_buffer_info", []);
      expect(result).toContain("PASS: napi_get_buffer_info returns null pointer and 0 length for empty buffer");
      expect(result).toContain("PASS: napi_get_typedarray_info returns null pointer and 0 length for empty buffer");
      expect(result).toContain("PASS: napi_is_detached_arraybuffer returns true for empty buffer's arraybuffer");
      expect(result).not.toContain("FAIL");
    });
  });

  describe("napi_async_work", () => {
    it("null checks execute callbacks", async () => {
      const output = await checkSameOutput("test_napi_async_work_execute_null_check", []);
      expect(output).toContain("success!");
      expect(output).not.toContain("failure!");
    });
    it("null checks complete callbacks after scheduling", async () => {
      // This test verifies that async work can be created with a null complete callback.
      // The output order can vary due to thread scheduling on Linux, so we normalize
      // the output lines before comparing.
      const [nodeResult, bunResult] = await Promise.all([
        runOn("node", "test_napi_async_work_complete_null_check", []),
        runOn(bunExe(), "test_napi_async_work_complete_null_check", []),
      ]);

      // Filter out debug logs and normalize
      const cleanBunResult = bunResult.replaceAll(/^\[\w+\].+$/gm, "").trim();

      // Both should contain these two lines, but order may vary
      const expectedLines = ["execute called!", "resolved to undefined"];

      const nodeLines = nodeResult
        .trim()
        .split("\n")
        .filter(line => line)
        .sort();
      const bunLines = cleanBunResult
        .split("\n")
        .filter(line => line)
        .sort();

      expect(bunLines).toEqual(nodeLines);
      expect(bunLines).toEqual(expectedLines.sort());
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

    it("returns correct word count with small buffer", async () => {
      // This tests the fix for the BigInt word count bug
      // When buffer is smaller than needed, word_count should still return actual words needed
      await checkSameOutput("test_bigint_word_count", []);
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

  it("runs the napi_module_register callback after dlopen finishes", async () => {
    await checkSameOutput("test_constructor_order", []);
  });

  it("behaves as expected when performing operations with an exception pending", async () => {
    await checkSameOutput("test_deferred_exceptions", []);
  });

  it("behaves as expected when performing operations with numeric string keys", async () => {
    await checkSameOutput("test_napi_numeric_string_keys", []);
  });

  it("napi_get_named_property copies utf8 string data", async () => {
    // Must spawn bun directly (not via checkSameOutput/main.js) because the
    // bug only reproduces when global property names like "Response" haven't
    // been pre-atomized. Loading through main.js → module.js pre-initializes
    // globals, masking the use-after-free in the atom string table.
    const addonPath = join(__dirname, "napi-app", "build", "Debug", "napitests.node");
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const addon = require(${JSON.stringify(addonPath)}); addon.test_napi_get_named_property_copied_string(() => { Bun.gc(true); });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(stdout).toInclude("PASS");
    expect(exitCode).toBe(0);
  });

  it("behaves as expected when performing operations with default values", async () => {
    await checkSameOutput("test_napi_get_default_values", []);
  });

  it("NAPI finalizer iterator invalidation crash prevention", () => {
    // This test verifies that the DeferGCForAWhile fix prevents iterator invalidation
    // during NAPI finalizer cleanup. While we couldn't reproduce the exact crash
    // conditions, this test ensures the addon loads and runs without issues.

    const addon = require("./napi-app/build/Debug/test_finalizer_iterator_invalidation.node");

    // Create objects with finalizers (should not crash)
    const objects = addon.createProblematicObjects(5);
    expect(objects).toHaveLength(5);

    // Clear references
    objects.length = 0;

    // Get initial count
    const count = addon.getFinalizeCount();
    expect(typeof count).toBe("number");
  });

  it("napi_reference_unref can be called from finalizers in regular modules", async () => {
    // This test ensures that napi_reference_unref can be called during GC
    // without triggering the NAPI_CHECK_ENV_NOT_IN_GC assertion for regular modules.
    // This was causing crashes with packages like rolldown-vite when used with Nuxt.
    // See: https://github.com/oven-sh/bun/issues/22596
    const result = await checkSameOutput("test_reference_unref_in_finalizer", []);
    expect(result).toContain("Created 100 objects with finalizers");
    expect(result).toContain("Finalizers called:");
    expect(result).toContain("Unrefs succeeded:");
    expect(result).toContain("SUCCESS: napi_reference_unref worked in finalizers without crashing");
    expect(result).toContain("Test completed:");
  }, 10_000);

  it.todoIf(
    // The test does not properly avoid the non-zero exit code on Windows.
    isWindows,
  )(
    "napi_reference_unref is blocked from finalizers in experimental modules",
    async () => {
      // Experimental NAPI modules should NOT be able to call napi_reference_unref from finalizers
      // The process should crash/abort when this is attempted
      // This matches Node.js behavior for experimental modules

      // Note: Node.js may not enforce this check for manually-registered experimental modules
      // (ones that set nm_version to NAPI_VERSION_EXPERIMENTAL manually)
      // But Bun should still enforce it for safety

      // Test with Bun - should crash
      // Use the wrapper script that kills the process after seeing the crash messages
      // to avoid hanging on llvm-symbolizer
      const { BUN_INSPECT_CONNECT_TO: _, ASAN_OPTIONS, ...rest } = bunEnv;
      const bunProc = spawn({
        cmd: [bunExe(), join(__dirname, "napi-app/test_experimental_with_timeout.js")],
        env: {
          ...rest,
          BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1",
          // Override ASAN_OPTIONS to disable coredump and symbolization for this specific test
          // Otherwise ASAN will hang trying to create a core dump or symbolize
          ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [bunStdout, bunStderr, bunExitCode] = await Promise.all([
        bunProc.stdout.text(),
        bunProc.stderr.text(),
        bunProc.exited,
      ]);

      // The wrapper script should exit with 0 if the test passed
      expect(bunExitCode).toBe(0);
      expect(bunStdout + bunStderr).toContain("Loading experimental module");
      expect(bunStdout + bunStderr).toContain("Created");
      expect(bunStderr).toContain("FATAL ERROR");
      expect(bunStdout + bunStderr).toContain("TEST PASSED: Process crashed as expected");

      // The error message should NOT contain "Did not crash"
      expect(bunStdout + bunStderr).not.toContain("ERROR: Did not crash");
    },
    25_000,
  );
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
  const env = { ...bunEnv, ...envArgs };
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

async function checkBothFail(test: string, args: any[] | string, envArgs: Record<string, string> = {}) {
  const [node, bun] = await Promise.all(
    ["node", bunExe()].map(async executable => {
      const { BUN_INSPECT_CONNECT_TO: _, ...rest } = bunEnv;
      const env = { ...rest, BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1", ...envArgs };
      const exec = spawn({
        cmd: [
          executable,
          "--expose-gc",
          join(__dirname, "napi-app/main.js"),
          test,
          typeof args == "string" ? args : JSON.stringify(args),
        ],
        env,
        stdout: Bun.version_with_sha.includes("debug") ? "inherit" : "pipe",
        stderr: Bun.version_with_sha.includes("debug") ? "inherit" : "pipe",
        stdin: "inherit",
      });
      const exitCode = await exec.exited;
      return { exitCode, signalCode: exec.signalCode };
    }),
  );
  expect(node.exitCode || node.signalCode).toBeTruthy();
  expect(!!node.exitCode).toEqual(!!bun.exitCode);
  expect(!!node.signalCode).toEqual(!!bun.signalCode);
}

describe("cleanup hooks", () => {
  describe("execution order", () => {
    it("executes in reverse insertion order like Node.js", async () => {
      // Test that cleanup hooks execute in reverse insertion order (LIFO)
      await checkSameOutput("test_cleanup_hook_order", []);
    });
  });

  describe("napi_strict_equals", () => {
    it("should match JavaScript === operator behavior", async () => {
      const output = await checkSameOutput("test_napi_strict_equals", []);
      expect(output).toContain("PASS: NaN !== NaN");
      expect(output).toContain("PASS: -0 === 0");
      expect(output).toContain("PASS: 42 === 42");
      expect(output).toContain("PASS: 42 !== 43");
      expect(output).not.toContain("FAIL");
    });
  });

  describe("napi_call_function", () => {
    it("should handle null recv parameter consistently", async () => {
      const output = await checkSameOutput("test_napi_call_function_recv_null", []);
      expect(output).toContain("PASS");
      expect(output).toContain("napi_call_function with valid recv succeeded");
      expect(output).not.toContain("FAIL");
    });
  });

  describe("napi_create_array_with_length", () => {
    it("should handle boundary values consistently", async () => {
      const output = await checkSameOutput("test_napi_create_array_boundary", []);
      expect(output).toContain("PASS");
      expect(output).toContain("napi_create_array_with_length(10) created array with correct length");
      expect(output).not.toContain("FAIL");
    });
  });

  describe("napi_create_dataview", () => {
    it("should validate bounds and provide consistent error messages", async () => {
      const output = await checkSameOutput("test_napi_dataview_bounds_errors", []);
      expect(output).toContain("napi_create_dataview");
      // Check for proper bounds validation
    });
  });

  describe("napi_typeof", () => {
    it("should handle empty/invalid values", async () => {
      const output = await checkSameOutput("test_napi_typeof_empty_value", []);
      // This test explores edge cases with empty/invalid napi_values
      // Bun has special handling for isEmpty() that Node doesn't have
      expect(output).toContain("napi_typeof");
    });

    it("should return napi_object for boxed primitives (String, Number, Boolean)", async () => {
      // Regression test for https://github.com/oven-sh/bun/issues/25351
      // napi_typeof was incorrectly returning napi_string for String objects (new String("hello"))
      // when it should return napi_object (matching JavaScript's typeof behavior)
      const output = await checkSameOutput("test_napi_typeof_boxed_primitives", []);
      expect(output).toContain("PASS: primitive string returns napi_string");
      expect(output).toContain("PASS: String object returns napi_object");
      expect(output).toContain("PASS: Number object returns napi_object");
      expect(output).toContain("PASS: Boolean object returns napi_object");
      expect(output).toContain("All boxed primitive tests passed!");
    });
  });

  describe("napi_object_freeze and napi_object_seal", () => {
    it("should handle arrays with indexed properties", async () => {
      const output = await checkSameOutput("test_napi_freeze_seal_indexed", []);
      // Bun has a check for indexed properties that Node.js doesn't have
      // This might cause different behavior when freezing/sealing arrays
      expect(output).toContain("freeze");
    });
  });

  describe("error handling", () => {
    it("removing non-existent env cleanup hook should not crash", async () => {
      // Test that removing non-existent hooks doesn't crash the process
      await checkSameOutput("test_cleanup_hook_remove_nonexistent", []);
    });

    it("removing non-existent async cleanup hook should not crash", async () => {
      // Test that removing non-existent async hooks doesn't crash
      await checkSameOutput("test_async_cleanup_hook_remove_nonexistent", []);
    });
  });

  describe("duplicate prevention", () => {
    it("should crash on duplicate hooks", async () => {
      await checkBothFail("test_cleanup_hook_duplicates", []);
    }, 10_000);
  });
});
