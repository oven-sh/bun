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

// ASAN sees a read of what a destroyed VM freed only with Malloc set. Its report outlasts a test's timeout unless symbolize=0.
const asanEnv = {
  ...bunEnv,
  Malloc: "1",
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":"),
};

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
      const expected = [1, 2, 3].map(run => `cleanup hook that adds itself again: run ${run}`).join("\n");
      expect(await runOnBun("add_a_cleanup_hook_that_adds_itself_again")).toEqual([expected, expected]);
      // Node aborts there before 26.11.0, and the Node of a CI host can be older than the one whose headers the addon is built with.
      if (nodeExeAtLeast("26.11.0")) {
        expect(await checkSameOutput("add_a_cleanup_hook_that_adds_itself_again")).toBe(expected);
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

    it("lets go of its value when it is reset", async () => {
      const output = await checkSameOutput("test_v8_global_reset_releases_value");
      // Node and Bun agree by now. This rules out that neither of them collected the values.
      expect(output.split(/\r?\n/)).toEqual([
        "values of Globals reset in the call that created them: collected",
        "values of Globals not reset yet: alive",
        "values of Globals reset in a later call: collected",
      ]);
    });

    it("does not change the Locals and return values that were read from it when it is reset", async () => {
      const output = await checkSameOutput("test_v8_global_reset_keeps_locals_and_return_values");
      expect(output.split(/\r?\n/)).toEqual([
        'local after Reset = "first"',
        'local after other Globals were created = "first", its copy = "first"',
        "returned local = first",
        'global_return_local_then_reset returned {"name":"second"}, "a string", 12.5, 7, undefined, null, true, false',
        'global_return_global_then_reset returned {"name":"second"}, "a string", 12.5, 7, undefined, null, true, false',
        'local after nested calls reset the Global = "third"',
        "returned after nested calls reset the Global = third",
        'the Global then held {"name":"fifth"}',
        "the other Globals held their values = true",
      ]);
    });

    it("can be reset while it holds undefined, null, a boolean or a number", async () => {
      const output = await checkSameOutput("test_v8_global_reset_primitives");
      // Each round prints the values that the Globals of the round before held, and then undefined, null, true and false.
      expect(output.split(/\r?\n/)).toEqual([
        "round 0: | undefined null true false",
        'round 1: undefined undefined null true false 0.000000 0.500000 "string 0" | undefined null true false',
        'round 2: "string 1" undefined undefined null true false 1.000000 1.500000 | undefined null true false',
        'round 3: 2.500000 "string 2" undefined undefined null true false 2.000000 | undefined null true false',
        'round 4: 3.000000 3.500000 "string 3" undefined undefined null true false | undefined null true false',
        'round -1: false 4.000000 4.500000 "string 4" undefined undefined null true | undefined null true false',
        "Globals of undefined, undefined, null, true and false have 5 handles",
      ]);
    });

    it("takes the handle that a reset Global gave back", async () => {
      const output = await checkSameOutput("test_v8_global_reuses_handles");
      expect(output).toBe("handles for 1000 Globals, one at a time: at most 16");
    });

    it("can be reset, made weak and made strong again on a thread that has no isolate", async () => {
      const output = await checkSameOutput("test_v8_global_on_another_thread");
      expect(output.split(/\r?\n/)).toEqual([
        "the Global that the other thread reset is empty = true",
        'the Global that the other thread made weak and strong again = "made on the JS thread"',
      ]);
    });

    // Not run on Windows, where no test of this file has used libuv from an addon yet.
    it.skipIf(isWindows)("lets go of its value when a libuv callback that creates no Local resets it", async () => {
      const output = await checkSameOutput("test_v8_global_reset_in_uv_timer");
      expect(output).toBe("values of Globals reset in a uv_timer callback that creates no Local: collected");
    });

    it("keeps its value when the Globals that exited Workers left are reset", async () => {
      const expected = [
        "Globals that Workers left when they exited: 2048",
        "Globals with the handle address of one of them: 0",
        "Globals with a wrong value after those that the Workers left were reset: 0",
      ].join("\n");
      expect(await runOnBun("test_v8_global_left_by_workers")).toEqual([expected, expected]);
    });

    it("keeps its handle when a Worker resets it", async () => {
      const expected = [
        "the Worker's Globals held their values: true",
        "a Global of the Worker took the handle of the main thread's Global: false",
        "the values of the main thread's Globals that the Worker reset: held, stored",
      ].join("\n");
      expect(await runOnBun("test_v8_global_of_another_isolate")).toEqual([expected, expected]);
    });

    it("does not give the parameter of SetWeak to the next Global that takes its handle", async () => {
      const output = await checkSameOutput("test_v8_global_weak_parameter_after_reuse");
      expect(output.split(/\r?\n/)).toEqual([
        "ClearWeak() of a weak Global returned the parameter of SetWeak",
        "the next Global took the handle of the weak one: true",
        "ClearWeak() of the next Global returned null",
        "the objects are first and second",
      ]);
    });

    it("keeps its wrapper class id apart from its value, and starts with the id 0", async () => {
      const output = await checkSameOutput("test_v8_global_wrapper_class_id");
      expect(output.split(/\r?\n/)).toEqual([
        "WrapperClassId() of a new Global = 0",
        'after SetWrapperClassId(65535) = 65535, value = "text"',
        'after SetWeak = 65535, after ClearWeak = 65535, value = "text"',
        'WrapperClassId() of the next Global = 0, value = "next"',
      ]);
    });

    it("gives its handle back once when a copy of it is reset too", async () => {
      const expected = "handles of the next 8 Globals: 8\nvalues that those Globals held: 8";
      expect(await runOnBun("test_v8_global_reset_twice")).toEqual([expected, expected]);
    });

    it(
      "keeps and lets go of the values of Globals that take a handle again while the collector runs all the time",
      async () => {
        // A debug or ASAN build needs 20 times as long for a round as a release build.
        const rounds = isDebug || isASAN ? 5_000 : 100_000;
        const env = { ...bunEnv, BUN_JSC_collectContinuously: "1" };
        const output = await checkSameOutput("test_v8_global_churn", `[${rounds}]`, undefined, env);
        expect(output.split(/\r?\n/)).toEqual([
          "handles that the Globals of all rounds took: at most 16",
          "values read back from the Global of their round: intact",
          "values of the Globals of earlier rounds: collected",
        ]);
      },
      isDebug || isASAN ? 60_000 : 30_000,
    );

    it(
      "frees the handles of a Worker that exits with one Global set",
      async () => {
        // Each Worker has 250,000 Globals at once and leaves one. As below, a debug or ASAN build runs 4 Workers where a release build runs 30.
        const workers = isDebug || isASAN ? 4 : 30;
        const main = join(directories.bunRelease, "main.js");
        await expectRssDeltaBelow([main, "test_v8_global_left_after_peak_leak", `[${workers}, 250000]`, "null"], {
          release: 60,
          debug: 8,
        });
      },
      isDebug || isASAN ? 120_000 : 30_000,
    );

    // Bun only: each file of `bun test --isolate` runs in a realm of its own, which is a v8::Isolate of its own here. Every file loads the addon.
    async function runIsolatedFiles(...sources: string[]) {
      const addon = JSON.stringify(join(directories.bunRelease, "build", "Release", "v8tests.node"));
      const names = sources.map((_, i) => `file-${i + 1}.test.js`);
      using dir = tempDir(
        "v8-global-isolate",
        Object.fromEntries(sources.map((source, i) => [names[i], `const addon = require(${addon});\n${source}`])),
      );
      await using proc = spawn({
        cmd: [bunExe(), "test", "--isolate", ...names.map(name => `./${name}`)],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // What the files and the addon printed: not the debug logs, and not the line with the version of bun test.
      const lines = stdout
        .replaceAll(/^\[\w+\].+$/gm, "")
        .split(/\r?\n/)
        .filter(line => line && !line.startsWith("bun test v"));
      return { lines, stderr, exitCode };
    }

    // A Global keeps its value alive once the file that made it is done: the second file reads an object of the first one from a Global.
    const holdAnObjectOfThisFile = `
      addon.global_hold({ name: "an object of the first file" });
      Bun.gc(true);`;
    const takeTheObjectOfTheFirstFile = `
      const [ofTheFirstFile] = addon.global_held();
      expect(ofTheFirstFile.name).toBe("an object of the first file");`;

    it("lets go of its value when the next file of bun test --isolate resets it", async () => {
      const { lines, stderr, exitCode } = await runIsolatedFiles(
        `import { test } from "bun:test";
        test("gives a Global an instance of a function of the addon", () => {
          addon.global_store(new addon.test_v8_native_call());${holdAnObjectOfThisFile}
        });`,
        `import { heapStats } from "bun:jsc";
        import { expect, test } from "bun:test";
        test("resets the Global of the first file", () => {${takeTheObjectOfTheFirstFile}
          // Only an instance of a function of a V8 addon is an InternalFieldObject.
          const instances = () => (Bun.gc(true), heapStats().objectTypeCounts.InternalFieldObject ?? 0);
          const before = instances();
          addon.global_reset_stored();
          console.log("instances before and after their Global is reset:", before, instances());
          expect(ofTheFirstFile.name).toBe("an object of the first file");
        });`,
      );
      expect(lines, stderr).toEqual(["instances before and after their Global is reset: 1 0"]);
      expect(exitCode).toBe(0);
    });

    it("does not change a Local of the next file of bun test --isolate when that file resets it", async () => {
      const { lines, stderr, exitCode } = await runIsolatedFiles(
        `import { test } from "bun:test";
        test("gives a Global an object", () => {
          addon.global_store({ name: "stored by the first file" });${holdAnObjectOfThisFile}
        });`,
        `import { expect, test } from "bun:test";
        test("reads a Local from the Global of the first file, resets the Global and uses the Local", () => {${takeTheObjectOfTheFirstFile}
          expect(addon.global_local_outlives_reset().name).toBe("stored by the first file");
          expect(ofTheFirstFile.name).toBe("an object of the first file");
        });`,
      );
      expect(lines, stderr).toEqual([
        'local after Reset = "stored by the first file"',
        'local after other Globals were created = "stored by the first file", its copy = "stored by the first file"',
      ]);
      expect(exitCode).toBe(0);
    });

    // On a debug build the realm of the first file is never collected: a listener of its process object is a root.
    // So the six files after it make the Globals. The marker of a file, an instance of a function of the addon, lives
    // as long as its realm, and the last file counts the markers.
    const loadTheAddon = `import { test } from "bun:test";
        test("loads the addon", () => {});`;
    const makers = [2, 3, 4, 5, 6, 7];
    const makeGlobals = (hold: (file: number) => string) =>
      makers.map(
        file => `import { test } from "bun:test";
        test("gives Globals their values", () => {
          globalThis.marker = new addon.test_v8_native_call();
          ${hold(file)}
        });`,
      );
    const markers = `const markers = () => (Bun.gc(true), heapStats().objectTypeCounts.InternalFieldObject ?? 0);`;
    // A collection does not promise to free a realm that nothing refers to. Like "--isolate: collects globals pinned
    // by leaked handles" (test/cli/test/isolation.test.ts), allow three realms that are not freed yet.
    const lagging = 3;

    it.each([
      [
        "global_local_outlives_reset",
        [
          "local after Reset = not an object: 7.500000",
          "local after other Globals were created = not an object: 7.500000, its copy = not an object: 7.500000",
        ],
      ],
      ["global_return_global_then_reset", []],
    ])(
      "keeps its value for a later file of bun test --isolate once the realm that made it is collected (%s)",
      async (name, printed) => {
        const { lines, stderr, exitCode } = await runIsolatedFiles(
          loadTheAddon,
          ...makeGlobals(
            // Only the Global refers to the string.
            file => `addon.global_hold(["a string", "of file ${file}"].join(" "));
          addon.global_store(${file}.5);`,
          ),
          `import { heapStats } from "bun:jsc";
          import { expect, test } from "bun:test";
          ${markers}
          test("reads and resets the Globals of the six files", () => {
            // Six markers if the Globals kept the realms of their files.
            expect(markers()).toBeLessThanOrEqual(${lagging});
            // Each of the eight files made one when it loaded the addon. The first file and this one still have theirs.
            expect(heapStats().objectTypeCounts.GlobalInternals).toBeLessThanOrEqual(${lagging + 2});
            expect(addon.global_held()).toEqual(${JSON.stringify(makers.map(file => `a string of file ${file}`))});
            expect(addon.global_stored()).toBe(7.5);
            addon.global_reset_held();
            // One of the Globals that the native function creates for these could take the handle that the stored Global gave back.
            const others = Array.from({ length: 200 }, (_, i) => ({ name: "other " + i }));
            expect(addon.${name}(...others)).toBe(7.5);
            addon.global_reset_held();
          });`,
        );
        expect(lines, stderr).toEqual(printed);
        expect(exitCode, stderr).toBe(0);
      },
    );

    it("keeps an object and the realm of its file for a later file of bun test --isolate until it is reset", async () => {
      const { lines, stderr, exitCode } = await runIsolatedFiles(
        loadTheAddon,
        ...makeGlobals(file => `addon.global_hold({ name: "an object of file ${file}" });`),
        `import { heapStats } from "bun:jsc";
        import { expect, test } from "bun:test";
        ${markers}
        test("reads and resets the Globals of the six files", () => {
          expect(markers()).toBe(${makers.length});
          // Returns before the next collection, so that only the Globals refer to the objects.
          const namesOfHeld = () => addon.global_held().map(object => object.name);
          expect(namesOfHeld()).toEqual(${JSON.stringify(makers.map(file => `an object of file ${file}`))});
          addon.global_reset_held();
          expect(markers()).toBeLessThanOrEqual(${lagging});
        });`,
      );
      expect(lines, stderr).toEqual([]);
      expect(exitCode, stderr).toBe(0);
    });

    // The addon prints through the C runtime, which ends a line with \r\n on Windows.
    const linesOf = (outputs: string[]) => outputs.map(output => output.split(/\r?\n/));

    it("can be reset when the thread of its Worker exits, after the Worker's VM is destroyed", async () => {
      const expected = ["a destructor reset its Globals", "the thread of the Worker has exited"];
      const outputs = await runOnBun("test_v8_global_reset_by_destructor", "[true]", asanEnv);
      expect(linesOf(outputs)).toEqual([expected, expected]);
    });

    // Only an ASAN build on Linux runs the destructors of statics when it exits: a release build ends with quick_exit.
    it.skipIf(!isASAN)("can be reset when the process exits, after the main thread's VM is destroyed", async () => {
      const expected = ["the main thread is done", "a destructor reset its Globals"];
      const env = { ...asanEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" };
      const outputs = await runOnBun("test_v8_global_reset_by_destructor", "[false]", env);
      expect(linesOf(outputs)).toEqual([expected, expected]);
    });
  });

  describe("weak Global", () => {
    // A compilation that waits in the list of the concurrent JIT is a root of the values that it saw: a heap snapshot
    // names that root "JITWorkList". These tests count the values that a collection frees, so their children compile
    // on the JS thread.
    const countEnv = { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" };
    const countAsanEnv = { ...asanEnv, BUN_JSC_useConcurrentJIT: "0" };
    const checkSameCounts = (testName: string, args?: string, env = countEnv) =>
      checkSameOutput(testName, args, undefined, env);

    it("destroys the instances of a node::ObjectWrap class whose objects are collected", async () => {
      const output = await checkSameCounts("test_v8_weak_object_wrap");
      // Node and Bun agree by now. This rules out that neither of them destroyed the instances.
      expect(output.split(/\r?\n/)).toEqual([
        "instances of a node::ObjectWrap class whose objects are garbage: 1001 of 1001 destroyed",
        "instances destroyed while JS refers to their objects: 0",
        "the Persistent of each of those is weak: true",
        "handle() of each of those is its object: true",
      ]);
    });

    it("keeps an instance of a node::ObjectWrap class between Ref() and Unref()", async () => {
      const output = await checkSameCounts("test_v8_weak_object_wrap_ref");
      expect(output.split(/\r?\n/)).toEqual([
        "the Persistent is weak before Ref(): true and after it: false",
        "instances destroyed after Ref(): 0",
        "instances destroyed after Unref(): 1",
      ]);
    });

    it("says so in IsWeak(), and is strong again after ClearWeak()", async () => {
      const output = await checkSameOutput("test_v8_weak_is_weak");
      const states =
        "IsWeak() = false, after SetWeak = true, after ClearWeak = false, ClearWeak returned the parameter = true, after a second SetWeak = true";
      expect(output.split(/\r?\n/)).toEqual([
        `Global of an object: ${states}, value = [object Object]`,
        `Global of a string: ${states}, value = "text"`,
        `Global of a small integer: ${states}, value = 7.000000`,
        `Global of a double: ${states}, value = 1.500000`,
        `Global of undefined: ${states}, value = undefined`,
        `Global of true: ${states}, value = true`,
        "empty Global: IsWeak() = false",
      ]);
    });

    it("runs the first-pass callback, then the second-pass callback that it set", async () => {
      const output = await checkSameCounts("test_v8_weak_callbacks");
      expect(output.split(/\r?\n/)).toEqual([
        "first pass of a Global that was made weak twice",
        "first pass of a Global with one pass",
        "first pass of a Global with two passes",
        "first pass of the first Global of an object",
        "first pass of the second Global of that object",
        "second pass of a Global with two passes",
        "second pass of the second Global of that object",
        "each second pass ran after its first pass: true",
      ]);
    });

    it("lets go of the values of the Globals that a weak callback destroys", async () => {
      const output = await checkSameCounts("test_v8_weak_callback_destroys_globals");
      expect(output.split(/\r?\n/)).toEqual([
        "first pass of a Global whose callback destroys other Globals",
        "values of the Globals that a weak callback destroyed: 100 of 100 collected",
      ]);
    });

    it("gives both passes of a kInternalFields callback the first two aligned pointers of the object", async () => {
      const output = await checkSameCounts("test_v8_weak_internal_fields");
      expect(output.split(/\r?\n/)).toEqual([
        "internal fields in the second pass of an object with two pointers and a second pass: its pointer its pointer",
        "internal fields of an object whose first pointer a value replaced: null its pointer",
        "internal fields of an object whose second pointer a value replaced: its pointer null",
        "internal fields of an object with one field: its pointer null",
        "internal fields of an object with one pointer and one unset field: its pointer null",
        "internal fields of an object with three pointers: its pointer its pointer",
        "internal fields of an object with two pointers and a second pass: its pointer its pointer",
        "internal fields of an object with two pointers: its pointer its pointer",
        "internal fields of an object without internal fields: null null",
      ]);
    });

    it("keeps its value while a Local that was read from it is in scope, also once it is reset", async () => {
      const output = await checkSameCounts("test_v8_weak_local_keeps_value");
      expect(output.split(/\r?\n/)).toEqual([
        "Locals of weak Globals that still are their objects after the collections: 100 of 100",
        "weak callbacks that ran while the Locals kept the objects: 0",
        "weak callbacks of those Globals once the call had returned: 100 of 100 ran",
        "Locals of weak Globals that were then reset that still are their objects after the collections: 100 of 100",
        "weak callbacks that ran while the Locals kept the objects: 0",
        "weak callbacks of the Globals that were reset: 0",
      ]);
    });

    it("keeps its value while it is the return value of a native call, also once it is reset", async () => {
      const output = await checkSameCounts("test_v8_weak_return_value");
      expect(output.split(/\r?\n/)).toEqual([
        "the return value is the object of a weak Global, after 0 weak callbacks",
        "the return value is the object of a weak Global that was then reset, after 0 weak callbacks",
        "weak callbacks once nothing refers to the objects: 1",
      ]);
    });

    // What ~ObjectWrap does when an addon's own weak callback only deletes the instance.
    it("lets a first-pass callback call ClearWeak() or SetWeak() on its Global before it resets it", async () => {
      const output = await checkSameCounts("test_v8_weak_first_pass_that_does_not_reset_first");
      expect(output.split(/\r?\n/)).toEqual([
        "first pass of a Global whose callback calls ClearWeak(): ClearWeak() returned the parameter",
        "first pass of a Global whose callback calls SetWeak(): the Global is empty after the move = true",
        "instances that a weak callback of the addon deleted: 1",
      ]);
    });

    it("keeps its value once ClearWeak() made it strong again, and runs no callback once it is reset", async () => {
      const output = await checkSameCounts("test_v8_weak_made_strong_or_reset");
      expect(output.split(/\r?\n/)).toEqual([
        "ClearWeak() returned the parameter of SetWeak",
        "the value of a Global that was weak and is strong again: alive",
        'the Global holds {"name":"held by a Global that was weak"}',
        "the value of a weak Global that was reset: collected",
        "weak callbacks that ran: 0",
      ]);
    });

    // Bun only: V8 does not give the handle of a weak Global to the next one.
    it("gives its handle to the next Global once its callback has reset it", async () => {
      const expected = [
        "first pass of a Global whose callback gives its handle back",
        "the next Global took the handle of the weak one: true",
        "ClearWeak() of the next Global returned null",
        'the next Global holds {"name":"held by the next Global"}',
      ].join("\n");
      expect(await runOnBun("test_v8_weak_handle_reuse", "[]", countEnv)).toEqual([expected, expected]);
    });

    // Bun only: node::ObjectWrap of Node 26.12.1 removes a cleanup hook in its destructor, which Node 26.3.0 refuses
    // inside a collection that an allocation started.
    it(
      "keeps the object of a node::ObjectWrap instance for handle() while the collector runs all the time",
      async () => {
        // A debug or ASAN build needs 20 times as long for a round as a release build.
        const rounds = isDebug || isASAN ? 2_000 : 20_000;
        const env = { ...countEnv, BUN_JSC_collectContinuously: "1" };
        const expected = [
          `instances whose handle() was their object after a call into JS: ${rounds} of ${rounds} intact`,
          `instances whose objects are garbage: ${rounds} of ${rounds} destroyed`,
        ].join("\n");
        expect(await runOnBun("test_v8_weak_object_wrap_churn", `[${rounds}]`, env)).toEqual([expected, expected]);
      },
      isDebug || isASAN ? 60_000 : 30_000,
    );

    it("runs the callbacks before a native call that collects returns, also while that call has a Local of another weak Global", async () => {
      const output = await checkSameCounts("test_v8_weak_collect_inside_call");
      expect(output.split(/\r?\n/)).toEqual([
        "first passes before the collection returned: 200 of 200",
        "each of them had its second pass by then: true",
        "first passes for the Global whose Local is in scope: 0, its Local is an object: true",
        "first passes for that Global once the call had returned: 1",
      ]);
    });

    it(
      "runs the first-pass callbacks in a loop that does not return to the event loop",
      async () => {
        const output = await checkSameCounts("test_v8_weak_deaths_in_a_loop", "[100000]");
        expect(output.split(/\r?\n/)).toEqual([
          "first passes before the loop ended: many",
          "their second passes ran in a later turn of the event loop: true",
        ]);
      },
      isDebug || isASAN ? 60_000 : 30_000,
    );

    it("runs the second-pass callbacks before v8::Isolate::LowMemoryNotification() returns", async () => {
      const output = await checkSameCounts("test_v8_weak_second_passes_of_forced_collection");
      expect(output.split(/\r?\n/)).toEqual([
        "first passes before the collection returned: 100 of 100 ran",
        "each of them had its second pass by then: true",
      ]);
    });

    it("leaves a pending exception to the caller of a native call that collects while second-pass callbacks are due", async () => {
      const output = await checkSameCounts("test_v8_weak_collection_with_exception_pending");
      expect(output.split(/\r?\n/)).toEqual([
        "caught: thrown before the collection",
        'passes in the end: {"first":100,"second":100}',
      ]);
    });

    // A port of TEST(TwoPassPhantomCallbacksNestedGc) of V8.
    it("does not start a second-pass callback inside another one that collects", async () => {
      const output = await checkSameCounts("test_v8_weak_second_pass_collects");
      expect(output.split(/\r?\n/)).toEqual([
        "weak Globals whose second pass has not run: 0",
        "second passes that started inside another second pass: 0",
        "checks that failed: 0",
        "first passes: 23 second passes: 23",
      ]);
    });

    // Bun only: V8 does not allow JavaScript in a second pass.
    it("reports what a second-pass callback throws as an uncaught exception, and runs the other callbacks", async () => {
      const expected = [
        "uncaught exception: thrown in a second pass",
        "second pass of another Global whose function returns: the function returned",
        "second pass of the Global whose function returns: the function returned",
        "second pass of the Global whose function throws: the function threw",
      ].join("\n");
      expect(await runOnBun("test_v8_weak_second_pass_throws", "[]", countEnv)).toEqual([expected, expected]);
    });

    it("runs the callback of a weak Global that the callback of another one reset in the same collection", async () => {
      const output = await checkSameCounts("test_v8_weak_callback_resets_another");
      expect(output.split(/\r?\n/)).toEqual([
        "first pass of the Global that also resets the first",
        "first pass of the Global that also resets the second",
      ]);
    });

    // Bun only: V8 ends the process when the Global takes its own handle again inside the callback.
    it("lets a first-pass callback give its Global another value once it has reset it", async () => {
      const expected = [
        "first pass that gave its Global another value",
        "the Global then holds the other value: true",
      ].join("\n");
      expect(await runOnBun("test_v8_weak_callback_makes_a_global", "[]", countEnv)).toEqual([expected, expected]);
    });

    // Bun only: V8 does not allow JavaScript in a second pass.
    it("stops the script of a Worker after a collection of an addon whose second-pass callback called process.exit()", async () => {
      const expected = [
        "second pass of the Global whose function calls process.exit(): the function threw",
        "the script of the Worker ran on after the collection: false",
        "second passes that were due when a cleanup hook of the Worker ran: 0",
      ].join("\n");
      expect(await runOnBun("test_v8_weak_second_pass_exits_worker", "[]", countAsanEnv)).toEqual([expected, expected]);
    });

    it("has emptied a Global that was made weak without a callback when the callbacks of other Globals of its value run", async () => {
      const output = await checkSameCounts("test_v8_weak_without_callback_is_empty_for_callbacks");
      expect(output.split(/\r?\n/)).toEqual([
        "first pass of a Global that was made weak first: the Global without a callback is empty",
        "first pass of a Global that was made weak last: the Global without a callback is empty",
      ]);
    });

    it("runs no callback for a weak Global that another thread reset, and writes nothing where one was before another thread moved it", async () => {
      const output = await checkSameCounts("test_v8_weak_other_thread");
      expect(output.split(/\r?\n/)).toEqual([
        "values of the weak Globals that another thread reset or moved: 2 of 2 collected",
        "weak callbacks of the Global that another thread reset: 0",
        "the bytes where the Global was before another thread moved it are intact: true",
      ]);
    });

    it("keeps each weak Persistent of a node::ObjectWrap class apart through Ref() and Unref() of others", async () => {
      const output = await checkSameCounts("test_v8_weak_object_wrap_ref_unref_many");
      expect(output.split(/\r?\n/)).toEqual([
        "instances destroyed while JS refers to their objects: 0 intact: true",
        "instances whose objects are garbage: 40 of 40 destroyed",
        "instances destroyed while JS refers to their objects: 0 intact: true",
        "instances whose objects are garbage: 80 of 80 destroyed",
      ]);
    });

    // Bun only: a collection of only the young objects.
    it("destroys the young instances of a node::ObjectWrap class in a collection of the young objects", async () => {
      const expected = [
        "young instances whose objects are garbage, after a collection of the young objects: 50 of 50 destroyed",
        "intact: true",
        "all instances, after collections of all objects: 250 of 250 destroyed",
      ].join("\n");
      expect(await runOnBun("test_v8_weak_object_wrap_generations", "[]", countEnv)).toEqual([expected, expected]);
    });

    // Bun only. The JS thread parks without heap access during an idle collection, so the collection ends on the
    // collector's thread, and the callbacks run when the JS thread takes the heap again.
    it.skipIf(isWindows)(
      "destroys the instances of a node::ObjectWrap class that an idle collection of a quiet process finds dead",
      async () => {
        const expected = [
          "instances that an idle collection found dead: 1000 of 1000 destroyed",
          "instances destroyed on another thread than the one that made them: 0",
        ].join("\n");
        const env = {
          ...countEnv,
          BUN_IDLE_GC_SECONDS: "1",
          BUN_GC_TIMER_DISABLE: undefined,
          BUN_GC_TIMER_INTERVAL: undefined,
          BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS: "0",
        } as any;
        expect(await runOnBun("test_v8_weak_idle_collection", "[]", env)).toEqual([expected, expected]);
      },
      60_000,
    );

    it("empties a Global that was made weak without a callback when its value dies, also after a move", async () => {
      const output = await checkSameCounts("test_v8_weak_without_callback");
      expect(output.split(/\r?\n/)).toEqual([
        "the Global is weak, the Global that it moved to is empty",
        "the Global is empty, the Global that it moved to is weak",
        "while JS refers to the value: the Global is empty, the Global that it moved to is weak",
        "once the value is garbage: the Global is empty, the Global that it moved to is empty",
      ]);
    });

    // Bun runs no weak callback once a VM is shutting down, so none for a value that is alive when a Worker ends.
    it.each(["the end of its script", "process.exit()"])(
      "runs the weak callbacks for the garbage of a Worker, and none for the values that are alive when it ends with %s",
      async end => {
        const output = await checkSameCounts("test_v8_weak_worker_exit", JSON.stringify([end]), countAsanEnv);
        expect(output.split(/\r?\n/)).toEqual([
          "weak callbacks for the garbage of the Worker ran before it exited: true",
          "each of them had its second pass: true",
          "instances of a node::ObjectWrap class were destroyed before it exited: true",
          "weak callbacks for the values that JS referred to when the Worker exited: 0",
          "weak callbacks after a cleanup hook of the Worker: 0",
        ]);
      },
    );

    it("runs the second-pass callbacks that are due before the cleanup hooks of a Worker that calls process.exit()", async () => {
      const output = await checkSameCounts("test_v8_weak_second_passes_before_exit", "[]", countAsanEnv);
      expect(output.split(/\r?\n/)).toEqual([
        "second passes were due when the Worker called process.exit(): true",
        "second passes that were due when a cleanup hook of the Worker ran: 0",
      ]);
    });

    // Runs `bun test` on files that each load the addon first. Returns what the files and the addon printed.
    async function runTestFiles(sources: string[], args: string[], env: Record<string, string>) {
      const addon = JSON.stringify(join(directories.bunRelease, "build", "Release", "v8tests.node"));
      const names = sources.map((_, i) => `file-${i + 1}.test.js`);
      using dir = tempDir(
        "v8-weak-test-files",
        Object.fromEntries(sources.map((source, i) => [names[i], `const addon = require(${addon});\n${source}`])),
      );
      await using proc = spawn({
        cmd: [bunExe(), "test", ...args, ...names.map(name => `./${name}`)],
        env: { ...bunEnv, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stdout
        .replaceAll(/^\[\w+\].+$/gm, "")
        .split(/\r?\n/)
        .filter(line => line && !line.startsWith("bun test v"));
      return { lines, stderr, exitCode };
    }

    // Bun only: each file of `bun test --isolate` runs in a realm of its own, which has a v8::Isolate of its own here.
    // A weak callback gets the isolate of the realm that is current, so a Global of an earlier file gets none. The
    // first file only loads the addon, because a debug build never collects its realm (see the Global tests).
    it("runs the weak callbacks of each file of bun test --isolate in that file, and none for the Globals of an earlier file", async () => {
      const makers = [2, 3, 4, 5, 6, 7];
      const { lines, stderr, exitCode } = await runTestFiles(
        [
          `import { test } from "bun:test";
          test("loads the addon", () => {});`,
          ...makers.map(
            () => `import { test } from "bun:test";
          test("makes weak Globals of values that are garbage, and of values that its realm keeps", async () => {
            globalThis.kept = Array.from({ length: 50 }, (_, i) => ({ i }));
            for (const value of globalThis.kept) addon.weak_hold(value, "a Global whose value its file kept", true);
            // Returns before the collection, so that only the weak Globals refer to the values.
            (() => {
              for (let i = 0; i < 50; i++) addon.weak_hold({ i }, "a Global whose value was garbage in its file", true);
            })();
            Bun.gc(true);
            Bun.gc(true);
            // The second passes run in a turn of the event loop.
            await new Promise(resolve => setImmediate(resolve));
          });`,
          ),
          `import { heapStats } from "bun:jsc";
          import { test } from "bun:test";
          test("counts what the weak callbacks did", () => {
            Bun.gc(true);
            Bun.gc(true);
            // The first file and this one still have theirs. The values that the other files kept are garbage with their realms.
            console.log("realms of the six files that are not collected: at most 3 =", heapStats().objectTypeCounts.GlobalInternals - 2 <= 3);
            const counts = {};
            for (const event of addon.weak_take_events()) counts[event] = (counts[event] ?? 0) + 1;
            for (const event of Object.keys(counts).sort()) console.log(event + ":", counts[event]);
          });`,
        ],
        ["--isolate"],
        { BUN_JSC_useConcurrentJIT: "0" },
      );
      expect(lines, stderr).toEqual([
        "realms of the six files that are not collected: at most 3 = true",
        "first pass of a Global whose value was garbage in its file: 300",
        "second pass of a Global whose value was garbage in its file: 300",
      ]);
      expect(exitCode, stderr).toBe(0);
    });

    // Bun only. At this level the test runner collects in the guard of each matcher, where the error of a failing
    // matcher is pending. A second-pass callback may use the V8 API, so none runs in a collection that Bun or
    // JavaScript starts.
    it("runs no second-pass callback in the collections of the matchers of bun test, and leaves the error of a failing matcher to its caller", async () => {
      const { lines, stderr, exitCode } = await runTestFiles(
        [
          `import { expect, test } from "bun:test";
          const passes = () => {
            const [first, , , second] = addon.weak_counted_callbacks();
            return { first, second };
          };
          expect.extend({
            toFailWithGarbage() {
              // Only the weak Globals refer to these values.
              for (let i = 0; i < 100; i++) addon.weak_hold_counted({ i }, false, true);
              return { pass: false, message: () => "the matcher failed" };
            },
          });
          test("a failing matcher throws to its caller", async () => {
            let caught;
            try {
              expect(1).toFailWithGarbage();
            } catch (error) {
              caught = error;
            }
            console.log("caught:", String(caught?.message).split("\\n")[0]);
            // No exception is pending in the collection of this matcher.
            expect(1).toBe(1);
            const inTheMatchers = passes();
            console.log("first passes ran in the collections of the matchers:", inTheMatchers.first > 0, "second passes:", inTheMatchers.second);
            for (let turn = 0; turn < 10 && passes().second < 100; turn++) {
              await new Promise(resolve => setImmediate(resolve));
              Bun.gc(true);
            }
            console.log("passes in the end:", JSON.stringify(passes()));
          });`,
        ],
        [],
        { BUN_GARBAGE_COLLECTOR_LEVEL: "2", BUN_JSC_useConcurrentJIT: "0" },
      );
      expect(lines, stderr).toEqual([
        "caught: the matcher failed",
        "first passes ran in the collections of the matchers: true second passes: 0",
        'passes in the end: {"first":100,"second":100}',
      ]);
      expect(exitCode, stderr).toBe(0);
    });

    it(
      "frees the instances of a node::ObjectWrap class that Workers leave as garbage",
      async () => {
        // A debug or ASAN build needs 20 times as long for an instance as a release build.
        const [workers, instances] = isDebug || isASAN ? [4, 25_000] : [30, 100_000];
        const main = join(directories.bunRelease, "main.js");
        await expectRssDeltaBelow([main, "test_v8_weak_object_wrap_leak", `[${workers}, ${instances}]`, "null"], {
          release: 60,
          debug: 8,
        });
      },
      isDebug || isASAN ? 60_000 : 30_000,
    );
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

async function checkSameOutput(testName: string, args?: string, thisValue?: any, env = bunEnv) {
  const [nodeResultResolution, bunReleaseResultResolution, bunDebugResultResolution] = await Promise.allSettled([
    runOn(Runtime.node, BuildMode.release, testName, args, thisValue, env),
    runOn(Runtime.bun, BuildMode.release, testName, args, thisValue, env),
    runOn(Runtime.bun, BuildMode.debug, testName, args, thisValue, env),
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
function runOnBun(testName: string, jsArgs?: string, env = bunEnv) {
  return Promise.all(
    [BuildMode.release, BuildMode.debug].map(async buildMode =>
      (await runOn(Runtime.bun, buildMode, testName, jsArgs, undefined, env))
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
async function runOn(
  runtime: Runtime,
  buildMode: BuildMode,
  testName: string,
  jsArgs?: string,
  thisValue?: any,
  env = bunEnv,
) {
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
    env,
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

// With `experimentalTargetName`, the addon is built a second time under that name with NAPI_EXPERIMENTAL defined.
function standaloneAddonFiles(targetName: string, addonCpp: string, runJs: string, experimentalTargetName?: string) {
  const target = {
    target_name: targetName,
    sources: ["addon.cpp"],
    cflags: ["-Wno-deprecated-declarations"],
    cflags_cc: ["-Wno-deprecated-declarations"],
    xcode_settings: {
      OTHER_CFLAGS: ["-Wno-deprecated-declarations"],
      OTHER_CPLUSPLUSFLAGS: ["-Wno-deprecated-declarations"],
    },
  };
  return {
    "package.json": JSON.stringify({
      name: `${targetName}-test`,
      version: "1.0.0",
      devDependencies: { "node-gyp": "~11.2.0" },
    }),
    "binding.gyp": JSON.stringify({
      targets: experimentalTargetName
        ? [target, { ...target, target_name: experimentalTargetName, defines: ["NAPI_EXPERIMENTAL"] }]
        : [target],
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
  // The addon is built once. Each test runs a script of its own.
  let dir: ReturnType<typeof tempDir> | undefined;
  let cwd = "";

  beforeAll(
    async () => {
      dir = tempDir("v8-api-from-napi", {
        ...standaloneAddonFiles(
          "hybridnapi",
          `// A Node-API addon whose callbacks also use the V8 C++ API. Node runs every Node-API callback
// inside a v8::HandleScope, so the callbacks below only open one when that's what they test.
// Each callback returns its result as a string so run.js can print everything in order.
#ifndef NAPI_EXPERIMENTAL
// For node_api_create_external_string_latin1. The second target is built with NAPI_EXPERIMENTAL, which has it too.
#define NAPI_VERSION 10
#endif
#include <node.h>
#include <node_api.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <vector>

namespace hybrid_test {

using namespace v8;

Global<Array> stashed_array;
Global<String> stashed_name;
std::atomic<int> globals_destroyed_by_finalizers{0};
// One thread at a time fills it or takes from it.
std::vector<Global<Value>*> globals_for_finalizers;

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

// Creates a V8 handle, so its scope has V8 handles.
napi_value stash_name(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value name;
  napi_get_cb_info(env, info, &argc, &name, nullptr, nullptr);
  char text[64];
  napi_get_value_string_utf8(env, name, text, sizeof text, nullptr);
  Isolate* isolate = Isolate::GetCurrent();
  stashed_name.Reset(isolate, String::NewFromUtf8(isolate, text, NewStringType::kNormal).ToLocalChecked());
  return nullptr;
}

// Creates no V8 handle, so its scope has none.
napi_value reset_stashed_name(napi_env env, napi_callback_info info) {
  stashed_name.Reset();
  return nullptr;
}

// Creates no V8 handle either.
napi_value call_without_v8_handles(napi_env env, napi_callback_info info) {
  napi_value ignored;
  call_argument(env, info, &ignored);
  return nullptr;
}

// The Local points into the handle of the Global, which the argument resets from callbacks nested in one without V8 handles.
napi_value read_stashed_name_around(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<String> local = stashed_name.Get(isolate);
  napi_value ignored;
  call_argument(env, info, &ignored);
  isolate->LowMemoryNotification();
  char text[64];
  local->WriteUtf8V2(isolate, text, sizeof text, String::WriteFlags::kNullTerminate);
  return to_napi_string(env, text);
}

void destroy_global(node_api_basic_env env, void* data, void* hint) {
  delete static_cast<Global<Value>*>(data);
  globals_destroyed_by_finalizers++;
}

// The Globals are in the isolate of the thread that calls this.
napi_value create_globals_for_finalizers(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  for (int i = 0; i < 8; i++) {
    globals_for_finalizers.push_back(new Global<Value>(isolate, Object::New(isolate)));
  }
  return nullptr;
}

// Uses no V8 API. The finalizer of an object that is alive when a Worker exits runs while the Worker's heap shuts down.
napi_value add_finalizer_that_destroys_a_global(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value object;
  napi_get_cb_info(env, info, &argc, &object, nullptr, nullptr);
  napi_add_finalizer(env, object, globals_for_finalizers.back(), destroy_global, nullptr, nullptr);
  globals_for_finalizers.pop_back();
  return object;
}

napi_value count_globals_destroyed_by_finalizers(napi_env env, napi_callback_info info) {
  napi_value count;
  napi_create_int32(env, globals_destroyed_by_finalizers, &count);
  return count;
}

struct WeakGlobal {
  // Keeps the value alive: V8 resets a weak Global once nothing else holds its value.
  Global<Value> strong;
  Global<Value> weak;
};
std::atomic<int> parameters_returned_by_clear_weak{0};

void weak_callback_that_never_runs(const WeakCallbackInfo<WeakGlobal>& info) {}

// The finalizer of the argument asks a weak Global for the parameter that SetWeak got.
napi_value add_finalizer_that_clears_weak(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value object;
  napi_get_cb_info(env, info, &argc, &object, nullptr, nullptr);
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> value = Object::New(isolate);
  auto* global = new WeakGlobal{Global<Value>(isolate, value), Global<Value>(isolate, value)};
  global->weak.SetWeak(global, weak_callback_that_never_runs, WeakCallbackType::kParameter);
  napi_add_finalizer(
      env, object, global,
      [](node_api_basic_env env, void* data, void* hint) {
        auto* global = static_cast<WeakGlobal*>(data);
        parameters_returned_by_clear_weak += global->weak.ClearWeak<WeakGlobal>() == global;
        delete global;
      },
      nullptr, nullptr);
  return object;
}

napi_value count_parameters_returned_by_clear_weak(napi_env env, napi_callback_info info) {
  napi_value count;
  napi_create_int32(env, parameters_returned_by_clear_weak, &count);
  return count;
}

napi_value create_external(napi_env env, napi_callback_info info) {
  napi_value external;
  napi_create_external(env, nullptr, nullptr, nullptr, &external);
  return external;
}

// As many Globals of one object as the argument says.
std::vector<Global<Value>>* create_globals(napi_env env, napi_value count_value) {
  uint32_t count = 0;
  napi_get_value_uint32(env, count_value, &count);
  Isolate* isolate = Isolate::GetCurrent();
  Local<Value> value = Object::New(isolate);
  auto* globals = new std::vector<Global<Value>>();
  globals->reserve(count);
  for (uint32_t i = 0; i < count; i++) {
    globals->emplace_back(isolate, value);
  }
  return globals;
}

// The finalizer of the first argument destroys as many Globals as the second argument says.
napi_value add_finalizer_that_destroys_globals(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value arguments[2];
  napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr);
  napi_add_finalizer(
      env, arguments[0], create_globals(env, arguments[1]),
      [](node_api_basic_env env, void* data, void* hint) {
        delete static_cast<std::vector<Global<Value>>*>(data);
      },
      nullptr, nullptr);
  return arguments[0];
}

std::atomic<int> cleanup_hooks_run{0};

// A cleanup hook of the env destroys as many Globals as the argument says.
napi_value add_cleanup_hook_that_destroys_globals(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value count;
  napi_get_cb_info(env, info, &argc, &count, nullptr, nullptr);
  napi_add_env_cleanup_hook(
      env,
      [](void* data) {
        delete static_cast<std::vector<Global<Value>>*>(data);
        cleanup_hooks_run++;
      },
      create_globals(env, count));
  return nullptr;
}

napi_value count_cleanup_hooks_run(napi_env env, napi_callback_info info) {
  napi_value count;
  napi_create_int32(env, cleanup_hooks_run, &count);
  return count;
}

std::atomic<int> external_string_finalizers_run{0};
char external_string_characters[] = "a property key of an external string";

// The string uses the characters above, and its finalizer runs when the engine lets go of them.
napi_value create_external_string_that_destroys_a_global(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  auto* global = new Global<Value>(isolate, Object::New(isolate));
  napi_value string = nullptr;
  bool copied = false;
  node_api_create_external_string_latin1(
      env, external_string_characters, NAPI_AUTO_LENGTH,
      [](node_api_basic_env env, void* data, void* hint) {
        delete static_cast<Global<Value>*>(hint);
        external_string_finalizers_run++;
      },
      global, &string, &copied);
  return string;
}

napi_value count_external_string_finalizers_run(napi_env env, napi_callback_info info) {
  napi_value count;
  napi_create_int32(env, external_string_finalizers_run, &count);
  return count;
}

// The env stays allocated after its VM is destroyed, because nothing deletes the strong reference.
napi_value keep_env_allocated(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value object;
  napi_get_cb_info(env, info, &argc, &object, nullptr, nullptr);
  napi_ref reference;
  napi_create_reference(env, object, 1, &reference);
  return nullptr;
}

std::atomic<int> array_buffer_globals_destroyed{0};
Global<Value>* array_buffer_global_of_last_owner = nullptr;

// The finalizer of the argument destroys a Global of a new ArrayBuffer, which nothing else refers to.
napi_value add_finalizer_that_destroys_a_global_of_an_array_buffer(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value owner;
  napi_get_cb_info(env, info, &argc, &owner, nullptr, nullptr);
  Isolate* isolate = Isolate::GetCurrent();
  Local<ArrayBuffer> buffer = ArrayBuffer::New(isolate, 8);
  memcpy(buffer->GetBackingStore()->Data(), "a value", 8);
  auto* global = new Global<Value>(isolate, buffer);
  array_buffer_global_of_last_owner = global;
  napi_add_finalizer(
      env, owner, global,
      [](node_api_basic_env env, void* data, void* hint) {
        delete static_cast<Global<Value>*>(data);
        array_buffer_globals_destroyed++;
      },
      nullptr, nullptr);
  return nullptr;
}

napi_value count_array_buffer_globals_destroyed(napi_env env, napi_callback_info info) {
  napi_value count;
  napi_create_int32(env, array_buffer_globals_destroyed, &count);
  return count;
}

// The Local points into the handle of the Global of the last owner. The argument makes the finalizer of that owner run.
napi_value read_array_buffer_global_around(napi_env env, napi_callback_info info) {
  Isolate* isolate = Isolate::GetCurrent();
  Local<ArrayBuffer> local = array_buffer_global_of_last_owner->Get(isolate).As<ArrayBuffer>();
  napi_value ignored;
  call_argument(env, info, &ignored);
  isolate->LowMemoryNotification();
  return to_napi_string(env, static_cast<const char*>(local->GetBackingStore()->Data()));
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
      {"stashName", stash_name},
      {"resetStashedName", reset_stashed_name},
      {"callWithoutV8Handles", call_without_v8_handles},
      {"readStashedNameAround", read_stashed_name_around},
      {"createGlobalsForFinalizers", create_globals_for_finalizers},
      {"addFinalizerThatDestroysAGlobal", add_finalizer_that_destroys_a_global},
      {"countGlobalsDestroyedByFinalizers", count_globals_destroyed_by_finalizers},
      {"addFinalizerThatClearsWeak", add_finalizer_that_clears_weak},
      {"countParametersReturnedByClearWeak", count_parameters_returned_by_clear_weak},
      {"createExternal", create_external},
      {"addFinalizerThatDestroysGlobals", add_finalizer_that_destroys_globals},
      {"addCleanupHookThatDestroysGlobals", add_cleanup_hook_that_destroys_globals},
      {"countCleanupHooksRun", count_cleanup_hooks_run},
      {"createExternalStringThatDestroysAGlobal", create_external_string_that_destroys_a_global},
      {"countExternalStringFinalizersRun", count_external_string_finalizers_run},
      {"keepEnvAllocated", keep_env_allocated},
      {"addFinalizerThatDestroysAGlobalOfAnArrayBuffer", add_finalizer_that_destroys_a_global_of_an_array_buffer},
      {"countArrayBufferGlobalsDestroyed", count_array_buffer_globals_destroyed},
      {"readArrayBufferGlobalAround", read_array_buffer_global_around},
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
console.log("global handle:", addon.readStashedArray());
addon.stashName("held");
const shown = addon.readStashedNameAround(() =>
  addon.callWithoutV8Handles(() => {
    addon.resetStashedName();
    addon.stashName("nested 1");
    addon.stashName("nested 2");
  }),
);
console.log("local read around nested callbacks that reset its Global:", shown);
addon.resetStashedName();
const { Worker } = require("node:worker_threads");
// Resolves once the Worker has exited. A Worker has one GlobalInternals once it has used the V8 API.
function runWorker(createsGlobals) {
  const { promise, resolve, reject } = Promise.withResolvers();
  let internals;
  new Worker(require.resolve("./worker.js"), { workerData: createsGlobals })
    .on("message", count => (internals = count))
    .on("error", reject)
    .on("exit", () => resolve(internals + " GlobalInternals, " + addon.countGlobalsDestroyedByFinalizers() + " Globals destroyed by finalizers so far"));
  return promise;
}
(async () => {
  console.log("Worker that creates the Globals:", await runWorker(true));
  addon.createGlobalsForFinalizers();
  console.log("Worker that gets the Globals of the main thread:", await runWorker(false));
})();`,
          // A finalizer of this one runs inside the collection that finds its object dead.
          "hybridnapi_experimental",
        ),
        "worker.js": `const addon = require("./build/Release/hybridnapi");
const { parentPort, workerData } = require("node:worker_threads");
if (workerData) addon.createGlobalsForFinalizers();
globalThis.kept = Array.from({ length: 8 }, () => addon.addFinalizerThatDestroysAGlobal({}));
parentPort.postMessage(require("bun:jsc").heapStats().objectTypeCounts.GlobalInternals ?? 0);`,
        // Node runs the finalizers of a Worker's live objects when the Worker exits too, before its isolate is disposed.
        "clear-weak.js": `const addon = require("./build/Release/hybridnapi");
const { Worker } = require("node:worker_threads");
new Worker(require.resolve("./clear-weak-worker.js")).on("exit", () => {
  const returned = addon.countParametersReturnedByClearWeak();
  console.log("finalizers that got the parameter of SetWeak back from ClearWeak:", returned, "of 8");
});`,
        "clear-weak-worker.js": `const addon = require("./build/Release/hybridnapi");
globalThis.kept = Array.from({ length: 8 }, () => addon.addFinalizerThatClearsWeak({}));`,
        "rss.js": `// Runs Workers one after another and prints how far the highest RSS of the process grows after the first four.
module.exports = async function printRssGrowth(runWorker, workers) {
  // The highest RSS that the process has after one of the Workers has exited.
  async function highestRssAfter(workers) {
    let highest = 0;
    for (let i = 0; i < workers; i++) {
      await runWorker(i);
      highest = Math.max(highest, process.memoryUsage.rss());
    }
    return highest;
  }
  // The first four Workers bring the process to the size that it keeps.
  const before = await highestRssAfter(4);
  const after = await highestRssAfter(workers);
  console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
};`,
        "leak.js": `const { Worker } = require("node:worker_threads");
const [workers, globals] = process.argv.slice(2).map(Number);
// Resolves once the Worker has exited.
function runWorker(index) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const worker = new Worker(require.resolve("./leak-worker.js"), { workerData: { index, globals } });
  worker.on("error", reject).on("exit", resolve);
  return promise;
}
require("./rss.js")(runWorker, workers);`,
        "leak-worker.js": `const addon = require("./build/Release/hybridnapi");
const { index, globals } = require("node:worker_threads").workerData;
let kept = {};
if (index % 2) {
  // When a VM ends, JSC destroys the first eight cells of each kind after all others. This external is one of them,
  // so its finalizer runs at the end of the heap's shutdown, and that of the plain object at its start.
  kept = addon.createExternal();
}
// The object is alive when the Worker exits, so its finalizer runs while the Worker's heap shuts down.
globalThis.kept = addon.addFinalizerThatDestroysGlobals(kept, globals);`,
        "hook-leak.js": `const addon = require("./build/Release/hybridnapi");
const { Worker } = require("node:worker_threads");
const [end, workers, globals] = process.argv.slice(2);
// Resolves once the Worker has exited. What a Worker writes about its uncaught error is not the output of this script.
function runWorker() {
  const { promise, resolve } = Promise.withResolvers();
  const workerData = { end, globals: Number(globals) };
  const worker = new Worker(require.resolve("./hook-leak-worker.js"), { workerData, stderr: true });
  worker.stderr.resume();
  worker.on("message", () => worker.terminate());
  worker.on("error", () => {}).on("exit", resolve);
  return promise;
}
require("./rss.js")(runWorker, Number(workers)).then(() => {
  const hooks = addon.countCleanupHooksRun();
  if (hooks !== Number(workers) + 4) console.error("cleanup hooks that ran:", hooks);
});`,
        "hook-leak-worker.js": `const addon = require("./build/Release/hybridnapi");
const { parentPort, workerData } = require("node:worker_threads");
addon.addCleanupHookThatDestroysGlobals(workerData.globals);
switch (workerData.end) {
  case "process.exit()":
    process.exit(0);
  case "worker.terminate()":
    parentPort.postMessage("ready");
    setInterval(() => {}, 1000);
    break;
  case "an uncaught error":
    throw new Error("the Worker ends with this error");
}`,
        "external-string.js": `const addon = require("./build/Release/hybridnapi");
const { Worker } = require("node:worker_threads");
new Worker(require.resolve("./external-string-worker.js")).on("exit", code => {
  console.log("the Worker exited with code", code);
  console.log("finalizers of external strings that destroyed a Global:", addon.countExternalStringFinalizersRun());
});`,
        "external-string-worker.js": `const addon = require("./build/Release/hybridnapi");
addon.keepEnvAllocated({});
const object = {};
// A VM lets go of the last string that it used as a property key after its heap, and after what belongs to the heap.
object[addon.createExternalStringThatDestroysAGlobal()] = 1;`,
        "experimental.js": `const addon = require("./build/Release/hybridnapi_experimental");
const { heapStats } = require("bun:jsc");
const { Worker } = require("node:worker_threads");
const count = 1000;
const liveArrayBuffers = () => (Bun.gc(true), heapStats().objectTypeCounts.ArrayBuffer ?? 0);
const others = liveArrayBuffers();
// Each owner has a Global of a new ArrayBuffer. Returns before a collection can run, so that nothing refers to the owners.
function makeOwners() {
  for (let i = 0; i < count; i++) addon.addFinalizerThatDestroysAGlobalOfAnArrayBuffer({});
}
let finalizersBefore = 0;
function finalizersSince() {
  const finalizers = addon.countArrayBufferGlobalsDestroyed() - finalizersBefore;
  finalizersBefore += finalizers;
  return finalizers;
}
// Leaves room for a few objects that something other than an owner or a Global keeps alive.
function report(what, number, state) {
  console.log(what + ":", number >= count - 10 ? state : "only " + number + " of " + count + " " + state);
}

makeOwners();
Bun.gc(true);
report("finalizers of owners that had run when the collection returned", finalizersSince(), "all");
report("values of their Globals after one more collection", count - (liveArrayBuffers() - others), "collected");

makeOwners();
let finalizersInTheCall, aliveInTheCall;
const local = addon.readArrayBufferGlobalAround(() => {
  Bun.gc(true);
  finalizersInTheCall = finalizersSince();
  aliveInTheCall = liveArrayBuffers() - others;
});
report("finalizers of owners that had run under a native call with a Local of one of their Globals", finalizersInTheCall, "all");
report("values of their Globals while that call ran", aliveInTheCall, "alive");
console.log("the Local after the collections:", local);
report("values of their Globals once the call had returned", count - (liveArrayBuffers() - others), "collected");

new Worker(require.resolve("./experimental-worker.js"), { workerData: count }).on("exit", code => {
  console.log("the Worker exited with code", code);
  report("finalizers of the owners that the Worker left as garbage", finalizersSince(), "all");
});`,
        "experimental-worker.js": `const addon = require("./build/Release/hybridnapi_experimental");
for (let i = 0; i < require("node:worker_threads").workerData; i++) addon.addFinalizerThatDestroysAGlobalOfAnArrayBuffer({});`,
      });
      cwd = String(dir);
      await buildStandaloneAddon(cwd);
    },
    10 * 60 * 1000,
  );

  afterAll(() => dir?.[Symbol.dispose]());

  it("creates handles in the Node-API scope, keeps them alive, and releases them when it closes", async () => {
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
      "local read around nested callbacks that reset its Global: held",
      "Worker that creates the Globals: 1 GlobalInternals, 8 Globals destroyed by finalizers so far",
      "Worker that gets the Globals of the main thread: 0 GlobalInternals, 16 Globals destroyed by finalizers so far",
    ]);
    expect(exitCode).toBe(0);
  });

  it("returns the parameter of SetWeak to a finalizer that runs when a Worker exits", async () => {
    const runs = await Promise.all(
      [bunExe(), await nodeExeMatchingAbi()].map(exe => runStandaloneAddon(cwd, "clear-weak.js", exe)),
    );
    for (const { lines, err, exitCode } of runs) {
      expect(lines, `stderr:\n${err}`).toEqual([
        "finalizers that got the parameter of SetWeak back from ClearWeak: 8 of 8",
      ]);
      expect(exitCode).toBe(0);
    }
  });

  // Each Worker of the RSS tests has 250,000 Globals, whose handles take 7 MB. A debug or ASAN build needs 20 times as
  // long for a Global as a release build, so it runs 4 Workers where a release build runs 30.
  const leakWorkers = isDebug || isASAN ? "4" : "30";
  const leakTimeout = isDebug || isASAN ? 120_000 : 30_000;

  it(
    "frees the handles of the Globals that a finalizer destroys when a Worker exits",
    async () => {
      await expectRssDeltaBelow([join(cwd, "leak.js"), leakWorkers, "250000"], { release: 60, debug: 8 });
    },
    leakTimeout,
  );

  it(
    "frees the handles of the Globals that a cleanup hook destroys when a Worker exits",
    async () => {
      const ends = ["the script ends", "process.exit()", "worker.terminate()", "an uncaught error"];
      const results = await Promise.allSettled(
        ends.map(end =>
          expectRssDeltaBelow([join(cwd, "hook-leak.js"), end, leakWorkers, "250000"], { release: 60, debug: 8 }),
        ),
      );
      expect(
        results.map((result, i) => `${ends[i]}: ${result.status === "rejected" ? result.reason : "freed"}`),
      ).toEqual(ends.map(end => `${end}: freed`));
    },
    leakTimeout,
  );

  it("can be reset by the finalizer of an external string that a Worker's VM lets go of last", async () => {
    const runs = await Promise.all(
      [bunExe(), await nodeExeMatchingAbi()].map(exe => runStandaloneAddon(cwd, "external-string.js", exe, asanEnv)),
    );
    for (const { lines, err, exitCode } of runs) {
      expect(lines, `stderr:\n${err}`).toEqual([
        "the Worker exited with code 0",
        "finalizers of external strings that destroyed a Global: 1",
      ]);
      expect(exitCode).toBe(0);
    }
  });

  it("can be reset by a finalizer that runs inside a collection", async () => {
    const { lines, err, exitCode } = await runStandaloneAddon(cwd, "experimental.js");
    expect(lines, `stderr:\n${err}`).toEqual([
      "finalizers of owners that had run when the collection returned: all",
      "values of their Globals after one more collection: collected",
      "finalizers of owners that had run under a native call with a Local of one of their Globals: all",
      "values of their Globals while that call ran: alive",
      "the Local after the collections: a value",
      "values of their Globals once the call had returned: collected",
      "the Worker exited with code 0",
      "finalizers of the owners that the Worker left as garbage: all",
    ]);
    expect(exitCode).toBe(0);
  });
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
