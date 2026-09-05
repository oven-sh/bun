import { spawn, spawnSync } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  isASAN,
  isCI,
  isMacOS,
  isMusl,
  isWindows,
  nodeExeMatchingAbi,
  tempDir,
} from "harness";
import { join } from "path";

// The napi-app addons don't link against bun, so existing binaries stay valid
// across bun builds. `bun install` runs a full `node-gyp rebuild` (clean + build
// of every target), so skip it when every target's .node output already exists
// and is newer than every native source / gyp / package file in napi-app.
function needsInstall(): boolean {
  const app = join(__dirname, "napi-app");
  if (!existsSync(join(app, "node_modules/node-addon-api"))) return true;
  const targets = [...readFileSync(join(app, "binding.gyp"), "utf8").matchAll(/"target_name":\s*"([\w-]+)"/g)].map(
    m => m[1],
  );
  if (targets.length === 0) return true;
  const newestInput = Math.max(
    ...readdirSync(app)
      .filter(f => /\.(c|cc|cpp|h)$/.test(f) || f === "binding.gyp" || f === "package.json")
      .map(f => statSync(join(app, f)).mtimeMs),
  );
  for (const target of targets) {
    const built = join(app, `build/Debug/${target}.node`);
    if (!existsSync(built)) return true;
    if (statSync(built).mtimeMs < newestInput) return true;
  }
  return false;
}

// File-scoped so every describe block below (including the non-concurrent
// `napi_create_string_latin1` and `cleanup hooks` blocks) gets a built addon
// even when `-t` filters out every test in describe.concurrent("napi").
beforeAll(async () => {
  if (!canBuildNodeAddons()) return;
  // Resolve (and possibly download) the ABI-matching node here, under the
  // generous hook timeout, instead of inside the first test that needs it.
  await nodeExeMatchingAbi();
  // build gyp
  if (needsInstall()) {
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
  }
  // node-gyp rebuild can take a while under a debug/ASAN binary (and the
  // hook may first download an ABI-matching node); default 5s hook timeout
  // kills the install subprocess mid-build.
}, 300_000);

describe.concurrent.skipIf(!canBuildNodeAddons())("napi", () => {
  describe.each(["esm", "cjs"])("bundle .node files to %s via", format => {
    describe.each(["node", "bun"])("target %s", target => {
      it("Bun.build", async () => {
        await using dir = tempDir("node-file-cli", {
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

        for (let exec of target === "bun" ? [bunExe()] : [bunExe(), await nodeExeMatchingAbi()]) {
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
            await using dir = tempDir("napi-app-compile-" + format, {
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
            // Since #29587 each extracted `.node` persists at a content-hashed
            // path shared across runs (pre-#29587 it was unlinked per load,
            // see #19550), so a second run must not extract new copies.
            await using tmpdir = tempDir("napi-compile-extract-" + format, {});
            const runEnv = { ...bunEnv, BUN_TMPDIR: String(tmpdir), TMPDIR: String(tmpdir) };
            const runSelf = () =>
              spawnSync({
                cmd: [exe, "self"],
                env: runEnv,
                stdin: "inherit",
                stderr: "inherit",
                stdout: "pipe",
              });
            const result = runSelf();
            const stdout = result.stdout.toString().trim();
            expect(stdout).toBe("hello world!");
            expect(result.success).toBeTrue();
            const extractedCount = () => readdirSync(String(tmpdir)).filter(f => f.endsWith(".node")).length;
            const count = extractedCount();
            expect(count).toBeGreaterThan(0);
            const again = runSelf();
            expect(again.stdout.toString().trim()).toBe("hello world!");
            expect(again.success).toBeTrue();
            expect(extractedCount()).toBe(count);
          },
          // CI runs tests under bun-profile (~700 MB on linux with ThinLTO
          // DWARF); --compile copies+reads+rewrites the whole thing to /tmp,
          // which on debian/ubuntu is disk-backed gp3.
          30 * 1000,
        );
      }

      it("`bun build`", async () => {
        await using dir = tempDir("node-file-build", {
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

        for (let exec of target === "bun" ? [bunExe()] : [bunExe(), await nodeExeMatchingAbi()]) {
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

  describe("napi_get_all_property_names", () => {
    it("own_only with skip_strings/skip_symbols includes non-enumerable own keys", async () => {
      const result = await checkSameOutput("test_get_all_property_names_own_only", []);
      expect(result).toContain(`own_only + skip_symbols: status=0 keys=["x", "ne"]`);
      expect(result).toContain(`own_only + skip_strings: status=0 keys=[Symbol(s), Symbol(nes)]`);
      expect(result).toContain(`own_only + all_properties: status=0 keys=["x", "ne", Symbol(s), Symbol(nes)]`);
      expect(result).toContain(`own_only + skip_symbols|enumerable: status=0 keys=["x"]`);
      expect(result).toContain(`own_only + skip_strings|enumerable: status=0 keys=[Symbol(s)]`);
    });
  });

  describe("napi_ref", () => {
    it("can recover the value from a weak ref", async () => {
      await checkSameOutput("test_napi_ref", []);
    });
    it("napi_reference_ref returns 0 after the referent is collected", async () => {
      const output = await checkSameOutput("test_reference_ref_after_collect_driver", []);
      expect(output).toContain("get_reference_value is undefined=1 reference_ref count=0");
      expect(output).toContain("second reference_ref count=0");
    });
    it("napi_get_buffer_info rejects a bare ArrayBuffer", async () => {
      const output = await checkSameOutput("test_napi_get_buffer_info_gate", []);
      expect(output).toContain("get_buffer_info(ArrayBuffer): status=1 pending=0");
      expect(output).toContain("get_buffer_info(Uint8Array): status=0 pending=0");
      expect(output).toContain("get_buffer_info(DataView): status=0 pending=0");
    });
    it("allows creating a handle scope in the finalizer", async () => {
      await checkSameOutput("test_napi_handle_scope_finalizer", []);
    });
    it("napi_delete_reference cancels the finalizer the GC already queued", async () => {
      // Modules built against a released Node-API version get their finalizers
      // run from the event loop, after the GC. An addon that deletes the
      // reference in between has usually freed the native object too, so the
      // finalizer must not run any more (Node dequeues it). Bun used to run it.
      const output = await checkSameOutput("test_delete_ref_after_collect", []);
      expect(output.split(/\r?\n/)).toEqual([
        "napi_wrap: collected before delete: true, finalized after delete: 0",
        "napi_add_finalizer: collected before delete: true, finalized after delete: 0",
        "resolved to undefined",
      ]);
    });
    it("a parent's queued finalizer can delete the references of children collected by the same GC", async () => {
      // Whether the children's finalizers are queued before or after the
      // parent's depends on the order the runtime finds the dead wrappers in,
      // so the fixture tries both orders. In either, no child's finalizer may
      // run after the parent deleted the child's reference.
      const output = await checkSameOutput("test_delete_ref_after_collect_parent_and_children", []);
      expect(output.split(/\r?\n/)).toEqual([
        "parent created before children: parent collected: true, parent finalized: true, children finalized after delete: 0",
        "parent created after children: parent collected: true, parent finalized: true, children finalized after delete: 0",
        "resolved to undefined",
      ]);
    });
    it("prevents underflow when unref called on zero refcount", async () => {
      // This tests the fix for napi_reference_unref underflow protection
      await checkSameOutput("test_ref_unref_underflow", []);
    });
    it("napi_create_reference accepts primitives when the module declares NAPI_VERSION >= 10", async () => {
      // Node.js keys the primitive-reference gate on the module's declared
      // Node-API version: >= 10 may reference any napi_valuetype, < 10 only
      // object/function/symbol. A value that cannot be held weakly is released
      // once the count reaches zero (heldAtZero=0) and a later ref stays at 0;
      // weakly held values survive (the test still holds them) and ref again to
      // 1. checkSameOutput asserts parity with Node for both addon builds.
      const result = await checkSameOutput("test_create_reference_primitive_by_version", []);
      const notWeakable = ["undefined", "null", "boolean", "number", "string", "bigint"];
      const weakable = ["symbol", "registered symbol", "object", "function"];
      // napi_ok = 0, napi_invalid_arg = 1
      expect(result.split(/\r?\n/)).toEqual([
        ...notWeakable.map(name => `declared=10 header=10 ${name}: status=0 roundTrip=1 heldAtZero=0 reref=0`),
        ...weakable.map(name => `declared=10 header=10 ${name}: status=0 roundTrip=1 heldAtZero=1 reref=1`),
        ...notWeakable.map(name => `declared=8 header=8 ${name}: status=1`),
        ...weakable.map(name => `declared=8 header=8 ${name}: status=0 roundTrip=1 heldAtZero=1 reref=1`),
      ]);
    });
  });

  describe("napi_get_version / node_api_create_external_string_*", () => {
    it("reports Node-API v10 and accepts zero-length external strings", async () => {
      const result = await checkSameOutput("test_napi_v10_surface", []);
      expect(result).toContain("napi_get_version >= 10 = true");
      expect(result).toContain("external latin1 empty: status=0 copied=0 finalized=1");
      expect(result).toContain("external latin1 empty: length=0");
      expect(result).toContain("external utf16 empty: status=0 copied=0 finalized=1");
      expect(result).toContain("external utf16 empty: length=0");
      expect(result).toContain("external utf16 nonempty: copied=0");
    });

    it("accepts (NULL, 0) and rejects length > INT_MAX", async () => {
      const output = await checkSameOutput("test_napi_external_string_args", []);
      expect(output).toContain("ext_string_latin1(NULL,0): status=0 pending=0");
      expect(output).toContain("ext_string_latin1(ptr,INT_MAX+1): status=1 pending=0");
      expect(output).toContain("ext_string_utf16(ptr,INT_MAX+1): status=1 pending=0");
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

    it("rejects with napi_pending_exception before adopting data when an exception is pending", async () => {
      const result = await checkSameOutput("test_external_buffer_with_pending_exception", []);
      expect(result).toContain("status=10");
      expect(result).toContain("PASS: caller retains ownership on failure with pending exception");
      expect(result).not.toContain("FAIL");
    });
  });

  describe("napi_create_external_arraybuffer", () => {
    it("wraps caller data and does not fire finalize_cb while the ArrayBuffer is alive", async () => {
      const result = await checkSameOutput("test_external_arraybuffer_finalizer", []);
      expect(result).toContain("PASS: napi_create_external_arraybuffer wraps caller data without copying");
      expect(result).toContain(
        "PASS: napi_create_external_arraybuffer finalizer not called while ArrayBuffer is alive",
      );
      expect(result).toContain("PASS: napi_create_external_arraybuffer data intact after GC");
      expect(result).not.toContain("FAIL");
    });

    it("rejects with napi_pending_exception before adopting external_data when an exception is pending", async () => {
      const result = await checkSameOutput("test_external_arraybuffer_with_pending_exception", []);
      expect(result).toContain("status=10");
      expect(result).toContain("PASS: caller retains ownership on failure with pending exception");
      expect(result).not.toContain("FAIL");
    });
  });

  // The finalizer of an external buffer belongs to the env that created it, and that env's
  // teardown frees the bytes, so the bytes must not be transferred to another thread.
  describe("external buffers are untransferable", () => {
    it("every transfer entry point throws DataCloneError and leaves the buffer intact", async () => {
      const result = await checkSameOutput("test_external_buffer_untransferable", []);
      const expected = (kind: string) =>
        [
          `${kind}: isMarkedAsUntransferable(created)=${kind === "arraybuffer"} isMarkedAsUntransferable(arrayBuffer)=true ownKeys=0`,
          `${kind}: structuredClone: DataCloneError code=25`,
          `${kind}: MessagePort.postMessage: DataCloneError code=25`,
          `${kind}: new Worker transferList: DataCloneError code=25`,
          `${kind}: structuredClone after a plain ArrayBuffer: DataCloneError code=25`,
          `${kind}: byteLength=8 plain.byteLength=2`,
          `${kind}: copy=[1,2,3,4,5,6,7,8] byteLength=8`,
        ].join("\n");
      const expectedEmpty = (kind: string) =>
        [
          `empty ${kind}: isMarkedAsUntransferable(arrayBuffer)=true`,
          `empty ${kind}: structuredClone: DataCloneError code=25`,
        ].join("\n");
      expect(result).toBe(
        [
          expected("arraybuffer"),
          expected("buffer"),
          expectedEmpty("arraybuffer"),
          expectedEmpty("buffer"),
          'stats: {"finalized":0,"finalizedOffThread":0}',
        ].join("\n"),
      );
    });

    it("a worker's buffers reach the parent as copies and are finalized by the worker's env teardown", async () => {
      const result = await checkSameOutput("test_external_buffer_worker_exit", []);
      const message = JSON.stringify({
        transfers: {
          arraybuffer: "DataCloneError code=25",
          arraybufferByteLength: 4,
          buffer: "DataCloneError code=25",
          bufferByteLength: 4,
        },
        copies: { arraybuffer: [1, 2, 3, 4], buffer: [1, 2, 3, 4] },
        stats: { finalized: 0, finalizedOffThread: 0 },
      });
      expect(result).toBe(
        [
          "worker exited with 0",
          `messages: [${message}]`,
          'stats after exit: {"finalized":2,"finalizedOffThread":0}',
          "resolved to undefined",
        ].join("\n"),
      );
    });
  });

  describe("pending-exception gate", () => {
    it("refuses and performs no side effects while a napi exception is pending", async () => {
      const result = await checkSameOutput("test_pending_exception_gate", []);
      // every gated call must report napi_pending_exception (10)
      for (const fn of [
        "napi_object_freeze",
        "napi_object_seal",
        "napi_set_element",
        "napi_run_script",
        "napi_instanceof",
        "napi_strict_equals",
        "napi_wrap",
        "napi_get_prototype",
        "napi_get_date_value",
        "napi_get_array_length",
        "napi_create_date",
        "napi_create_dataview",
        "napi_create_promise",
        "napi_resolve_deferred",
      ]) {
        expect(result).toContain(`${fn}: status=10`);
      }
      // functions Node.js does NOT gate (CHECK_ENV) must still succeed
      for (const fn of [
        "napi_get_global",
        "napi_create_reference",
        "napi_reference_unref",
        "napi_get_reference_value",
        "napi_create_bigint_int64",
        "napi_create_symbol",
        "napi_is_buffer",
        "napi_is_typedarray",
        "napi_get_instance_data",
        "napi_get_value_bigint_uint64",
        "napi_add_async_cleanup_hook",
        "napi_remove_async_cleanup_hook",
      ]) {
        expect(result).toContain(`${fn}: status=0`);
      }
      // side effects must NOT have happened
      expect(result).toContain("side_effect frozen=false");
      expect(result).toContain("side_effect arr[7]=undefined");
      expect(result).toContain("side_effect script_ran=false");
    });

    // Same ungated functions, but with the exception pending on the engine
    // (napi_call_function raises the napi_throw_error one before refusing),
    // which is the state node-addon-api builds its Error object in. They must
    // still succeed and must leave that exception pending.
    it("ungated functions succeed while an engine exception is pending and preserve it", async () => {
      const result = await checkSameOutput("test_ungated_calls_with_engine_exception", []);
      // printf() via the Windows CRT emits \r\n, so split on either ending.
      expect(result.split(/\r?\n/)).toEqual([
        "napi_call_function: status=10",
        "napi_get_value_bigint_int64: status=0 value=-7",
        "napi_get_value_bigint_uint64: status=0 lossless=0",
        "napi_get_value_string_utf8: status=0 value=ungated",
        "napi_create_bigint_int64: status=0",
        "napi_create_bigint_uint64: status=0",
        "napi_create_symbol: status=0",
        "napi_create_array_with_length: status=0",
        "napi_is_array: status=0 is_array=1",
        "napi_create_string_utf8: status=0",
        "napi_create_int32: status=0",
        "exception pending after: true",
        "pending exception code: EPENDING",
      ]);
    });

    // A node:vm timeout requested while the addon is inside those calls, again
    // with an engine exception pending: none of the calls reports it, the
    // exception they found is still the one pending when they are done, and the
    // timeout still stops the script once the addon returns.
    it("a termination requested during ungated calls is delivered after them, not by them", async () => {
      const result = await checkSameOutput("test_ungated_calls_through_vm_timeout", []);
      expect(result.split(/\r?\n/)).toEqual([
        "napi_call_function: status=10",
        "ungated call failures: 0",
        "exception pending: before clear=true after clear=false",
        "ERR_SCRIPT_EXECUTION_TIMEOUT",
      ]);
    });

    // A script / worker looping through ungated calls, stopped while inside one
    // of them nearly every time. Hangs when the request is lost.
    it("a node:vm timeout interrupts a script looping through ungated functions", async () => {
      const result = await checkSameOutput("test_ungated_calls_vm_timeout", []);
      expect(result.split(/\r?\n/)).toEqual(Array(5).fill("ERR_SCRIPT_EXECUTION_TIMEOUT"));
    });

    // Worker startup dominates this one: about two seconds per worker under a
    // debug build, before any CI load.
    it("worker.terminate() stops a worker looping through ungated functions", async () => {
      const result = await checkSameOutput("test_ungated_calls_worker_terminate", []);
      expect(result.split(/\r?\n/)).toEqual([...Array(2).fill("terminate() resolved with 1"), "resolved to undefined"]);
    }, 30_000);
  });

  describe("status code alignment with Node.js", () => {
    it("matches Node for symbol description, empty named key, result-on-exception ordering, and module filename", async () => {
      const output = await checkSameOutput("test_napi_symbol_key_result_ordering", []);
      expect(output).toContain('set_named_property(""): status=0 pending=0');
      expect(output).toContain('obj[""]=1');
      expect(output).toContain("create_symbol(undefined): status=3 pending=0");
      expect(output).toContain("create_symbol(null): status=3 pending=0");
      expect(output).toContain('create_symbol(""): status=0 pending=0');
      expect(output).toContain('create_symbol("") description: type=4 len=0');
      expect(output).toContain("new_instance(throws): status=10 result_written=0");
      expect(output).toContain("get_named_property(throws): status=10 result_written=0");
      expect(output).toContain("has_named_property(throws): status=10 result_written=0");
      expect(output).toContain("module_file_name: status=0 is_null=0");
    });

    it("returns the same napi_status as Node.js for invalid inputs", async () => {
      const result = await checkSameOutput("test_napi_status_codes_node26", []);

      // napi_wrap/unwrap/remove_wrap/add_finalizer on primitive -> napi_invalid_arg (1)
      for (const fn of ["napi_wrap", "napi_unwrap", "napi_remove_wrap", "napi_add_finalizer"]) {
        expect(result).toContain(`${fn}(number): status=1 pending=0`);
      }

      // napi_coerce_to_*: type-specific status, exception stays pending
      expect(result).toContain("napi_coerce_to_number(Symbol): status=6 pending=1");
      expect(result).toContain("napi_coerce_to_string(Symbol): status=3 pending=1");
      expect(result).toContain("napi_coerce_to_object(null): status=2 pending=1");

      // napi_run_script: napi_generic_failure (9), exception stays pending
      expect(result).toContain("napi_run_script(throw): status=9 pending=1");
      expect(result).toContain("napi_run_script(syntax): status=9 pending=1");

      // napi_create_bigint_words > INT_MAX: napi_invalid_arg, no throw
      expect(result).toContain("napi_create_bigint_words(INT_MAX+1): status=1 pending=0");

      // napi_create_buffer / napi_create_buffer_copy: napi_generic_failure (9) on alloc failure
      expect(result).toContain("napi_create_buffer(SIZE_MAX): status=9 pending=1");
      expect(result).toContain("napi_create_buffer_copy(SIZE_MAX): status=9 pending=1");

      // second napi_throw_error: napi_pending_exception, first message kept
      expect(result).toContain("napi_throw_error(2nd): status=10");
      expect(result).toContain("napi_throw_error(2nd): kept=first");

      // node_api_post_finalizer(NULL): napi_ok
      expect(result).toContain("node_api_post_finalizer(NULL): status=0 pending=0");

      // napi_make_callback validation -> napi_invalid_arg
      for (const which of ["recv=NULL", "argc>0,argv=NULL", "func=number"]) {
        expect(result).toContain(`napi_make_callback(${which}): status=1 pending=0`);
      }

      // napi_ref/unref_threadsafe_function: env ignored, last_error untouched
      expect(result).toContain("napi_ref_threadsafe_function(env=NULL): status=0");
      expect(result).toContain("napi_unref_threadsafe_function(env=NULL): status=0");
      expect(result).toContain("napi_ref_threadsafe_function: last_error_preserved=1");
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
    // worker.terminate() while execute callbacks are still running on the
    // thread pool must not free the worker's VirtualMachine (the pool-thread
    // completion would post into a freed event loop) or its JSC heap (the
    // ArrayBuffer backing store would be finalized while the addon is still
    // writing it). VM teardown counts queued napi_async_work and waits for the
    // pool to hand each one back before destroying the VM. Before that the
    // subprocess died with a heap-use-after-free in the pool thread's
    // completion post instead of printing PASS.
    it("worker.terminate() with execute callbacks in flight waits for them and does not UAF", async () => {
      const addon = join(__dirname, "napi-app/build/Debug/test_async_work_worker_terminate.node");
      const workerSrc = /* js */ `
        const { parentPort, workerData } = require("node:worker_threads");
        const addon = require(workerData.addon);
        const keep = [];
        for (let i = 0; i < 4; i++) {
          const ab = new ArrayBuffer(16 << 20);
          keep.push(ab);
          addon.queueWork(ab, 300 + i * 50, () => {});
        }
        parentPort.postMessage("up");
        setInterval(() => {}, 1000);
      `;
      const script = /* js */ `
        const { Worker } = require("node:worker_threads");
        (async () => {
          for (let r = 0; r < ${isASAN ? 3 : 5}; r++) {
            const w = new Worker(process.env.WORKER_SRC, {
              eval: true,
              workerData: { addon: process.env.ADDON },
            });
            await new Promise((resolve, reject) => {
              w.once("message", resolve);
              w.once("error", reject);
              w.once("exit", code => reject(new Error("worker exited before queueing work, code " + code)));
            });
            await w.terminate();
          }
          console.log("PASS");
        })().catch(e => {
          console.error(String(e));
          process.exit(1);
        });
      `;
      await using proc = spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, ADDON: addon, WORKER_SRC: workerSrc },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "PASS", stderr: "", exitCode: 0 });
    }, 30_000);
  });

  describe("napi_threadsafe_function", () => {
    it("passes NULL js_callback to call_js when created without a func", async () => {
      const output = await checkSameOutput("test_tsfn_null_js_callback_driver", []);
      expect(output).toContain("js_callback == NULL: 1");
    });

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

    it("runs the finalizer before freeing the function, so the finalizer can still use the handle", async () => {
      // napi_ok = 0, napi_invalid_arg = 1 (no thread reference is left to release).
      const result = await checkSameOutput("test_threadsafe_function_finalizer_uses_handle", []);
      expect(result).toContain(
        "finalizer saw: context: status=0 matches=1, hint is context=1, data matches=1, unref status=0, release status=1",
      );
    });

    it.each([0, 3])(
      "runs the finalizer and exits when the last reference is released after abort (%d queued items)",
      async queued => {
        const result = await checkSameOutput("test_threadsafe_function_abort_then_last_release", [queued]);
        expect(result).toContain("finalized: true");
      },
    );

    it("wakes blocked producers, runs the finalizer and exits when aborted with a bounded queue", async () => {
      const result = await checkSameOutput("test_threadsafe_function_abort_blocked_producers", []);
      expect(result).toContain("finalized: true");
    });

    // An abort finalizes from its own dispatch, like Node: it does not wait for
    // the references other threads still hold (they are told to make no further
    // calls, so they may never release). The late release of such a reference
    // reports napi_ok (0) and frees the function.
    it("runs the finalizer on abort while another thread still holds a reference", async () => {
      const result = await checkSameOutput("test_threadsafe_function_abort_with_outstanding_ref", []);
      expect(result).toContain("finalized: true\nreleased after finalize: true status: 0");
    });

    // A full bounded queue must not hide that the function is closing: the call
    // reports napi_closing (16) and consumes the caller's thread reference, so
    // the finalizer still runs. napi_queue_full (17) would strand it forever.
    it("reports napi_closing, not napi_queue_full, on an aborted full queue", async () => {
      const result = await checkSameOutput("test_threadsafe_function_abort_full_queue", []);
      expect(result).toContain("call after abort: 16\nfinalized: true");
    });

    it("drains microtasks between callbacks of one dispatch, not before the first", async () => {
      const result = await checkSameOutput("test_threadsafe_function_microtask_order", []);
      expect(result).toContain("callback 1\nmicrotask 1\ncallback 2\nmicrotask 2\ncallback 3");
    });
    it("reports what call_js throws as each item's uncaught exception and keeps draining", async () => {
      const result = await checkSameOutput("test_threadsafe_function_call_js_throws", []);
      expect(result).toContain("uncaughtException 3 call_js error 3");
      expect(result).toContain("done 3");
    });

    // Items still queued when the function stops being dispatched. Node's
    // process.exit() leaves them alone; an addon's call_js is usually written
    // for a live env and aborts when handed a null one at exit (the finalizer
    // is not printed: bun runs it at exit, node does not).
    it("drops the queued items at process.exit()", async () => {
      const result = await checkSameOutput("test_threadsafe_function_queued_items_at_process_exit", []);
      expect(result).toBe("exiting with 3 items queued");
    });

    it("does not re-enter call_js when its callback calls process.exit()", async () => {
      const result = await checkSameOutput("test_threadsafe_function_process_exit_inside_callback", []);
      expect(result).toBe("call_js: item 1, env live, js_callback set");
    });

    // A worker's env really goes away while the addon's threads live on, so
    // each item goes back to call_js the normal way, with the live env (calling
    // into JS is refused: napi_cannot_run_js, 23, as this addon is built with
    // NAPI_EXPERIMENTAL), and then the finalizer runs. Node does the same when
    // its env cleanup turns the loop a last time.
    it.each([
      ["exit", 0],
      ["terminate", 1],
    ])("delivers the queued items with the live env when the creating worker is gone (%s)", async (how, code) => {
      const result = await checkSameOutput(`test_threadsafe_function_queued_items_at_worker_${how}`, []);
      // printf ends its lines with \r\n on Windows.
      expect(result.replaceAll("\r\n", "\n")).toBe(
        [
          ...[1, 2, 3].flatMap(item => [
            `call_js: item ${item}, env live, js_callback set`,
            `call_js: item ${item}, call_function 23`,
          ]),
          "finalize: env live",
          `worker exited with ${code}`,
          "resolved to undefined",
        ].join("\n"),
      );
    });

    // After napi_tsfn_abort nothing queued runs any more: each item goes back
    // to call_js with a null env and js_callback (the documented "free this"
    // signal), then the function finalizes.
    it("hands the queued items back with a null env after abort instead of running them", async () => {
      const result = await checkSameOutput("test_threadsafe_function_abort_hands_queued_items_back", []);
      expect(result.replaceAll("\r\n", "\n")).toBe(
        [
          "abort: 0",
          ...[1, 2, 3].map(item => `call_js: item ${item}, env null, js_callback null`),
          "finalize: env live",
          "finalized: true",
          "resolved to undefined",
        ].join("\n"),
      );
    });

    // An addon's own threads outlive the worker that created the threadsafe
    // function (next-swc's tokio pool does this): the last call and the last
    // release land after the worker's VM, and its event loop, are gone.
    // MIMALLOC_PURGE_DELAY=0 makes a stale event-loop pointer fault instead of
    // reading recycled memory that still happens to look intact.
    it("survives the last call and release after the creating worker is gone", async () => {
      // Both threadsafe functions are finalized at worker teardown; a later call
      // reports napi_closing (16), a later release napi_ok (0).
      const result = await checkSameOutput("test_threadsafe_function_orphaned_by_worker", [], {
        MIMALLOC_PURGE_DELAY: "0",
      });
      expect(result).toContain("worker exited with 0\nfinalized=2 call=16 release=0");
    });

    // A finalizer running while a worker's env drains its finalizers can
    // register another (here: an external buffer with a finalize_cb). Bun runs
    // that one in the same cleanup rather than leaving it behind the walk. Bun-
    // only rather than same-output: node hands an external buffer's finalizer to
    // the BackingStore deleter, not to the env's tracked references, so a buffer
    // created during teardown dies with the isolate and node prints late=0.
    it("runs a finalizer that another finalizer registered during env cleanup", async () => {
      await using proc = spawn({
        cmd: [bunExe(), join(__dirname, "napi-app/main.js"), "test_finalizer_registered_during_env_cleanup", "[]"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toContain("worker exited with 0\nlate=1");
      expect(exitCode).toBe(0);
    });

    // A call that reports napi_closing consumes the calling thread's reference
    // (node's ThreadSafeFunction::Push), so on an orphaned threadsafe function
    // it can drop the last one -- and then it must free it, or every worker that
    // leaves one behind leaks. An addon that uses the handle after napi_closing
    // (a release, say) therefore touches freed memory, in node as well: the docs
    // say to make no further use of it. Bun-only: reads bun's live tsfn count.
    // The spawned run takes >10s under a debug+ASAN bun, so the 5s default
    // times out on slow machines.
    it("frees an orphaned threadsafe function whose last reference a call consumed", async () => {
      await using proc = spawn({
        cmd: [bunExe(), join(__dirname, "napi-app/main.js"), "test_threadsafe_function_orphan_leak", "[]"],
        env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // Each iteration: the dead worker leaves 5 orphaned threadsafe functions,
      // all 5 calls report napi_closing (16), and none is still alive after. A
      // leak shows up as orphaned=10 on the second iteration.
      const iteration = "orphaned=5 closing=5 leaked=0";
      expect({
        stdout: stdout
          .replaceAll("\r\n", "\n")
          .replaceAll(/^\[\w+\].+$/gm, "")
          .trim(),
        stderr,
        exitCode,
        signalCode: proc.signalCode,
      }).toMatchObject({
        stdout: `${Array(5).fill(iteration).join("\n")}\nresolved to undefined`,
        exitCode: 0,
        signalCode: null,
      });
    }, 30_000);

    // napi_create_threadsafe_function once the env has torn its threadsafe
    // functions down (here: from a cleanup hook that a threadsafe function's
    // teardown finalizer registered). There is no event loop left, so it must
    // fail instead of handing back a handle whose finalizer already ran. The
    // failed creation must not run the addon's finalizer either -- the addon's
    // own error handling owns those resources. Node creates one and returns
    // napi_ok, so this is bun-only.
    it("fails when created after the env is torn down", async () => {
      await using proc = spawn({
        cmd: [bunExe(), join(__dirname, "napi-app/main.js"), "create_threadsafe_function_after_teardown", "[]"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // napi_generic_failure = 9, and no handle is written back. stderr is part
      // of the compared object so a crash or assert prints with the failure.
      expect({
        stdout: stdout
          .replaceAll("\r\n", "\n")
          .replaceAll(/^\[\w+\].+$/gm, "")
          .trim(),
        stderr,
        exitCode,
      }).toMatchObject({
        stdout: "registered\ntsfn finalizer at teardown\nlate cleanup hook: name=0 create=9 handle=null",
        exitCode: 0,
      });
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
    it("napi_fatal_exception triggers uncaughtException for non-Error values", async () => {
      // Node's napi_fatal_exception only guards against a null argument; any
      // value reaches the uncaughtException path. Addons commonly forward
      // whatever a JS callback threw (strings, plain objects) verbatim.
      const addon = join(__dirname, "napi-app/build/Debug/napitests.node");
      const code = `
        const addon = require(${JSON.stringify(addon)});
        const caught = [];
        process.on("uncaughtException", e => {
          caught.push(e);
        });
        const values = ["addon says: something fatal", 42, { plain: "object" }, new Error("real error")];
        const statuses = values.map(v => addon.call_fatal_exception(v));
        process.on("exit", () => {
          console.log(JSON.stringify({
            statuses,
            caught: caught.map(e => e instanceof Error ? String(e) : e),
          }));
        });
      `;
      await using proc = spawn({
        cmd: [bunExe(), "-e", code],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        statuses: [0, 0, 0, 0],
        caught: ["addon says: something fatal", 42, { plain: "object" }, "Error: real error"],
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("napi_adjust_external_memory", () => {
    it("applies negative deltas and reports the running total", async () => {
      const result = await checkSameOutput("test_napi_adjust_external_memory", []);
      // printf() via the Windows CRT emits \r\n, so split on either ending.
      expect(result.split(/\r?\n/)).toEqual([
        "after_add-base=8192",
        "after_sub-after_add=-8192",
        "readback-after_sub=0",
        "readback-base=0",
      ]);
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

  describe("napi_define_properties", () => {
    it("goes through [[DefineOwnProperty]] and validates the name", async () => {
      await checkSameOutput("test_define_properties", []);
    });
  });

  describe("napi_get_property_names / napi_get_all_property_names", () => {
    it("does not poison JSC's per-Structure own-keys cache", async () => {
      const output = await checkSameOutput("test_property_names_cache_poisoning", []);
      expect(output).toContain("Reflect.ownKeys after get_all_property_names(include_prototypes): a,b");
      expect(output).toContain("Object.keys after get_property_names: w1,w2");
      expect(output).toContain("napi get_property_names result: w1,w2,pEnum");
    });
    it("handles accessor properties when filtering by napi_key_writable", async () => {
      await checkSameOutput("test_get_all_property_names_accessor", []);
    });
    it("returns napi_pending_exception when a Proxy trap throws during the descriptor walk", async () => {
      const output = await checkSameOutput("test_get_all_property_names_throwing_proxy_traps", []);
      expect(output).toContain("own_only gopd throws: status=10 keys=undefined exception=gopd trap");
      expect(output).toContain(
        "include_prototypes gopd throws on prototype: status=10 keys=undefined exception=gopd trap",
      );
    });
    it("returns napi_pending_exception when getPrototypeOf throws during the descriptor walk", async () => {
      // Not checkSameOutput: V8 filters proxy keys while collecting them and
      // only calls getPrototypeOf once, so a trap that throws on the second
      // call never throws under Node.
      const output = (await runOn(bunExe(), "test_get_all_property_names_get_prototype_throws_in_descriptor_walk", []))
        .replaceAll(/^\[\w+\].+$/gm, "")
        .trim();
      expect(output).toBe("status=10 keys=undefined exception=getPrototypeOf trap calls=2");
    });
    it("matches Node for Proxy and String wrapper with napi_key_writable/napi_key_configurable", async () => {
      const output = await checkSameOutput("test_get_all_property_names_proxy_and_string_wrapper", []);
      expect(output).toContain(`proxy own_only writable: status=0 keys=["x","y"]`);
      expect(output).toContain(`proxy own_only configurable: status=0 keys=["x","y"]`);
      expect(output).toContain(`proxy(no traps) writable: status=0 keys=["ro","rw"]`);
      expect(output).toContain(`string own_only writable: status=0 keys=[0,1]`);
      expect(output).toContain(`string own_only configurable: status=0 keys=[0,1]`);
      expect(output).toContain(`derived string writable: status=0 keys=[0,1]`);
      expect(output).toContain(`proxy-proto include_prototypes writable: status=0 keys=["x","y"]`);
      expect(output).toContain(`string-proto include_prototypes configurable: status=0 keys=[0,1]`);
      expect(output).toContain(`plain writable: status=0 keys=["w","nc"]`);
      expect(output).toContain(`frozen writable: status=0 keys=[]`);
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

  describe("napi_create_object", () => {
    // https://github.com/oven-sh/bun/issues/25658
    it("result is clonable with structuredClone", async () => {
      await checkSameOutput("test_napi_create_object_structured_clone", []);
    });
  });

  describe("napi_create_arraybuffer", () => {
    it("returns zero-filled memory", async () => {
      const output = await checkSameOutput("test_create_arraybuffer_zeroed", []);
      expect(output).toBe("PASS: napi_create_arraybuffer memory is zero-filled");
    });
  });

  describe("node_api experimental", () => {
    it("node_api_set_prototype sets [[Prototype]]", async () => {
      const output = await checkSameOutput("test_node_api_set_prototype", []);
      expect(output.split(/\r?\n/)).toEqual([
        "set_prototype: proto_matches=true inherited=123",
        "set_prototype: null_proto_type=1",
      ]);
    });
    it("node_api_create_object_with_properties creates an object with the given prototype and properties", async () => {
      const output = await checkSameOutput("test_node_api_create_object_with_properties", []);
      expect(output.split(/\r?\n/)).toEqual([
        "create_object_with_properties: proto_type=1 a=1 b=2 sym=3 idx0=4",
        "create_object_with_properties: bad_name_status=4",
        "create_object_with_properties: custom_proto_matches=true",
      ]);
    });
    it("node_api_create_sharedarraybuffer / is_sharedarraybuffer / create_external_sharedarraybuffer", async () => {
      const output = await checkSameOutput("test_node_api_sharedarraybuffer", []);
      expect(output.split(/\r?\n/)).toEqual([
        "create_sharedarraybuffer: data_nonnull=true is_sab=true is_ab=false",
        "create_sharedarraybuffer: info_data_matches=true info_len=16",
        "is_sharedarraybuffer: plain_ab=false number=false",
        "create_external_sharedarraybuffer: is_sab=true data_matches=true len=8 first=176 finalized_early=false",
      ]);
    });
  });

  describe("napi_get_typedarray_info", () => {
    it("reports a zero byte offset for a view over the whole buffer and the view's byte offset for an offset view", async () => {
      const whole = await checkSameOutput("test_typedarray_info_byte_offset", "[new Uint8Array(new ArrayBuffer(64))]");
      expect(whole).toBe(
        "byte_offset=0 length=64 arraybuffer_byte_length=64 data_is_arraybuffer_data_plus_byte_offset=true",
      );
      const offset = await checkSameOutput(
        "test_typedarray_info_byte_offset",
        "[new Uint8Array(new ArrayBuffer(64), 48)]",
      );
      expect(offset).toBe(
        "byte_offset=48 length=16 arraybuffer_byte_length=64 data_is_arraybuffer_data_plus_byte_offset=true",
      );
    });

    // Small typed arrays use JSC's "fast" mode, whose GC-heap storage is
    // abandoned when the backing ArrayBuffer is materialized. The data pointer
    // NAPI hands out must point at the storage that survives, or native writes
    // are silently dropped (see issue #37151).
    it("returns a data pointer whose writes are visible through small typed arrays", async () => {
      // 999/1000 straddle JSC's fastSizeLimit; 2048 is always wasteful mode.
      await Promise.all(
        [16, 999, 1000, 2048].map(async size => {
          const output = await checkSameOutput("test_typedarray_info_write_visibility", `[new Uint8Array(${size})]`);
          expect(output).toBe(`length=${size} first=42 last=42`);
        }),
      );
    });

    it("returns a data pointer at the reported byte offset for small typed arrays", async () => {
      await Promise.all(
        [
          "new Uint8Array(0)",
          "new Uint8Array(64)",
          "new Int32Array(8)",
          // offset view derived from a small array
          "new Uint8Array(64).subarray(16)",
        ].map(async expr => {
          const output = await checkSameOutput("test_typedarray_info_byte_offset", `[${expr}]`);
          expect(output).toEndWith("data_is_arraybuffer_data_plus_byte_offset=true");
        }),
      );
    });

    it("napi_get_buffer_info pointer stays valid after the backing ArrayBuffer is materialized", async () => {
      await Promise.all(
        ["Buffer.alloc(32)", "new Uint8Array(32)"].map(async expr => {
          const output = await checkSameOutput("test_buffer_info_pointer_stability", `[${expr}]`);
          expect(output).toBe("length=32 first=43 last=43");
        }),
      );
    });

    it("napi_create_buffer and napi_create_buffer_copy pointers stay valid after the backing ArrayBuffer is materialized", async () => {
      const output = await checkSameOutput("test_create_buffer_pointer_stability", []);
      expect(output.split(/\r?\n/)).toEqual(["create_buffer last=44", "create_buffer_copy last=45"]);
    });

    it("reports the view's byte offset into its backing buffer", async () => {
      const output = await checkSameOutput(
        "test_typedarray_info_byte_offset",
        "[new Uint8Array(new ArrayBuffer(64), 16, 8)]",
      );
      expect(output).toBe(
        "byte_offset=16 length=8 arraybuffer_byte_length=64 data_is_arraybuffer_data_plus_byte_offset=true",
      );
    });

    it("reports the byte offset in bytes for an element type wider than one byte", async () => {
      const output = await checkSameOutput(
        "test_typedarray_info_byte_offset",
        "[new Int32Array(new ArrayBuffer(64), 32, 4)]",
      );
      expect(output).toBe(
        "byte_offset=32 length=4 arraybuffer_byte_length=64 data_is_arraybuffer_data_plus_byte_offset=true",
      );
    });

    it("maps Float16Array to napi_float16_array in both napi_get_typedarray_info and napi_create_typedarray", async () => {
      const output = await checkSameOutput(
        "test_napi_float16_array",
        "[(() => { const f = new Float16Array(new ArrayBuffer(16), 4, 4); f.set([1.5, 2, 3, 4]); return f; })()]",
      );
      // printf() via the Windows CRT emits \r\n, so split on either ending.
      expect(output.split(/\r?\n/)).toEqual([
        "is_typedarray=1 info_status=0 type=11 length=4 byte_offset=4 e0=0x3E00",
        "arraybuffer_byte_length=16 data_is_ab_plus_offset=1",
        "create_status=0 created_is_typedarray=1 created_type=11 created_length=4",
        "created instanceof Float16Array=1",
      ]);
    });
  });

  describe("napi_get_dataview_info", () => {
    it("reports the view's byte offset into its backing buffer", async () => {
      const output = await checkSameOutput(
        "test_dataview_info_byte_offset",
        "[new DataView(new ArrayBuffer(64), 24, 8)]",
      );
      expect(output).toBe(
        "byte_offset=24 byte_length=8 arraybuffer_byte_length=64 data_is_arraybuffer_data_plus_byte_offset=true",
      );
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
      await Promise.all([
        checkSameOutput("test_wrap_lifetime_without_ref", []),
        checkSameOutput("test_wrap_lifetime_with_weak_ref", []),
        checkSameOutput("test_wrap_lifetime_with_strong_ref", []),
        checkSameOutput("test_remove_wrap_lifetime_with_weak_ref", []),
        checkSameOutput("test_remove_wrap_lifetime_with_strong_ref", []),
        // napi finalizers also run at VM exit, even if they didn't get run by GC
        checkSameOutput("test_ref_deleted_in_cleanup", []),
        // calling napi_delete_ref in the ref's finalizer is not use-after-free
        checkSameOutput("test_ref_deleted_in_async_finalize", []),
      ]);
    });
  });

  describe("napi_define_class", () => {
    it("handles edge cases in the constructor", async () => {
      await Promise.all([
        checkSameOutput("test_napi_class", []),
        checkSameOutput("test_subclass_napi_class", []),
        checkSameOutput("test_napi_class_non_constructor_call", []),
        checkSameOutput("test_reflect_construct_napi_class", []),
      ]);
    });

    it("does not crash with Reflect.construct when newTarget has no prototype", async () => {
      await checkSameOutput("test_reflect_construct_no_prototype_crash", []);
    });
  });

  describe("napi_get_cb_info this_arg", () => {
    it("is globalThis for a bare call resolved through a closure scope", async () => {
      const output = await checkSameOutput("test_this_value_of_bare_call_through_closure", []);
      expect(output).toContain("bare call through closure returned globalThis: true");
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

    it("returns a non-null message for napi_cannot_run_js", async () => {
      // A v10 addon calling napi_throw inside a teardown finalizer gets
      // napi_cannot_run_js. napi_get_last_error_info must then report a
      // non-null message (previously the error_messages table stopped at
      // napi_would_deadlock, so error_message was left as nullptr).
      const code = `globalThis.keep = require(${JSON.stringify(
        join(__dirname, "napi-app/build/Debug/test_last_error_cannot_run_js.node"),
      )});`;
      const run = async (exe: string) => {
        await using proc = spawn({ cmd: [exe, "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout: stdout.trim(), stderr, exitCode };
      };
      const [bun, node] = await Promise.all([run(bunExe()), run(await nodeExeMatchingAbi())]);
      expect(bun).toEqual(node);
      expect(bun).toEqual({
        stdout: "napi_throw status=23 error_code=23 error_message=Cannot run JavaScript",
        stderr: "",
        exitCode: 0,
      });
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
    // main.js does eval then spread so to pass a single value we need to wrap in an array
    it.each(tests)("returns consistent values with node.js for %s", async (value, expected) => {
      const output = await checkSameOutput(`test_is_${kind}`, "[" + value + "]");
      expect(output).toBe(`napi_is_${kind} -> ${expected.toString()}`);
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

  it("handles napi_module_register called re-entrantly from nm_register_func", async () => {
    // The init callback of the first static-constructor-registered module
    // calls napi_module_register() 64 more times. Before the fix, that
    // appended to the same WTF::Vector the execute loop was range-for
    // iterating, reallocating it and leaving a dangling iterator for the
    // second static-constructor-registered module (heap-use-after-free
    // under ASAN, garbage nm_register_func pointer otherwise).
    const addonPath = join(__dirname, "napi-app", "build", "Debug", "reentrant_register_addon.node");
    await using proc = spawn({
      cmd: [bunExe(), "-e", `require(${JSON.stringify(addonPath)});`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.split(/\r?\n/).filter(Boolean)).toEqual([
      "register_cb_a",
      "register_cb_b",
      "register_cb_reentrant x 64",
    ]);
    expect(exitCode).toBe(0);
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

  it("napi_wrap finalizers run in LIFO order during env teardown", async () => {
    // Mirrors sqlite3/duckdb crash: a child wrapped after its parent must be finalized
    // first so its destructor can still touch the parent. Bun previously iterated an
    // unordered_set here, so order was hash-dependent and the child could see a freed parent.
    const code = `
      const addon = require(${JSON.stringify(join(__dirname, "napi-app/build/Debug/test_wrap_cleanup_order.node"))});
      globalThis.keep = addon.createParentAndChildren(32);
    `;
    await using proc = spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(
      "finalize order: " +
        Array.from({ length: 32 }, (_, i) => 32 - i)
          .concat(0)
          .join(" "),
    );
    expect(exitCode).toBe(0);
  });

  it("napi_create_error succeeds during env cleanup when a prior finalizer leaked a VM exception (#30286)", async () => {
    // Reproduces the gitnexus + tree-sitter crash: one finalizer left a
    // pending JSC exception on the VM, the next finalizer called
    // napi_create_error, and Bun returned napi_pending_exception. Under
    // node-addon-api's Error::New that turns into
    //   NAPI FATAL ERROR: Error::New napi_create_error
    // during web_worker.exitAndDeinit. After the fix napi_create_error
    // ignores pre-existing VM exceptions (matching Node.js) so the
    // finalizer completes cleanly and the process exits 0.
    const code = `
      const addon = require(${JSON.stringify(join(__dirname, "napi-app/build/Debug/test_finalizer_create_error.node"))});
      // A function that throws -- called from the first-to-run finalizer
      // so the throw leaves a JSC VM exception pending for the next
      // finalizer (the one that calls napi_create_error).
      globalThis.keep = addon.setup(() => { throw new Error("from js"); });
    `;
    await using proc = spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // napi_ok == 0 -- before the fix this was 10 (napi_pending_exception) in
    // release builds, or an ASAN abort in debug builds. A panic would leave
    // stdout empty, so the positive assertion covers both crash modes without
    // relying on stderr-contains-"panic" (which is unreliable per CLAUDE.md).
    expect(stdout.trim()).toBe("create_error_status=0");
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
  });

  it("the first napi finalizer starts clean when a cleanup hook leaked a VM exception (#30286)", async () => {
    // The node-canvas shape of #30286 (terminated Workers): a native
    // teardown callback fails internally, its scheduled exception gets
    // promoted onto the JSC VM (napi_call_function's prologue does this
    // before validating arguments), and the exception is still pending
    // when NapiEnv::cleanup() reaches the FIRST wrap finalizer. That
    // finalizer's first napi call (napi_create_string_utf8 in
    // node-addon-api's ObjectWrap teardown) then fails with
    // napi_pending_exception and the addon escalates to napi_fatal_error
    // ("Error::Error napi_create_object"). Cleanup hooks run before wrap
    // finalizers, so the addon's leaking hook reproduces the state
    // deterministically; the fix clears pending exceptions before the
    // finalizer phase starts.
    const code = `
      const addon = require(${JSON.stringify(join(__dirname, "napi-app/build/Debug/test_finalizer_create_error.node"))});
      globalThis.keep = addon.setupSingle();
    `;
    await using proc = spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The wrap finalizer prints the napi_create_error status; 0 == napi_ok.
    // Before the fix the finalizer's napi_create_string_utf8 failed on the
    // hook's leaked exception (status -110 on the string step).
    expect(stdout.trim()).toBe("create_error_status=0");
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
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

      // The marker must NOT have actually been printed. Only check stdout: the
      // fixture prints the marker via console.log (stdout), while stderr contains
      // the debug-build panic report whose "Args:" line echoes the full -e script
      // source, including the literal "ERROR: Did not crash! Test failed!".
      expect(bunStdout).not.toContain("ERROR: Did not crash");
    },
    25_000,
  );
});

// Kept outside describe.concurrent("napi") so RSS measurement isn't skewed by
// the other tests' subprocesses and doesn't add load to the --compile tests.
describe.skipIf(!canBuildNodeAddons())("napi_create_string_latin1", () => {
  it("does not leak the WTFStringImpl", async () => {
    const fixture = /* js */ `
      const nativeTests = require(${JSON.stringify(join(__dirname, "napi-app/build/Debug/napitests.node"))});
      const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
      const size = 256 * 1024;
      for (let i = 0; i < 20; i++) {
        const s = nativeTests.create_latin1_string(size);
        if (s.length !== size) throw new Error("wrong length: " + s.length);
      }
      Bun.gc(true);
      const before = rss();
      for (let i = 0; i < 300; i++) {
        const s = nativeTests.create_latin1_string(size);
        if (s.length !== size) throw new Error("wrong length: " + s.length);
      }
      Bun.gc(true);
      const growthMB = (rss() - before) / 1024 / 1024;
      console.error("RSS growth: " + growthMB.toFixed(1) + " MB");
      process.exit(growthMB > Number(process.env.THRESHOLD_MB) ? 1 : 0);
    `;
    // 300 iterations * 256 KiB = 75 MB if every WTFStringImpl leaks.
    // ASAN's quarantine inflates RSS; widen the threshold there.
    const thresholdMB = isASAN ? 48 : 24;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", fixture],
      env: { ...bunEnv, THRESHOLD_MB: String(thresholdMB) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("RSS growth:"),
      exitCode: 0,
    });
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
  const env = { ...bunEnv, ...envArgs };
  // "node" means a Node whose addon ABI matches the headers the fixture was
  // compiled against (the system node may lag the version Bun reports).
  if (executable === "node") executable = await nodeExeMatchingAbi();
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
      if (executable === "node") executable = await nodeExeMatchingAbi();
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

describe.skipIf(!canBuildNodeAddons())("cleanup hooks", () => {
  describe("execution order", () => {
    it("executes in reverse insertion order like Node.js", async () => {
      // Test that cleanup hooks execute in reverse insertion order (LIFO)
      await checkSameOutput("test_cleanup_hook_order", []);
    });
  });

  // Node frees the main thread's environment, which is what runs an addon's
  // cleanup hooks and the finalizers of everything it still has alive, only
  // after the event loop runs dry. process.exit() and a fatal error call exit()
  // instead, so an addon's teardown code never runs on those paths (Node
  // v26.3.0). Bun used to run it on every exit, calling into addons where Node
  // does not. Under BUN_DESTRUCT_VM_ON_EXIT (the sanitizer lanes set it for
  // every child) the main thread's VM is destroyed like a worker's, and the envs
  // are still torn down first, so these children opt out of it and of the leak
  // check that goes with it.
  describe.concurrent("env teardown on the main thread", () => {
    const noDestruct = {
      BUN_DESTRUCT_VM_ON_EXIT: "0",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    };
    const hooksAddon = join(__dirname, "napi-app/build/Debug/test_cleanup_hook_order.node");
    const wrapsAddon = join(__dirname, "napi-app/build/Debug/test_wrap_cleanup_order.node");
    // test() prints these two lines when called; each hook prints a line when it
    // runs. createParentAndChildren() prints "finalize order: ..." from the
    // parent's napi_wrap finalizer.
    const setupLines = ["Added hooks in order: 1, 2, 3", "They should execute in reverse order: 3, 2, 1"];
    const teardownLines = [
      ...setupLines,
      "hook3 executed at position 0",
      "hook2 executed at position 1",
      "hook1 executed at position 2",
      "finalize order: 1 0",
    ];
    const setup = `
      const hooks = require(${JSON.stringify(hooksAddon)});
      const wraps = require(${JSON.stringify(wrapsAddon)});
      hooks.test();
      globalThis.keep = wraps.createParentAndChildren(1);
    `;

    // Returns stdout as a sorted list of lines. The addons print with printf(),
    // which on Windows ends lines with \r\n and buffers each addon's output in
    // its own CRT until exit, so only the set of lines is stable there.
    async function run(code: string, env: Record<string, string>) {
      await using proc = spawn({
        cmd: [bunExe(), "-e", code],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { lines: stdout.split(/\r?\n/).filter(Boolean).sort(), stderr, exitCode };
    }

    it("process.exit() skips it, like Node", async () => {
      await checkSameOutput("test_env_teardown_skipped_by_process_exit", [], noDestruct);
    });

    it("an uncaught exception while the entry point runs skips it", async () => {
      const { lines, stderr, exitCode } = await run(`${setup}; throw new Error("fatal");`, noDestruct);
      expect(stderr).toContain("fatal");
      expect(lines).toEqual(setupLines.toSorted());
      expect(exitCode).toBe(1);
    });

    it("an uncaught exception from the event loop skips it", async () => {
      const { lines, stderr, exitCode } = await run(
        `${setup}; setTimeout(() => { throw new Error("fatal"); }, 1);`,
        noDestruct,
      );
      expect(stderr).toContain("fatal");
      expect(lines).toEqual(setupLines.toSorted());
      expect(exitCode).toBe(1);
    });

    it("an event loop that runs dry tears it down", async () => {
      const { lines, stderr, exitCode } = await run(setup, noDestruct);
      expect(stderr).toBe("");
      expect(lines).toEqual(teardownLines.toSorted());
      expect(exitCode).toBe(0);
    });

    it("process.exit() still tears it down when the VM is destroyed on exit", async () => {
      const { lines, stderr, exitCode } = await run(`${setup}; process.exit(0);`, { BUN_DESTRUCT_VM_ON_EXIT: "1" });
      expect(stderr).toBe("");
      expect(lines).toEqual(teardownLines.toSorted());
      expect(exitCode).toBe(0);
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

  describe("napi_instanceof", () => {
    it("honors Symbol.hasInstance and propagates exceptions", async () => {
      const output = await checkSameOutput("test_napi_instanceof", []);
      expect(output).toContain("class/instance: status=0 result=true pending=false");
      expect(output).toContain("class/plain-obj: status=0 result=false pending=false");
      expect(output).toContain("arrow+hasInstance: status=0 result=true pending=false");
      expect(output).toContain("bound+hasInstance: status=0 result=true pending=false");
      expect(output).toContain("bare-arrow ctor: status=9 result=false pending=true errName=TypeError");
      expect(output).toContain("hasInstance throws: status=9 result=false pending=true errName=RangeError");
      expect(output).toContain("proxy get throws: status=9 result=false pending=true errName=RangeError");
      expect(output).toContain(
        "number ctor: status=5 result=false pending=true errName=TypeError errCode=ERR_NAPI_CONS_FUNCTION",
      );
      expect(output).toContain(
        "plain-obj ctor: status=5 result=false pending=true errName=TypeError errCode=ERR_NAPI_CONS_FUNCTION",
      );
      expect(output).toContain("null ctor: status=2 result=false pending=true errName=TypeError errCode=undefined");
      expect(output).toContain(
        "undefined ctor: status=2 result=false pending=true errName=TypeError errCode=undefined",
      );
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

  describe("napi_new_instance", () => {
    it("returns the same status codes as Node.js for non-constructible targets", async () => {
      const output = await checkSameOutput(
        "test_napi_new_instance_status",
        "[() => {}, (() => {}).bind(null), 42, null, {}, function () {}]",
      );
      // arrow + bound arrow: napi_pending_exception with a pending TypeError
      expect(output).toContain("target 1: status=10 pending=1 type_error=1");
      expect(output).toContain("target 2: status=10 pending=1 type_error=1");
      // number / null / plain object: napi_invalid_arg, nothing thrown
      expect(output).toContain("target 3: status=1 pending=0 type_error=0");
      expect(output).toContain("target 4: status=1 pending=0 type_error=0");
      expect(output).toContain("target 5: status=1 pending=0 type_error=0");
      // regular function: napi_ok
      expect(output).toContain("target 6: status=0 pending=0 type_error=0");
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

  describe("NULL napi_value arguments", () => {
    it("returns napi_invalid_arg instead of crashing", async () => {
      const output = await checkSameOutput("test_napi_null_value_args", []);
      expect(output).toContain("napi_detach_arraybuffer(NULL) -> 1");
      expect(output).toContain("node_api_create_buffer_from_arraybuffer(NULL) -> 1");
      expect(output).toContain("napi_strict_equals(NULL, NULL) -> 1");
      expect(output).toContain("napi_instanceof(NULL, NULL) -> 1");
      expect(output).toContain("napi_new_instance(NULL) -> 1");
      expect(output).toContain("napi_is_array(NULL) -> 1");
      expect(output).toContain("napi_is_error(NULL) -> 1");
      expect(output).toContain("napi_is_arraybuffer(NULL) -> 1");
      expect(output).toContain("napi_is_dataview(NULL) -> 1");
      expect(output).toContain("napi_is_date(NULL) -> 1");
      expect(output).toContain("napi_get_array_length(NULL) -> 1");
      expect(output).toContain("napi_get_dataview_info(NULL) -> 1");
    });

    it("returns napi_invalid_arg for NULL env / NULL out-param instead of crashing", async () => {
      const output = await checkSameOutput("test_napi_null_env_and_result", []);
      expect(output).toContain("napi_typeof(NULL env) -> 1");
      expect(output).toContain("napi_is_exception_pending(NULL env) -> 1");
      expect(output).toContain("napi_call_function(NULL env) -> 1");
      expect(output).toContain("napi_is_error(NULL result) -> 1");
      expect(output).toContain("napi_async_init(NULL result) -> 1");
    });
  });

  describe("napi_typeof", () => {
    it("should handle empty/invalid values", async () => {
      const output = await checkSameOutput("test_napi_typeof_empty_value", []);
      // This test explores edge cases with empty/invalid napi_values
      // Bun has special handling for isEmpty() that Node doesn't have
      expect(output).toContain("napi_typeof");
    });

    it("should return napi_function for AsyncContextFrame in threadsafe callback", async () => {
      // Test for https://github.com/oven-sh/bun/issues/25933
      // When a threadsafe function is created inside AsyncLocalStorage.run(),
      // the callback gets wrapped in AsyncContextFrame. napi_typeof must
      // report it as napi_function, not napi_object.
      const output = await checkSameOutput("test_napi_typeof_async_context_frame", []);
      expect(output).toContain("PASS: napi_typeof returned napi_function");
    });

    it("should handle AsyncContextFrame in napi_make_callback", async () => {
      // When a threadsafe function's call_js_cb receives an AsyncContextFrame
      // as js_callback and passes it to napi_make_callback, it should succeed.
      const output = await checkSameOutput("test_make_callback_with_async_context", []);
      expect(output).toContain("PASS: napi_make_callback succeeded");
    });

    it("derives napi_make_callback status from pending exception, not return value", async () => {
      // Returning an Error is napi_ok; throwing (any value) is napi_pending_exception
      // and leaves the exception observable to napi_is_exception_pending.
      const output = await checkSameOutput(
        "test_napi_make_callback_status",
        "[() => 42, () => new Error('returned'), () => { throw new Error('thrown'); }, () => { throw 'string'; }]",
      );
      expect(output).toContain("cb 1: status=0 pending=0 wrote_result=1 result_is_error=0");
      expect(output).toContain("cb 2: status=0 pending=0 wrote_result=1 result_is_error=1");
      expect(output).toContain("cb 3: status=10 pending=1 wrote_result=0 result_is_error=0");
      expect(output).toContain("cb 4: status=10 pending=1 wrote_result=0 result_is_error=0");
    });

    it("should accept AsyncContextFrame in napi_create_threadsafe_function with null call_js_cb", async () => {
      // When a threadsafe function's call_js_cb receives an AsyncContextFrame
      // and passes it to a second napi_create_threadsafe_function with
      // call_js_cb=NULL, it should not reject with function_expected.
      const output = await checkSameOutput("test_create_tsfn_with_async_context", []);
      expect(output).toContain("PASS: napi_create_threadsafe_function accepted AsyncContextFrame");
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

  describe("object API ToObject coercion", () => {
    // The element/property-name/prototype family must coerce primitive targets
    // via ToObject (succeeding for strings/numbers/booleans) and return
    // napi_object_expected with a pending TypeError for null/undefined.
    // napi_get_all_property_names must reject out-of-range enum arguments and
    // honor napi_key_keep_numbers so index keys come back as numbers.
    it("matches Node's CHECK_TO_OBJECT semantics and validates enums", async () => {
      const output = await checkSameOutput("test_napi_object_coercion", []);
      // Spot-check the lines that carry the most signal; checkSameOutput has
      // already asserted full byte-for-byte parity with Node.
      expect(output).toContain("set_element(number): status=0 pending=0");
      expect(output).toContain("set_element(null): status=2 pending=1");
      expect(output).toContain("get_element(string,1): status=0 pending=0");
      expect(output).toContain("get_element(string,1) value=b");
      expect(output).toContain("get_prototype(number): status=0 pending=0");
      expect(output).toContain("get_prototype(number) is Number.prototype=1");
      expect(output).toContain("get_prototype(null): status=2 pending=1");
      expect(output).toContain("get_all_property_names(key_mode=99): status=1 pending=0");
      expect(output).toContain("get_all_property_names(key_conversion=99): status=1 pending=0");
      expect(output).toContain("keep_numbers key0 typeof=number");
      expect(output).toContain("numbers_to_strings key0 typeof=string");
    });

    it("coerces primitives for define_properties/freeze/seal/type_tag/set_prototype", async () => {
      const output = await checkSameOutput("test_napi_toobject_coercion_node26", []);
      expect(output).toContain("define_properties(number): status=0 pending=0");
      expect(output).toContain("define_properties(null): status=2 pending=1");
      expect(output).toContain("object_freeze(number): status=0 pending=0");
      expect(output).toContain("object_freeze(null): status=2 pending=1");
      expect(output).toContain("object_seal(number): status=0 pending=0");
      expect(output).toContain("object_seal(undefined): status=2 pending=1");
      expect(output).toContain("type_tag_object(number): status=0 pending=0");
      expect(output).toContain("type_tag_object(null): status=10 pending=1");
      expect(output).toContain("check_object_type_tag(number): status=0 pending=0");
      expect(output).toContain("check_object_type_tag(null): status=10 pending=1");
      expect(output).toContain("node_api_set_prototype(number): status=0 pending=0");
      expect(output).toContain("node_api_set_prototype(null): status=2 pending=1");
    });
  });

  describe("napi_get_prototype", () => {
    it("returns null for a Proxy without running its getPrototypeOf trap, like Node", async () => {
      // Before this was special-cased, Bun ran the trap: a proxy without traps
      // reported its target's prototype, and a throwing trap reported napi_ok
      // with a NULL handle written to *result and the exception left pending.
      const output = await checkSameOutput("test_napi_get_prototype_proxy", []);
      // checkSameOutput already asserted parity with Node; pin the values so a
      // shared failure cannot pass.
      expect(output.split(/\r?\n/)).toEqual([
        "plain object: status=0 pending=false result=Object.prototype exception=none",
        "null prototype: status=0 pending=false result=null exception=none",
        "proxy without traps: status=0 pending=false result=null exception=none",
        "callable proxy: status=0 pending=false result=null exception=none",
        "trap returns Array.prototype: status=0 pending=false result=null exception=none",
        "getPrototypeOf trap calls: 0",
        "trap throws: status=0 pending=false result=null exception=none",
        "trap returns a number: status=0 pending=false result=null exception=none",
        "revoked proxy: status=0 pending=false result=null exception=none",
        "object whose prototype is a proxy: status=0 pending=false result=the proxy exception=none",
        "plain object again: status=0 pending=false result=Object.prototype exception=none",
      ]);
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

  describe("napi_is_arraybuffer", () => {
    it("distinguishes ArrayBuffer from SharedArrayBuffer and typed arrays", async () => {
      // https://github.com/oven-sh/bun/issues/32624
      // napi_is_arraybuffer must report false for a SharedArrayBuffer the way
      // Node does, even though JSC gives it the same cell type as a plain
      // ArrayBuffer. napi_get_arraybuffer_info still accepts a SharedArrayBuffer
      // in Node (napi_ok), so the check below pins that asymmetry too.
      // napi_ok is 0 and napi_invalid_arg is 1.
      const output = await checkSameOutput(
        "test_is_arraybuffer",
        "[new ArrayBuffer(8), new SharedArrayBuffer(8), new Uint8Array(8)]",
      );
      // printf() via the Windows CRT emits \r\n, so split on either ending.
      expect(output.split(/\r?\n/)).toEqual([
        "napi_is_arraybuffer=true napi_get_arraybuffer_info=0",
        "napi_is_arraybuffer=false napi_get_arraybuffer_info=0",
        "napi_is_arraybuffer=false napi_get_arraybuffer_info=1",
      ]);
    });
  });

  describe("napi_detach_arraybuffer", () => {
    it("rejects SharedArrayBuffer instead of returning napi_ok for a no-op detach", async () => {
      // napi_ok on a SharedArrayBuffer is a memory-lifetime lie: the addon
      // believes the backing store is neutralized while JS (and other threads)
      // still read and write it. Node rejects a SharedArrayBuffer with
      // napi_arraybuffer_expected (19) because V8's IsArrayBuffer() is false
      // for a SharedArrayBuffer. The same ArrayBuffer is passed twice so the
      // third row covers a second detach on an already-detached buffer.
      const output = await checkSameOutput(
        "test_detach_arraybuffer",
        "(() => { const ab = new ArrayBuffer(8); return [new SharedArrayBuffer(8), ab, ab, new Uint8Array(8)]; })()",
      );
      expect(output.split(/\r?\n/)).toEqual([
        "napi_detach_arraybuffer=19 napi_is_detached_arraybuffer=0 is_detached=false napi_get_arraybuffer_info=0 length=8",
        "napi_detach_arraybuffer=0 napi_is_detached_arraybuffer=0 is_detached=true napi_get_arraybuffer_info=0 length=0",
        "napi_detach_arraybuffer=0 napi_is_detached_arraybuffer=0 is_detached=true napi_get_arraybuffer_info=0 length=0",
        "napi_detach_arraybuffer=19 napi_is_detached_arraybuffer=0 is_detached=false napi_get_arraybuffer_info=1 length=0",
      ]);
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

    it("hook handle stays valid until the addon removes it (#37201)", async () => {
      // An async cleanup hook releases a threadsafe function whose finalizer
      // then calls napi_remove_async_cleanup_hook; the handle must not be
      // freed when the hook returns.
      const output = await checkSameOutput("test_async_cleanup_hook_tsfn_release", []);
      // Pin the successful lifecycle, so matching Node on a shared failure
      // (non-zero status in both) cannot pass. printf() via the Windows CRT
      // emits \r\n, so split on either ending.
      expect(output.split(/\r?\n/).slice(-4)).toEqual([
        "async cleanup hook fired",
        "released tsfn: status=0",
        "tsfn finalize: removing async cleanup hook",
        "async cleanup hook removed: status=0",
      ]);
    });
  });

  describe("duplicate prevention", () => {
    it("should crash on duplicate hooks", async () => {
      await checkBothFail("test_cleanup_hook_duplicates", []);
    }, 10_000);
  });
});
