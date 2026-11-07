import { spawn } from "bun";
import { jscDescribe } from "bun:jsc";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  bunEnv,
  bunExe,
  canBuildNodeAddons,
  expectRssDeltaBelow,
  isASAN,
  isBroken,
  isDebug,
  isMusl,
  isWindows,
  nodeExeAtLeast,
  nodeExeMatchingAbi,
  tempDir,
  tmpdirSync,
} from "harness";
import assert from "node:assert";
import fs from "node:fs/promises";
import { basename, join } from "path";

enum Runtime {
  node,
  bun,
}

enum BuildMode {
  debug,
  release,
}

// clang-cl does not work on Windows with node-gyp 10.2.0, so we should not let that affect the
// test environment
delete bunEnv.CC;
delete bunEnv.CXX;

// Node.js 26.3.0 requires C++20
bunEnv.CXXFLAGS ??= "";
if (process.platform == "darwin") {
  bunEnv.CXXFLAGS += " -std=gnu++20";
} else {
  bunEnv.CXXFLAGS += " -std=c++20";
}
// https://github.com/isaacs/node-tar/blob/bef7b1e4ffab822681fea2a9b22187192ed14717/lib/get-write-flag.js
// prevent node-tar from using UV_FS_O_FILEMAP
if (process.platform == "win32") {
  bunEnv.__FAKE_PLATFORM__ = "linux";
}

const srcDir = join(__dirname, "v8-module");
const directories = {
  bunRelease: "",
  bunDebug: "",
  node: "",
  badModules: "",
};

async function install(srcDir: string, tmpDir: string, runtime: Runtime): Promise<void> {
  await fs.cp(srcDir, tmpDir, { recursive: true, force: true });
  const install = spawn({
    cmd: [bunExe(), "install", "--ignore-scripts"],
    cwd: tmpDir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await install.exited;
  if (exitCode !== 0) {
    throw new Error(`install failed: ${exitCode}`);
  }
}

async function build(srcDir: string, tmpDir: string, runtime: Runtime, buildMode: BuildMode): Promise<void> {
  const build = spawn({
    cmd:
      runtime == Runtime.bun
        ? [
            bunExe(),
            "--bun",
            "run",
            "node-gyp",
            "rebuild",
            buildMode == BuildMode.debug ? "--debug" : "--release",
            "-j",
            "max",
          ]
        : // for node.js we don't bother with debug mode. Run node-gyp under bun
          // (--bun) here too: a clang-cl-built Node carries thin-LTO flags in
          // process.config.target_defaults that node-gyp copies into
          // config.gypi and MSVC's link.exe chokes on (/opt:lldltojobs) — gyp
          // -D defines can't override target_defaults. Bun reports the same
          // ABI (147) with clean target_defaults, so the module loads in
          // node 26 all the same.
          [bunExe(), "--bun", "run", "node-gyp", "rebuild", "--release", "-j", "max"],
    cwd: tmpDir,
    env: bunEnv,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, out, err] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    console.error(err);
    console.log(out);
    console.error(`build failed: ${exitCode}, bailing out`);
    process.exit(1);
  }

  const description = `build ${basename(srcDir)} with ${Runtime[runtime]} in ${BuildMode[buildMode]} mode`;

  console.log(description, "stdout:");
  console.log(out);
  console.log(description, "stderr:");
  console.log(err);
}

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("node:v8", () => {
  beforeAll(async () => {
    // set up clean directories for our 4 builds
    directories.bunRelease = tmpdirSync();
    directories.bunDebug = tmpdirSync();
    directories.node = tmpdirSync();
    directories.badModules = tmpdirSync();

    await install(srcDir, directories.bunRelease, Runtime.bun);
    await install(srcDir, directories.bunDebug, Runtime.bun);
    await install(srcDir, directories.node, Runtime.node);
    await install(join(__dirname, "bad-modules"), directories.badModules, Runtime.node);

    await build(srcDir, directories.bunRelease, Runtime.bun, BuildMode.release);
    await build(srcDir, directories.bunDebug, Runtime.bun, BuildMode.debug);
    await build(srcDir, directories.node, Runtime.node, BuildMode.release);
    await build(join(__dirname, "bad-modules"), directories.badModules, Runtime.node, BuildMode.release);

    // Resolve (and possibly download) the ABI-matching node here, under the
    // generous hook timeout, instead of inside the first test that needs it.
    await nodeExeMatchingAbi();
  }, 600_000);

  describe("module lifecycle", () => {
    it("can call a basic native function", async () => {
      await checkSameOutput("test_v8_native_call");
    });
  });

  describe("node::AddEnvironmentCleanupHook", () => {
    it("runs the hooks last added first when the main thread ends, except the ones that were removed", async () => {
      const output = await checkSameOutput("test_v8_cleanup_hooks");
      expect(output.split(/\r?\n/)).toEqual([
        "the script ends",
        "cleanup hook removed and added again",
        "cleanup hook added last",
        "cleanup hook that created a string",
        "cleanup hook that adds another one",
        "cleanup hook that removes another one",
        "cleanup hook added first",
        "cleanup hook added by a hook",
      ]);
    });

    it("runs no hook after process.exit() on the main thread", async () => {
      const output = await checkSameOutput("test_v8_cleanup_hooks_after_process_exit");
      expect(output).toBe("process.exit() is next");
    });

    it.each(["the end of its script", "process.exit()", "worker.terminate()", "an uncaught error"])(
      "runs the hooks of a Worker last added first when the Worker ends with %s",
      async end => {
        const output = await checkSameOutput("test_v8_cleanup_hooks_of_worker", JSON.stringify([end]));
        expect(output.split(/\r?\n/)).toEqual([
          "cleanup hook 3",
          "cleanup hook 2",
          "cleanup hook 1",
          "the Worker has exited",
        ]);
      },
    );

    it("runs a hook again when it adds itself again while it runs", async () => {
      const lines = [1, 2, 3].map(run => `cleanup hook that adds itself again: run ${run}`);
      const expected = lines.join("\n");
      expect(await runOnBun("add_a_cleanup_hook_that_adds_itself_again")).toEqual([expected, expected]);
      // Node aborts there before 26.11.0, and the Node of a CI host can be older than the one whose headers the addon is built with.
      if (nodeExeAtLeast("26.11.0")) {
        const output = await checkSameOutput("add_a_cleanup_hook_that_adds_itself_again");
        expect(output.split(/\r?\n/)).toEqual(lines);
      }
    });

    // Bun only: Node aborts at the second Add. `bun --hot` and a second process.dlopen run the initializer of an addon again, which adds its hooks again.
    it("keeps a hook in its place and runs it once when it is added twice", async () => {
      const expected = "cleanup hook added second\ncleanup hook added first, and again after the second";
      expect(await runOnBun("add_a_cleanup_hook_twice")).toEqual([expected, expected]);
    });

    it("runs the next hook when a hook has thrown", async () => {
      const output = await checkSameOutput(
        "add_cleanup_hooks_that_throw_and_read",
        `[{ name: "the name of an object" }]`,
      );
      expect(output.split(/\r?\n/)).toEqual([
        "cleanup hook that throws",
        "cleanup hook that reads a property: the name of an object",
      ]);
    });

    // Bun only: Node looks for the environment of the isolate.
    it("does not read the isolate that Add and Remove are called with", async () => {
      const expected = "cleanup hook added without an isolate";
      expect(await runOnBun("add_and_remove_cleanup_hooks_without_an_isolate")).toEqual([expected, expected]);
    });

    // Bun only: Node calls the null function, and looks for an environment on the thread of the addon.
    it("ignores a null function, and a hook that a thread without an environment adds", async () => {
      expect(await runOnBun("add_cleanup_hooks_that_are_ignored")).toEqual(["", ""]);
    });

    // Bun only: Node stops and joins the inner Worker before it runs the hooks of the outer one, so it prints these the other way around.
    it("runs the hooks of a Worker while a Worker that it started still runs", async () => {
      const expected = [
        "cleanup hook of the outer Worker",
        "cleanup hook 3",
        "cleanup hook 2",
        "cleanup hook 1",
        "the outer Worker has exited",
      ].join("\n");
      expect(await runOnBun("test_v8_cleanup_hooks_of_nested_workers")).toEqual([expected, expected]);
    });

    const wrapsDestroyed = (created: number, before: number, byOwner: number) => [
      `wraps: ${created} created, ${before} destroyed before the end, ${created - before - byOwner} by their hooks, ${byOwner} by the hook of their owner, 0 left`,
      "hooks ran newest first: yes",
      "each wrap was destroyed once: yes",
    ];

    it("destroys every node::ObjectWrap once, newest first, when the main thread ends", async () => {
      const output = await checkSameOutput("test_v8_object_wrap_cleanup_hooks");
      expect(output.split(/\r?\n/)).toEqual(["the script ends", ...wrapsDestroyed(1000, 143, 71)]);
    });

    it("destroys every node::ObjectWrap once, newest first, when a Worker ends", async () => {
      const output = await checkSameOutput("test_v8_object_wrap_cleanup_hooks_of_worker");
      expect(output.split(/\r?\n/)).toEqual([...wrapsDestroyed(1000, 143, 71), "the Worker has exited"]);
    });

    // Each wrap adds a hook and removes it. With a list that was searched for each of them, four times the wraps took 16 times as long.
    it("adds and runs the hooks of four times as many node::ObjectWrap instances in less than eight times the time", async () => {
      // A debug or ASAN build needs 40 times as long as a release build to end the Worker that makes the wraps.
      const few = isDebug || isASAN ? 2_500 : 20_000;
      const output = await runOn(Runtime.bun, BuildMode.release, "test_v8_object_wrap_cleanup_hooks_cost", `[${few}]`);
      const lines = output
        .replaceAll(/^\[\w+\].+$/gm, "")
        .trim()
        .split(/\r?\n/);
      const { withFew, withMany } = JSON.parse(lines.pop()!);
      // The second Worker counts the wraps of the first one too.
      expect(lines).toEqual([...wrapsDestroyed(few, 0, 0), ...wrapsDestroyed(5 * few, 0, 0)]);
      // Below a 64th of a second, the time is that of the Worker and not of its wraps.
      expect(withMany / Math.max(withFew, 1 / 64)).toBeLessThan(8);
    });

    // Bun only. Each source is a file of `bun test --isolate`, which loads the addon. `bun test` ends with a requested
    // exit, after which the hooks only run if the VM is destroyed.
    async function hooksOfIsolatedFiles(sources: string[], env = {}) {
      const addon = JSON.stringify(join(directories.bunRelease, "build", "Release", "v8tests.node"));
      const names = sources.map((_, i) => `file-${i + 1}.test.js`);
      const files = sources.map((source, i) => [
        names[i],
        `const addon = require(${addon});\nimport { test } from "bun:test";\n${source}`,
      ]);
      using dir = tempDir("v8-cleanup-hooks-isolate", Object.fromEntries(files));
      await using proc = spawn({
        cmd: [bunExe(), "test", "--isolate", ...names.map(name => `./${name}`)],
        env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { hooks: stdout.split(/\r?\n/).filter(line => line.startsWith("cleanup hook")), stderr, exitCode };
    }

    it("drops the hooks of a file of bun test --isolate when the file is done", async () => {
      const { hooks, stderr, exitCode } = await hooksOfIsolatedFiles(
        ["first", "second"].map(
          name => `test("adds a cleanup hook", () => {
            addon.add_cleanup_hooks("of the ${name} file");
          });`,
        ),
      );
      expect(hooks, stderr).toEqual(["cleanup hook of the second file"]);
      expect(exitCode).toBe(0);
    });

    it("gives a hook to the file of bun test --isolate that adds it, whichever isolate the file adds it through", async () => {
      const { hooks, stderr, exitCode } = await hooksOfIsolatedFiles(
        [
          // On a debug build the realm of the first file is never collected: a listener of its process object is a root.
          `test("loads the addon", () => {});`,
          `test("saves its isolate", () => {
            addon.save_isolate();
          });`,
          `test("adds a hook through the isolate of the second file", () => {
            addon.add_cleanup_hooks_through_saved_isolate("that the third file added through the isolate of the second");
          });`,
          `test("adds hooks once the realm of the second file is collected", () => {
            Bun.gc(true);
            addon.add_cleanup_hooks("of the fourth file");
            addon.add_cleanup_hooks_through_saved_isolate("that the fourth file added through the isolate of the second");
          });`,
        ],
        // A read of a collected realm then crashes.
        { BUN_JSC_useZombieMode: "1" },
      );
      expect(hooks, stderr).toEqual([
        "cleanup hook that the fourth file added through the isolate of the second",
        "cleanup hook of the fourth file",
      ]);
      expect(exitCode).toBe(0);
    });
  });

  describe("primitives", () => {
    it("can create and distinguish between null, undefined, true, and false", async () => {
      await checkSameOutput("test_v8_primitives");
    });
  });

  describe("Value type checks", () => {
    it("Math.fround returns a double-encoded value", () => {
      // If this fails, you need to find a new way to make a JSValue which uses the double encoding
      // but holds an int32 value (maybe Float64Array?)
      expect(jscDescribe(Math.fround(1))).toBe("Double: 4607182418800017408, 1.000000");
    });

    it.each([
      // Each entry should eval() to an array of arguments
      "[new Map()]",
      "[[]]",
      "[42]",
      "[2 ** 31 - 1]", // INT32_MAX
      "[2 ** 31]", // INT32_MAX + 1 (should not be Int32)
      "[-(2 ** 31)]", // INT32_MIN
      "[-(2 ** 31) - 1]", // INT32_MIN - 1 (should not be Int32)
      "[2 ** 32 - 1]", // UINT32_MAX
      "[2 ** 32]", // UINT32_MAX + 1
      "[Math.fround(1)]", // Value represented as a double but whose numeric value fits in the int32 range (should be int32)
      "[123n]",
      "[3.14]",
      "['string']",
      "[{}]",
      "[new (class extends Array {})()]",
      "[new Proxy([], {})]",
      "[new Proxy(new Map(), {})]",
      "[(() => { const { proxy, revoke } = Proxy.revocable([], {}); revoke(); return proxy; })()]",
    ])("matches Node for IsMap/IsArray/IsInt32/IsBigInt on %s", async args => {
      await checkSameOutput("test_v8_value_type_checks", args);
    });
  });
  describe("Number", () => {
    it("can create small integer", async () => {
      await checkSameOutput("test_v8_number_int");
    });
    // non-i32 v8::Number is not implemented yet
    it("can create large integer", async () => {
      await checkSameOutput("test_v8_number_large_int");
    });
    it("can create fraction", async () => {
      await checkSameOutput("test_v8_number_fraction");
    });
  });

  describe("String", () => {
    it("can create and read back strings with only ASCII characters", async () => {
      await checkSameOutput("test_v8_string_ascii");
    });
    // non-ASCII strings are not implemented yet
    it("can create and read back strings with UTF-8 characters", async () => {
      await checkSameOutput("test_v8_string_utf8");
    });
    it("handles replacement correctly in strings with invalid UTF-8 sequences", async () => {
      await checkSameOutput("test_v8_string_invalid_utf8");
    });
    it("can create strings from null-terminated Latin-1 data", async () => {
      await checkSameOutput("test_v8_string_latin1");
    });
    describe("WriteUtf8", () => {
      it("truncates the string correctly", async () => {
        await checkSameOutput("test_v8_string_write_utf8");
      });
      it("encodes an astral character that doesn't fit the same way V8 does", async () => {
        await checkSameOutput("test_v8_string_write_utf8_surrogate");
      });
    });
  });

  describe("External", () => {
    it("can create an external and read back the correct value", async () => {
      await checkSameOutput("test_v8_external");
    });
  });

  describe("Value", () => {
    it("can compare values using StrictEquals", async () => {
      await checkSameOutput("test_v8_strict_equals");
    });
  });

  describe("Object", () => {
    it("can create an object and set properties", async () => {
      await checkSameOutput("test_v8_object");
    });
    it("can get properties by key using Object::Get(context, key)", async () => {
      await checkSameOutput("test_v8_object_get_by_key");
    });
    it("can get array elements by index using Object::Get(context, index)", async () => {
      await checkSameOutput("test_v8_object_get_by_index");
    });
    it("correctly handles exceptions from get and set", async () => {
      await checkSameOutput("test_v8_object_get_set_exceptions");
    });
  });
  describe("Array", () => {
    it("can create an array from a C array of Locals", async () => {
      await checkSameOutput("test_v8_array_new");
    });
    it("can create an array with a specific length", async () => {
      await checkSameOutput("test_v8_array_new_with_length");
    });
    it("can create an array from a callback", async () => {
      await checkSameOutput("test_v8_array_new_with_callback");
    });
    it("correctly reports array length", async () => {
      await checkSameOutput("test_v8_array_length");
    });
    it("can iterate over array elements with callbacks", async () => {
      await checkSameOutput("test_v8_array_iterate");
    });
  });

  describe("ObjectTemplate", () => {
    it("creates objects with internal fields", async () => {
      await checkSameOutput("test_v8_object_template");
    });
    it("frees the internal fields of collected instances", async () => {
      await expectRssDeltaBelow(
        ["--smol", join(directories.bunRelease, "main.js"), "test_v8_internal_field_object_leak", "[]", "null"],
        { release: 40, debug: 55 },
      );
    });
  });

  describe("FunctionTemplate", () => {
    it("keeps the data parameter alive", async () => {
      await checkSameOutput("test_v8_function_template");
    });
    it("SetClassName propagates to GetFunction result", async () => {
      const out = await checkSameOutput("test_v8_function_template_set_class_name");
      expect(out).toContain("MyNamedClass");
    });
  });

  describe("Function", () => {
    it("correctly receives all its arguments from JS", async () => {
      await checkSameOutput("print_values_from_js", "[5.0, true, null, false, 'async meow', {}]");
      await checkSameOutput("print_native_function");
    });

    it("correctly receives the this value from JS", async () => {
      await checkSameOutput("call_function_with_weird_this_values");
    });

    it("receives globalThis as this when called bare through a closure", async () => {
      const output = await checkSameOutput("call_function_bare_through_closure");
      expect(output).toContain("bare call returned globalThis: true");
    });
  });

  describe("error handling", () => {
    it("throws an error for modules built using the wrong ABI version", () => {
      expect(() => require(join(directories.badModules, "build/Release/mismatched_abi_version.node"))).toThrow(
        "The module 'mismatched_abi_version' was compiled against a different Node.js ABI version using NODE_MODULE_VERSION 42.",
      );
    });

    it("throws an error for modules with no entrypoint", () => {
      expect(() => require(join(directories.badModules, "build/Release/no_entrypoint.node"))).toThrow(
        "The module 'no_entrypoint' has no declared entry point.",
      );
    });
  });

  describe("Global", () => {
    it("can create, modify, and read the value from global handles", async () => {
      await checkSameOutput("test_v8_global");
    });
  });

  describe("HandleScope", () => {
    it("can hold a lot of locals", async () => {
      await checkSameOutput("test_many_v8_locals");
    });
    // Skip on ASAN: false positives due to dynamic library boundary crossing where
    // Bun is built with ASAN+UBSAN but the native addon is not
    it.skipIf(isASAN)(
      "keeps GC objects alive",
      async () => {
        await checkSameOutput("test_handle_scope_gc");
      },
      10000,
    );
  });

  describe("EscapableHandleScope", () => {
    it("keeps handles alive in the outer scope", async () => {
      await checkSameOutput("test_v8_escapable_handle_scope");
    });

    it("escaped handles survive in-scope inline handle creation", async () => {
      await checkSameOutput("test_v8_escapable_handle_scope_inline_grants");
    });

    it("inline handles survive a nested call's scope push/pop", async () => {
      await checkSameOutput("test_v8_locals_survive_nested_call");
    });
  });

  describe("ReturnValue", () => {
    it("keeps the returned value alive when the scope it was created in closes", async () => {
      await checkSameOutput("test_v8_return_value_from_inner_scope");
    });
  });

  describe("MaybeLocal", () => {
    it("correctly handles ToLocal and ToLocalChecked operations", async () => {
      await checkSameOutput("test_v8_maybe_local");
    });
  });

  describe("Integer", () => {
    it("can create and read back int32 values", async () => {
      await checkSameOutput("test_v8_integer");
    });
  });

  // https://github.com/oven-sh/bun/issues/42195
  describe("Function script origin", () => {
    it("reports the file, line, and column of a JS function", async () => {
      const out = await checkSameOutput("test_v8_function_script_origin");
      expect(out).toContain("file: module.js");
    });
  });

  describe("Value::ToInt32", () => {
    it("converts values like the JS ToInt32 operation", async () => {
      await checkSameOutput("test_v8_value_to_int32");
    });
  });

  describe("Object::DefineOwnProperty", () => {
    it("applies PropertyAttribute flags to the defined property", async () => {
      await checkSameOutput("test_v8_define_own_property");
    });
  });

  describe("BigInt", () => {
    it("BigInt::New creates a JS bigint with the given int64 value", async () => {
      await checkSameOutput("test_v8_bigint");
    });
  });

  describe("String::NewFromUtf8Literal", () => {
    it("creates strings from C string literals (ASCII and UTF-8)", async () => {
      await checkSameOutput("test_v8_string_from_utf8_literal");
    });
  });

  describe("PrototypeTemplate / Template::Set / SetNativeDataProperty", () => {
    it("prototype methods and native accessors are reachable on instances", async () => {
      await checkSameOutput("test_v8_prototype_template");
    });

    it("native accessor callbacks see the object as their holder on property access", async () => {
      const output = await checkSameOutput("native_accessor_holder_on_property_access");
      expect(output).toBe(["getter holder is the object: true", "setter holder is the object: true"].join("\n"));
    });

    // Only Bun exposes a native data property's getter and setter as callable functions, so this
    // cannot be compared against Node: the receiver has to be converted the way a sloppy-mode
    // function would, in particular a bare call through a closure must not hand the accessor the
    // scope object JSC leaves in the this slot.
    it("native accessor callbacks get a sloppy-mode holder when called as functions", async () => {
      const expected = [
        "bare getter(): globalThis",
        "getter.call(undefined): globalThis",
        "getter.call(null): globalThis",
        "getter.call(5): a Number object",
        "getter.call(obj): the object",
        "bare setter(): globalThis",
        "setter.call(undefined): globalThis",
        "setter.call(null): globalThis",
        "setter.call(5): a Number object",
        "setter.call(obj): the object",
      ].join("\n");
      for (const buildMode of [BuildMode.release, BuildMode.debug]) {
        const output = await runOn(Runtime.bun, buildMode, "native_accessor_holder_for_weird_receivers");
        expect(output.replaceAll(/^\[\w+\].+$/gm, "").trim(), `addon built in ${BuildMode[buildMode]} mode`).toBe(
          expected,
        );
      }
    });
  });

  describe("ArrayBuffer / TypedArray", () => {
    it("can create an ArrayBuffer and read through its BackingStore", async () => {
      await checkSameOutput("test_v8_arraybuffer");
    });
    it("can create Uint8Array/Uint32Array views with offset and length", async () => {
      await checkSameOutput("test_v8_typedarray");
    });
  });

  describe("Function::Call / NewInstance", () => {
    it("Function::Call forwards recv and argv", async () => {
      await checkSameOutput("test_v8_function_call");
    });
    it("Function::NewInstance constructs via a FunctionTemplate", async () => {
      await checkSameOutput("test_v8_function_new_instance");
    });
    it("FunctionTemplate::GetFunction returns the same function on repeat calls", async () => {
      await checkSameOutput("test_v8_getfunction_memoized");
    });
  });

  describe("Map", () => {
    it("Map::Set and Map::Delete mutate the underlying JS Map", async () => {
      await checkSameOutput("test_v8_map");
    });
  });

  describe("Exception", () => {
    it("Exception::Error/TypeError create throwable Error objects", async () => {
      await checkSameOutput("test_v8_exception");
    });
    it("Exception::Error/TypeError accept an empty message", async () => {
      const output = await checkSameOutput("test_v8_exception_empty_message");
      expect(output).toBe(['Error message = "" own = true', 'TypeError message = "" own = true'].join("\n"));
    });
    it("Isolate::ThrowError accepts an empty message", async () => {
      const output = await checkSameOutput("test_v8_throw_error_empty_message");
      expect(output).toBe('caught Error message = "" own = true');
    });
    it("Array, Uint8Array, Uint32Array and BigInt ::New work while an exception is pending", async () => {
      const output = await checkSameOutput("test_v8_new_values_with_pending_exception");
      expect(output).toEndWith("caught pending");
    });
  });

  describe("Aligned internal fields", () => {
    it("round-trips pointers through Set/GetAlignedPointerInInternalField", async () => {
      await checkSameOutput("test_v8_aligned_pointer_in_internal_field");
    });
  });

  describe("CpuProfiler", () => {
    it("Start/Stop returns a profile with a root node", async () => {
      await checkSameOutput("test_v8_cpu_profiler");
    });
    it("accepts overlapping sessions and returns a profile for each", async () => {
      // Regression test for dd-trace's profiler, which calls Start() for the
      // next cycle before Stop() of the current one (see @datadog/pprof).
      await checkSameOutput("test_v8_cpu_profiler_overlapping_sessions");
    });
    it("StartProfiling/StopProfiling key sessions by title and GetTitle returns it", async () => {
      // google's pprof addon uses the title-keyed overloads (#19678).
      await checkSameOutput("test_v8_cpu_profiler_title_api");
    });
  });

  describe("uv_os_getpid", () => {
    it.skipIf(isWindows)("returns the same result as getpid on POSIX", async () => {
      await checkSameOutput("test_uv_os_getpid");
    });
  });

  describe("uv_os_getppid", () => {
    it.skipIf(isWindows)("returns the same result as getppid on POSIX", async () => {
      await checkSameOutput("test_uv_os_getppid");
    });
  });

  describe("uv_queue_work", () => {
    // TODO: on Windows libuv calls after_work_cb with no handle scope open, so creating a handle aborts.
    it.skipIf(isWindows)("runs on node::GetCurrentEventLoop and after_work_cb can use a v8::HandleScope", async () => {
      await checkSameOutput("test_uv_queue_work_on_current_event_loop");
    });
  });
});

async function checkSameOutput(testName: string, args?: string, thisValue?: any) {
  const [nodeResultResolution, bunReleaseResultResolution, bunDebugResultResolution] = await Promise.allSettled([
    runOn(Runtime.node, BuildMode.release, testName, args, thisValue),
    runOn(Runtime.bun, BuildMode.release, testName, args, thisValue),
    runOn(Runtime.bun, BuildMode.debug, testName, args, thisValue),
  ]);
  const errors = [nodeResultResolution, bunReleaseResultResolution, bunDebugResultResolution]
    .filter(r => r.status === "rejected")
    .map(r => r.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors);
  }
  let [nodeResult, bunReleaseResult, bunDebugResult] = [
    nodeResultResolution,
    bunReleaseResultResolution,
    bunDebugResultResolution,
  ].map(r => (r as any).value);
  // remove all debug logs
  bunReleaseResult = bunReleaseResult.replaceAll(/^\[\w+\].+$/gm, "").trim();
  bunDebugResult = bunDebugResult.replaceAll(/^\[\w+\].+$/gm, "").trim();

  expect(bunReleaseResult, `test ${testName} printed different output under bun vs. under node`).toBe(nodeResult);
  expect(bunDebugResult, `test ${testName} printed different output under bun in debug mode vs. under node`).toBe(
    nodeResult,
  );
  return nodeResult;
}

// For a fixture that only Bun can run. Returns its output with the addon built in release mode and in debug mode. The
// lines end with "\n" on every platform.
function runOnBun(testName: string, jsArgs?: string) {
  return Promise.all(
    [BuildMode.release, BuildMode.debug].map(async buildMode =>
      (await runOn(Runtime.bun, buildMode, testName, jsArgs))
        .replaceAll("\r\n", "\n")
        .replaceAll(/^\[\w+\].+$/gm, "")
        .trim(),
    ),
  );
}

/**
 * @param jsArgs should eval() to an array
 * @param thisValue will be JSON stringified
 */
async function runOn(runtime: Runtime, buildMode: BuildMode, testName: string, jsArgs?: string, thisValue?: any) {
  if (runtime == Runtime.node) {
    assert(buildMode == BuildMode.release);
  }
  const baseDir =
    runtime == Runtime.node
      ? directories.node
      : buildMode == BuildMode.debug
        ? directories.bunDebug
        : directories.bunRelease;
  const exe = runtime == Runtime.node ? await nodeExeMatchingAbi() : bunExe();

  const cmd = [
    exe,
    ...(runtime == Runtime.bun ? ["--smol"] : []),
    join(baseDir, "main.js"),
    testName,
    jsArgs ?? "[]",
    JSON.stringify(thisValue ?? null),
  ];
  if (buildMode == BuildMode.debug) {
    cmd.push("debug");
  }

  const proc = spawn({
    cmd,
    cwd: baseDir,
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const [exitCode, out, err] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
  const crashMsg = `test ${testName} crashed under ${Runtime[runtime]} in ${BuildMode[buildMode]} mode (exit code ${exitCode}${exitCode && exitCode > 256 ? ` / 0x${exitCode.toString(16)}` : ""})`;
  if (exitCode !== 0) {
    throw new Error(`${crashMsg}: ${err}\n${out}`.trim());
  }
  expect(exitCode, crashMsg).toBe(0);
  return out.trim();
}

function standaloneAddonFiles(targetName: string, addonCpp: string, runJs: string) {
  return {
    "package.json": JSON.stringify({
      name: `${targetName}-test`,
      version: "1.0.0",
      devDependencies: { "node-gyp": "~11.2.0" },
    }),
    "binding.gyp": JSON.stringify({
      targets: [
        {
          target_name: targetName,
          sources: ["addon.cpp"],
          cflags: ["-Wno-deprecated-declarations"],
          cflags_cc: ["-Wno-deprecated-declarations"],
          xcode_settings: {
            OTHER_CFLAGS: ["-Wno-deprecated-declarations"],
            OTHER_CPLUSPLUSFLAGS: ["-Wno-deprecated-declarations"],
          },
        },
      ],
    }),
    "addon.cpp": addonCpp,
    "run.js": runJs,
  };
}

async function buildStandaloneAddon(cwd: string) {
  {
    await using install = spawn({
      cmd: [bunExe(), "install", "--ignore-scripts"],
      cwd,
      env: bunEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await install.exited;
    if (exitCode !== 0) {
      throw new Error(`install failed: ${exitCode}`);
    }
  }
  await using build = spawn({
    cmd: [
      bunExe(),
      "--bun",
      "run",
      "node-gyp",
      "rebuild",
      "--release",
      "-j",
      "max",
      "--",
      "-Denable_lto=false",
      "-Denable_thin_lto=false",
      "-Dlto_jobs=",
    ],
    cwd,
    env: bunEnv,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, out, err] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`node-gyp rebuild failed with code ${exitCode}:\n${err}\n${out}`);
  }
}

async function runStandaloneAddon(cwd: string, script = "run.js", exe = bunExe(), env = bunEnv) {
  await using proc = spawn({
    cmd: [exe, join(cwd, script)],
    cwd,
    env,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = out
    .replaceAll(/^\[\w+\].+$/gm, "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return { lines, err, exitCode };
}

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("String::Utf8Length surrogates", () => {
  it(
    "counts each unpaired surrogate as three bytes",
    async () => {
      using dir = tempDir(
        "v8-utf8-length-surrogate",
        standaloneAddonFiles(
          "utf8lensurrogate",
          `#include <node.h>
#include <cstdio>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

using namespace v8;

namespace utf8len_surrogate_test {

using LegacyUtf8Length = int (*)(const String *, Isolate *);

LegacyUtf8Length resolve_legacy_utf8_length() {
#ifdef _WIN32
  return reinterpret_cast<LegacyUtf8Length>(reinterpret_cast<void *>(
      GetProcAddress(GetModuleHandleW(nullptr),
                     "?Utf8Length@String@v8@@QEBAHPEAVIsolate@2@@Z")));
#else
  return reinterpret_cast<LegacyUtf8Length>(
      dlsym(RTLD_DEFAULT, "_ZNK2v86String10Utf8LengthEPNS_7IsolateE"));
#endif
}

void string_utf8_length(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = info[0].As<String>();
  static const LegacyUtf8Length legacy_utf8_length = resolve_legacy_utf8_length();
  if (legacy_utf8_length == nullptr) {
    printf("Utf8Length symbol missing\\n");
    fflush(stdout);
    return;
  }
  printf("Utf8Length = %d, Utf8LengthV2 = %zu\\n", legacy_utf8_length(*s, isolate),
         s->Utf8LengthV2(isolate));
  fflush(stdout);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "string_utf8_length", string_utf8_length);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace utf8len_surrogate_test
`,
          `const addon = require("./build/Release/utf8lensurrogate");
addon.string_utf8_length("a\\u00e9b");
addon.string_utf8_length("a\\ud83d\\ude00b");
addon.string_utf8_length("a\\ud800b");
addon.string_utf8_length("\\ud800");
addon.string_utf8_length("a\\udfffb");
`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "Utf8Length = 4, Utf8LengthV2 = 4",
        "Utf8Length = 6, Utf8LengthV2 = 6",
        "Utf8Length = 5, Utf8LengthV2 = 5",
        "Utf8Length = 3, Utf8LengthV2 = 3",
        "Utf8Length = 5, Utf8LengthV2 = 5",
      ]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("Number::New", () => {
  it(
    "returns a numeric NaN for every NaN bit pattern",
    async () => {
      using dir = tempDir(
        "v8-number-nan",
        standaloneAddonFiles(
          "numbernan",
          `#include <node.h>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

using namespace v8;

namespace number_nan_test {

void number_from_bits(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  uint64_t hi = static_cast<uint64_t>(info[0].As<Number>()->Value());
  uint64_t lo = static_cast<uint64_t>(info[1].As<Number>()->Value());
  uint64_t bits = (hi << 32) | lo;
  double value;
  memcpy(&value, &bits, sizeof value);
  Local<Number> num = Number::New(isolate, value);
  printf("isnan = %d\\n", std::isnan(num->Value()) ? 1 : 0);
  fflush(stdout);
  info.GetReturnValue().Set(num);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "number_from_bits", number_from_bits);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace number_nan_test
`,
          `const addon = require("./build/Release/numbernan");
for (const [hi, lo] of [
  [0x7ff80000, 0x00000000],
  [0xfffe0000, 0x00010000],
  [0xfffe0000, 0x00000000],
  [0xffffffff, 0xffffffff],
  [0x7ff40000, 0x00000001],
]) {
  const value = addon.number_from_bits(hi, lo);
  console.log(typeof value, Number.isNaN(value));
}
`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
        "isnan = 1",
        "number true",
      ]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

// Node runs every Node-API callback inside a v8::HandleScope, so an addon that calls the V8 API
// from one doesn't need to open its own scope. With the Node 26 headers, an addon's
// v8::HandleScope is inlined and never calls into Bun either.
describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("V8 API from Node-API callbacks", () => {
  it(
    "creates handles in the Node-API scope, keeps them alive, and releases them when it closes",
    async () => {
      using dir = tempDir(
        "v8-api-from-napi",
        standaloneAddonFiles(
          "hybridnapi",
          `// A Node-API addon whose callbacks also use the V8 C++ API. Node runs every Node-API callback
// inside a v8::HandleScope, so the callbacks below only open one when that's what they test.
// Each callback returns its result as a string so run.js can print everything in order.
#include <node.h>
#include <node_api.h>
#include <cstdio>
#include <cstring>

namespace hybrid_test {

using namespace v8;

Global<Array> stashed_array;

napi_value to_napi_string(napi_env env, const char* text) {
  napi_value result;
  napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result);
  return result;
}

// Bun's callback overload of Array::New opens an EscapableHandleScope around the callbacks.
napi_value describe_new_values(napi_env env, Isolate* isolate) {
  Local<Array> array = Array::New(isolate, 3);
  Local<String> string =
      String::NewFromUtf8(isolate, "string from v8", NewStringType::kNormal).ToLocalChecked();
  int next = 0;
  Local<Array> from_callback =
      Array::New(isolate->GetCurrentContext(), 4,
                 [&]() -> MaybeLocal<Value> { return Number::New(isolate, next++); })
          .ToLocalChecked();
  char string_text[64];
  string->WriteUtf8V2(isolate, string_text, sizeof string_text, String::WriteFlags::kNullTerminate);
  char result[128];
  snprintf(result, sizeof result, "arrays of length %u and %u, '%s'", array->Length(),
           from_callback->Length(), string_text);
  return to_napi_string(env, result);
}

napi_value without_scope(napi_env env, napi_callback_info info) {
  return describe_new_values(env, Isolate::GetCurrent());
}

napi_value with_scope(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  return describe_new_values(env, isolate);
}

napi_value with_escapable_scope(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<String> escaped;
  {
    EscapableHandleScope scope(isolate);
    escaped = scope.Escape(
        String::NewFromUtf8(isolate, "escaped string", NewStringType::kNormal).ToLocalChecked());
  }
  char text[64];
  escaped->WriteUtf8V2(isolate, text, sizeof text, String::WriteFlags::kNullTerminate);
  return to_napi_string(env, text);
}

napi_value constructor(napi_env env, napi_callback_info info) {
  napi_value description = describe_new_values(env, Isolate::GetCurrent());
  napi_value this_arg;
  size_t argc = 0;
  napi_get_cb_info(env, info, &argc, nullptr, &this_arg, nullptr);
  napi_set_named_property(env, this_arg, "description", description);
  return this_arg;
}

void call_argument(napi_env env, napi_callback_info info, napi_value* result) {
  size_t argc = 1;
  napi_value callback;
  napi_get_cb_info(env, info, &argc, &callback, nullptr, nullptr);
  napi_value global;
  napi_get_global(env, &global);
  napi_call_function(env, global, callback, 0, nullptr, result);
}

// Handles created in a callback must keep their values alive for the rest of the callback,
// including across a GC that the callback triggers. The argument is a function that runs the GC.
napi_value survives_gc(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  constexpr int count = 500;
  Local<String> strings[count];
  for (int i = 0; i < count; i++) {
    char text[32];
    snprintf(text, sizeof text, "string %d", i);
    strings[i] = String::NewFromUtf8(isolate, text, NewStringType::kNormal).ToLocalChecked();
  }

  napi_value ignored;
  call_argument(env, info, &ignored);

  int intact = 0;
  for (int i = 0; i < count; i++) {
    char expected[32], actual[32];
    snprintf(expected, sizeof expected, "string %d", i);
    strings[i]->WriteUtf8V2(isolate, actual, sizeof actual, String::WriteFlags::kNullTerminate);
    intact += strcmp(expected, actual) == 0;
  }
  char result[64];
  snprintf(result, sizeof result, "%d of %d strings intact after gc", intact, count);
  return to_napi_string(env, result);
}

constexpr int num_buffers = 1000;

// The argument is a function that runs the GC and returns the number of live ArrayBuffers. Reports
// whether the buffers the caller created in already-closed scopes were collected.
napi_value describe_released(napi_env env, napi_callback_info info) {
  napi_value live_value;
  call_argument(env, info, &live_value);
  int32_t live = -1;
  napi_get_value_int32(env, live_value, &live);
  return to_napi_string(env, live < num_buffers / 10 ? "released before the callback returned"
                                                     : "still alive when the callback returned");
}

napi_value napi_scopes_release(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  for (int i = 0; i < num_buffers; i++) {
    napi_handle_scope scope;
    napi_open_handle_scope(env, &scope);
    ArrayBuffer::New(isolate, 8);
    napi_close_handle_scope(env, scope);
  }
  return describe_released(env, info);
}

// Doesn't open a scope. run.js checks that the buffers are released once this returns.
napi_value create_buffers(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  for (int i = 0; i < num_buffers; i++) {
    ArrayBuffer::New(isolate, 8);
  }
  return nullptr;
}

napi_value stash_array(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  stashed_array.Reset(isolate, Array::New(isolate, 5));
  return nullptr;
}

// Global::Get creates its Local with V8's inline handle creation code, which calls into Bun through
// HandleScope::Extend instead of a value constructor like Array::New. Each inline HandleScope
// releases those handles through HandleScope::DeleteExtensions when it closes.
napi_value read_stashed_array(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  unsigned total_length = 0;
  for (int i = 0; i < 1000; i++) {
    HandleScope scope(isolate);
    total_length += stashed_array.Get(isolate)->Length();
  }
  Local<Array> array = stashed_array.Get(isolate);
  char result[96];
  snprintf(result, sizeof result, "stashed array of length %u, %u in total over 1000 inline scopes",
           array->Length(), total_length);
  stashed_array.Reset();
  return to_napi_string(env, result);
}

napi_value init(napi_env env, napi_value exports) {
  struct {
    const char* name;
    napi_callback callback;
  } functions[] = {
      {"withoutScope", without_scope},
      {"withScope", with_scope},
      {"withEscapableScope", with_escapable_scope},
      {"survivesGc", survives_gc},
      {"napiScopesRelease", napi_scopes_release},
      {"createBuffers", create_buffers},
      {"stashArray", stash_array},
      {"readStashedArray", read_stashed_array},
  };
  for (auto& function : functions) {
    napi_value value;
    napi_create_function(env, function.name, NAPI_AUTO_LENGTH, function.callback, nullptr, &value);
    napi_set_named_property(env, exports, function.name, value);
  }
  napi_value klass;
  napi_define_class(env, "Klass", NAPI_AUTO_LENGTH, constructor, nullptr, 0, nullptr, &klass);
  napi_set_named_property(env, exports, "Klass", klass);
  return exports;
}

}  // namespace hybrid_test

NAPI_MODULE(NODE_GYP_MODULE_NAME, hybrid_test::init)`,
          `const addon = require("./build/Release/hybridnapi");
const { heapStats } = require("bun:jsc");

function gc() {
  Bun.gc(true);
}

function liveArrayBuffers() {
  gc();
  return heapStats().objectTypeCounts.ArrayBuffer ?? 0;
}

console.log("function without scope:", addon.withoutScope());
console.log("function with scope:", addon.withScope());
console.log("function with escapable scope:", addon.withEscapableScope());
console.log("class constructor:", new addon.Klass().description);
console.log("survives gc:", addon.survivesGc(gc));
console.log("per-iteration napi_handle_scope:", addon.napiScopesRelease(liveArrayBuffers));
addon.createBuffers();
console.log("no scope:", liveArrayBuffers() < 100 ? "released when the callback returned" : "still alive after the callback returned");
addon.stashArray();
console.log("global handle:", addon.readStashedArray());`,
        ),
      );
      const cwd = String(dir);
      await buildStandaloneAddon(cwd);
      const { lines, err, exitCode } = await runStandaloneAddon(cwd);
      expect(lines, `stderr:\n${err}`).toEqual([
        "function without scope: arrays of length 3 and 4, 'string from v8'",
        "function with scope: arrays of length 3 and 4, 'string from v8'",
        "function with escapable scope: escaped string",
        "class constructor: arrays of length 3 and 4, 'string from v8'",
        "survives gc: 500 of 500 strings intact after gc",
        "per-iteration napi_handle_scope: released before the callback returned",
        "no scope: released when the callback returned",
        "global handle: stashed array of length 5, 5000 in total over 1000 inline scopes",
      ]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)("String::Utf8Length bounds", () => {
  it(
    "reports sizes beyond INT32_MAX without wrapping",
    async () => {
      // Build a tiny standalone V8-API addon that just reports String::Utf8LengthV2 of its
      // argument, then feed it a Latin-1 string whose UTF-8 expansion is larger than INT32_MAX.
      // Utf8LengthV2 returns size_t, so the reported length must be the exact byte count
      // instead of wrapping to a negative or small value (the legacy int-returning Utf8Length
      // saturated at INT32_MAX here).
      using dir = tempDir("v8-utf8-length", {
        "package.json": JSON.stringify({
          name: "v8-utf8-length-test",
          version: "1.0.0",
          devDependencies: { "node-gyp": "~11.2.0" },
        }),
        "binding.gyp": JSON.stringify({
          targets: [
            {
              target_name: "utf8len",
              sources: ["addon.cpp"],
              cflags: ["-Wno-deprecated-declarations"],
              cflags_cc: ["-Wno-deprecated-declarations"],
              xcode_settings: {
                OTHER_CFLAGS: ["-Wno-deprecated-declarations"],
                OTHER_CPLUSPLUSFLAGS: ["-Wno-deprecated-declarations"],
              },
            },
          ],
        }),
        "addon.cpp": `#include <node.h>
#include <cstdio>

using namespace v8;

namespace utf8len_test {

void string_utf8_length(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Local<String> s = info[0].As<String>();
  printf("Utf8Length = %zu\\n", s->Utf8LengthV2(isolate));
  fflush(stdout);
}

void initialize(Local<Object> exports, Local<Value> module,
                Local<Context> context) {
  NODE_SET_METHOD(exports, "string_utf8_length", string_utf8_length);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)

} // namespace utf8len_test
`,
        "run.js": `const addon = require("./build/Release/utf8len");
// sanity check: 3 two-byte characters encode to 6 UTF-8 bytes
addon.string_utf8_length("\\u00e9".repeat(3));
// 2**30 + 1 Latin-1 characters that each take 2 UTF-8 bytes encode to 2**31 + 2 UTF-8 bytes,
// which is larger than INT32_MAX
addon.string_utf8_length("\\u00ff".repeat(2 ** 30 + 1));
`,
      });
      const cwd = String(dir);

      {
        const install = spawn({
          cmd: [bunExe(), "install", "--ignore-scripts"],
          cwd,
          env: bunEnv,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        expect(await install.exited).toBe(0);
      }

      {
        const build = spawn({
          cmd: [
            bunExe(),
            "--bun",
            "run",
            "node-gyp",
            "rebuild",
            "--release",
            "-j",
            "max",
            "--",
            "-Denable_lto=false",
            "-Denable_thin_lto=false",
            "-Dlto_jobs=",
          ],
          cwd,
          env: bunEnv,
          stdin: "inherit",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [exitCode, out, err] = await Promise.all([
          build.exited,
          new Response(build.stdout).text(),
          new Response(build.stderr).text(),
        ]);
        if (exitCode !== 0) {
          throw new Error(`node-gyp rebuild failed with code ${exitCode}:\n${err}\n${out}`);
        }
      }

      const proc = spawn({
        cmd: [bunExe(), join(cwd, "run.js")],
        cwd,
        env: bunEnv,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // strip debug-build scoped log lines, same as checkSameOutput does
      const lines = out
        .replaceAll(/^\[\w+\].+$/gm, "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      // Both strings report their exact UTF-8 size: Utf8LengthV2 returns size_t, so the
      // oversized string's 2**31 + 2 bytes are reported exactly instead of wrapping or
      // saturating at INT32_MAX like the legacy Utf8Length did.
      expect(lines, `stderr:\n${err}`).toEqual(["Utf8Length = 6", "Utf8Length = 2147483650"]);
      expect(exitCode).toBe(0);
    },
    10 * 60 * 1000,
  );
});

// Node has one queue for the cleanup hooks of the V8 API and those of Node-API. Bun has a queue for each kind.
describe.skipIf(!canBuildNodeAddons()).todoIf(isBroken && isMusl)(
  "node::AddEnvironmentCleanupHook in a Node-API addon",
  () => {
    // The addon is built once. Each test runs a script of its own.
    let dir: ReturnType<typeof tempDir> | undefined;
    let cwd = "";

    beforeAll(
      async () => {
        dir = tempDir("v8-cleanup-hooks-napi", {
          ...standaloneAddonFiles(
            "hybridhooks",
            `// A Node-API addon that also adds cleanup hooks through the V8 API. NAPI_EXPERIMENTAL makes a finalizer run inside
// the collection that finds its object dead.
#define NAPI_EXPERIMENTAL
#include <node.h>
#include <node_api.h>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>
#include <unordered_set>

namespace hybrid_hooks_test {

using namespace v8;

// Never freed, so that a hook can ask for its state after the finalizer.
struct InstanceData {
  bool finalized = false;
};

void print_state(const char* hook, void* data) {
  printf("cleanup hook of %s: the instance data of the env is %s\\n", hook,
         static_cast<InstanceData*>(data)->finalized ? "finalized" : "alive");
  fflush(stdout);
}

// The env exists before the addon can add a hook, so Node runs its cleanup, which finalizes the instance data, last.
napi_value add_hooks_of_both_apis(napi_env env, napi_callback_info info) {
  auto* data = new InstanceData();
  napi_set_instance_data(
      env, data,
      [](napi_env env, void* data, void* hint) {
        static_cast<InstanceData*>(data)->finalized = true;
        printf("the instance data of the env is finalized\\n");
        fflush(stdout);
      },
      nullptr);
  napi_add_env_cleanup_hook(env, [](void* data) { print_state("Node-API", data); }, data);
  node::AddEnvironmentCleanupHook(Isolate::GetCurrent(), [](void* data) { print_state("the V8 API", data); }, data);
  return nullptr;
}

struct Owner;
// Tells whether an owner is alive without reading its memory.
std::unordered_set<Owner*> live_owners;
int owners_destroyed_by_finalizers = 0;
int hooks_run_for_destroyed_owners = 0;
napi_env env_of_held = nullptr;
napi_ref held = nullptr;

// Like a node::ObjectWrap: it adds a hook for itself and removes it when it is destroyed.
struct Owner {
  Isolate* isolate;
  explicit Owner(Isolate* isolate) : isolate(isolate) {
    live_owners.insert(this);
    node::AddEnvironmentCleanupHook(isolate, cleanup, this);
  }
  ~Owner() {
    node::RemoveEnvironmentCleanupHook(isolate, cleanup, this);
    live_owners.erase(this);
  }
  static void cleanup(void* owner) { hooks_run_for_destroyed_owners += !live_owners.count(static_cast<Owner*>(owner)); }
};

// The finalizer of the object that this returns destroys a new owner.
napi_value create_owner(napi_env env, napi_callback_info info) {
  napi_value object;
  napi_create_object(env, &object);
  napi_wrap(
      env, object, new Owner(Isolate::GetCurrent()),
      [](node_api_basic_env env, void* owner, void* hint) {
        owners_destroyed_by_finalizers++;
        delete static_cast<Owner*>(owner);
      },
      nullptr, nullptr);
  return object;
}

void report_owners(void* unused) {
  printf("finalizers destroyed owners while the hooks ran: %s\\n", owners_destroyed_by_finalizers > 0 ? "yes" : "no");
  printf("hooks that ran for a destroyed owner: %d\\n", hooks_run_for_destroyed_owners);
  fflush(stdout);
}

// The hook that reports is older than the owners that are made after this call, so it runs after their hooks.
napi_value report_owners_at_cleanup(napi_env env, napi_callback_info info) {
  node::AddEnvironmentCleanupHook(Isolate::GetCurrent(), report_owners, nullptr);
  return nullptr;
}

// After a collection no free cell is at hand, so the scope of the next hook is allocated on the slow path, where
// BUN_JSC_slowPathAllocsBetweenGCs collects. By then nothing refers to the objects of the owners.
void release_held(void* isolate) {
  static_cast<Isolate*>(isolate)->LowMemoryNotification();
  napi_delete_reference(env_of_held, held);
}

// Keeps the argument alive until the hook that is added here runs, which is before the hooks of the owners.
napi_value hold_until_cleanup(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value objects;
  napi_get_cb_info(env, info, &argc, &objects, nullptr, nullptr);
  env_of_held = env;
  napi_create_reference(env, objects, 1, &held);
  Isolate* isolate = Isolate::GetCurrent();
  node::AddEnvironmentCleanupHook(isolate, release_held, isolate);
  return nullptr;
}

std::atomic<bool> job_has_started{false};
std::atomic<bool> job_may_end{false};
std::atomic<bool> job_was_ended_by_a_hook{false};

// The finalizer of the instance data adds a hook. While a job of an env is on the thread pool, Bun holds the
// finalizers of the env back until its VM has waited for the pool, which is after it ran the cleanup hooks.
napi_value add_finalizer_behind_a_job(napi_env env, napi_callback_info info) {
  static Isolate* isolate = Isolate::GetCurrent();
  napi_set_instance_data(
      env, nullptr,
      [](napi_env env, void* data, void* hint) {
        node::AddEnvironmentCleanupHook(
            isolate,
            [](void* unused) {
              printf("cleanup hook that a finalizer added after the job on the thread pool, which %s\\n",
                     job_was_ended_by_a_hook ? "a cleanup hook ended" : "ended by itself");
              fflush(stdout);
            },
            nullptr);
      },
      nullptr);
  napi_value name;
  napi_create_string_utf8(env, "a job that a cleanup hook ends", NAPI_AUTO_LENGTH, &name);
  napi_async_work job;
  napi_create_async_work(
      env, nullptr, name,
      [](napi_env env, void* data) {
        job_has_started = true;
        // Ends by itself where no cleanup hook runs, so that the Worker can exit there too.
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
        while (!job_may_end && std::chrono::steady_clock::now() < deadline) {
          std::this_thread::yield();
        }
        job_was_ended_by_a_hook = job_may_end.load();
      },
      [](napi_env env, napi_status status, void* data) {}, nullptr, &job);
  napi_queue_async_work(env, job);
  // The cleanup of the env runs this hook and then looks for its jobs on the thread pool. The hook that this one adds
  // runs after that.
  napi_add_env_cleanup_hook(
      env,
      [](void* unused) {
        node::AddEnvironmentCleanupHook(isolate, [](void* unused) { job_may_end = true; }, nullptr);
      },
      nullptr);
  return nullptr;
}

napi_value has_job_started(napi_env env, napi_callback_info info) {
  napi_value started;
  napi_get_boolean(env, job_has_started, &started);
  return started;
}

napi_value init(napi_env env, napi_value exports) {
  struct {
    const char* name;
    napi_callback callback;
  } functions[] = {
      {"addHooksOfBothApis", add_hooks_of_both_apis},
      {"createOwner", create_owner},
      {"reportOwnersAtCleanup", report_owners_at_cleanup},
      {"holdUntilCleanup", hold_until_cleanup},
      {"addFinalizerBehindAJob", add_finalizer_behind_a_job},
      {"hasJobStarted", has_job_started},
  };
  for (auto& function : functions) {
    napi_value value;
    napi_create_function(env, function.name, NAPI_AUTO_LENGTH, function.callback, nullptr, &value);
    napi_set_named_property(env, exports, function.name, value);
  }
  return exports;
}

}  // namespace hybrid_hooks_test

NAPI_MODULE(NODE_GYP_MODULE_NAME, hybrid_hooks_test::init)`,
            `require("./build/Release/hybridhooks").addHooksOfBothApis();
console.log("the script ends");`,
          ),
          "finalizer.js": `const addon = require("./build/Release/hybridhooks");
addon.reportOwnersAtCleanup();
addon.holdUntilCleanup(Array.from({ length: 100 }, () => addon.createOwner()));`,
          "thread-pool.js": `const { Worker, isMainThread } = require("node:worker_threads");
if (isMainThread) {
  new Worker(__filename).on("exit", code => console.log("the Worker exited with code", code));
} else {
  const addon = require("./build/Release/hybridhooks");
  addon.addFinalizerBehindAJob();
  (function exitOnceTheJobRuns() {
    if (addon.hasJobStarted()) process.exit(0);
    setImmediate(exitOnceTheJobRuns);
  })();
}`,
        });
        cwd = String(dir);
        await buildStandaloneAddon(cwd);
      },
      10 * 60 * 1000,
    );

    afterAll(() => dir?.[Symbol.dispose]());

    it("runs the hook of the V8 API before the cleanup of the Node-API env that was made before it", async () => {
      const runs = await Promise.all(
        [bunExe(), await nodeExeMatchingAbi()].map(exe => runStandaloneAddon(cwd, "run.js", exe)),
      );
      for (const { lines, err, exitCode } of runs) {
        expect(lines, `stderr:\n${err}`).toEqual([
          "the script ends",
          "cleanup hook of the V8 API: the instance data of the env is alive",
          "cleanup hook of Node-API: the instance data of the env is alive",
          "the instance data of the env is finalized",
        ]);
        expect(exitCode).toBe(0);
      }
    });

    // Bun only: Node waits for the thread pool before it runs a hook, and Bun after. Bun then runs the hooks again.
    it("runs a hook that a Node-API finalizer adds once the VM of a Worker has waited for the thread pool", async () => {
      const { lines, err, exitCode } = await runStandaloneAddon(cwd, "thread-pool.js");
      expect(lines, `stderr:\n${err}`).toEqual([
        "cleanup hook that a finalizer added after the job on the thread pool, which a cleanup hook ended",
        "the Worker exited with code 0",
      ]);
      expect(exitCode).toBe(0);
    });

    // Bun only: the scope that it opens for a hook is a cell of the collector, and Node opens none.
    it(
      "does not run a hook that a finalizer removes in the collection that the handle scope of the hook starts",
      async () => {
        const env = { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "1" };
        const { lines, err, exitCode } = await runStandaloneAddon(cwd, "finalizer.js", bunExe(), env);
        expect(lines, `stderr:\n${err}`).toEqual([
          "finalizers destroyed owners while the hooks ran: yes",
          "hooks that ran for a destroyed owner: 0",
        ]);
        expect(exitCode).toBe(0);
      },
      // With a collection at each slow-path allocation, a debug build takes 5 seconds to start.
      isDebug || isASAN ? 60_000 : 30_000,
    );
  },
);
