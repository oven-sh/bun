// ./addon-allocations/addon.cpp allocates in every way a native addon does and releases the blocks where addons do.
// It is built with the system's C++ compiler against the headers in src/runtime/napi, without node-gyp.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, isWindows, strictSystemAllocatorEnv, tempDir } from "harness";
import { join, resolve } from "path";

const compiler = process.env.CXX || Bun.which("c++") || Bun.which("clang++") || Bun.which("g++");
const sources = join(import.meta.dir, "addon-allocations");

if (!isWindows && !compiler)
  console.error(
    "SKIPPED: test/napi/addon-allocations.test.ts: there is no C++ compiler: not in $CXX, no c++, clang++ or g++",
  );

// The addon uses POSIX threads and allocation functions.
describe.skipIf(isWindows || !compiler)("a native addon's allocations", () => {
  const folder = String(tempDir("addon-allocations", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const addon = join(folder, "allocations.node");
  const weakStubs = join(folder, "weak-stubs.node");
  const replacesOperators = join(folder, "replaces-operators.node");
  const loadedAfter = join(folder, "loaded-after.node");

  const exitLibrary = join(folder, "exit-instead-of-quick-exit.so");

  // exit() runs atexit handlers and static destructors. quick_exit() does not.
  const callsExit = isMacOS || isASAN;
  const variants: Record<string, { env: Record<string, string>; callsExit: boolean }> = {
    "the system allocator as it is": { env: { MallocDebugReport: "crash" }, callsExit },
    ...(isMacOS && { "the system allocator checking itself": { env: strictSystemAllocatorEnv, callsExit } }),
    ...(isLinux &&
      !callsExit && { "exit() in place of quick_exit()": { env: { LD_PRELOAD: exitLibrary }, callsExit: true } }),
  };

  async function run(script: string, args: string[], env: Record<string, string | undefined>) {
    await using child = Bun.spawn({
      cmd: [bunExe(), join(sources, script), ...args],
      env: { ...bunEnv, ...env },
      cwd: sources,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { stdout, stderr, exitCode, signalCode: child.signalCode };
  }

  async function compile(source: string, output: string) {
    await using compilation = Bun.spawn({
      cmd: [
        compiler!,
        "-std=c++17",
        "-O1",
        "-g",
        "-shared",
        "-fPIC",
        "-pthread",
        ...(isMacOS ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        join(sources, source),
        "-o",
        output,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await compilation.stderr.text(), exitCode: await compilation.exited }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  }

  beforeAll(async () => {
    await Promise.all([
      compile("addon.cpp", addon),
      compile("weak-stubs.cpp", weakStubs),
      ...(isMacOS
        ? [compile("replaces-operators.cpp", replacesOperators), compile("loaded-after.cpp", loadedAfter)]
        : []),
      ...(isLinux ? [compile("exit-instead-of-quick-exit.cpp", exitLibrary)] : []),
    ]);
  }, 120_000);

  async function evaluate(script: string) {
    await using child = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, MallocDebugReport: "crash" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { stdout, stderr, exitCode, signalCode: child.signalCode };
  }

  const whenTheProcessEnds = ["released by an atexit handler", "released by a static destructor"];
  const whenTheEnvironmentEnds = [
    "released by an asynchronous cleanup hook",
    "released by an environment cleanup hook",
    "released by the finalizer of the instance data",
  ];
  // When a thread ends is not tied to when the process does.
  const whenAThreadEnds = ["released by a thread-local destructor"];

  // The places that release blocks as the process ends print a line each.
  async function printedBy(addonFunction: string, env: Record<string, string> = {}) {
    const result = await run("operators.js", [addonFunction], { MallocDebugReport: "crash", ADDON: addon, ...env });
    return { ...result, stdout: result.stdout.replace(/^released by .*\n/gm, "") };
  }

  // An ASAN build of the runtime has operators of ASAN's in front of both.
  test.skipIf(!isMacOS || isASAN)(
    "the addon calls the operator new and the operator delete of the C++ library, not the runtime's",
    async () => {
      expect(await printedBy("printImagesOfOperators")).toEqual({
        stdout: "operator new: /usr/lib/libc++abi.dylib\noperator delete: /usr/lib/libc++abi.dylib\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    120_000,
  );

  test.skipIf(isMacOS && isASAN)(
    "operator new tells the addon of a request that it cannot serve, as the C++ standard says",
    async () => {
      expect(await printedBy("askForTooMuch")).toEqual({
        stdout: [
          "operator new (std::nothrow): the new handler ran, then null",
          "operator new[] (std::nothrow): the new handler ran, then null",
          "operator new (std::nothrow) with an alignment: the new handler ran, then null",
          "operator new[] (std::nothrow) with an alignment: the new handler ran, then null",
          "operator new: std::bad_alloc",
          "operator new[]: std::bad_alloc",
          "operator new with an alignment: std::bad_alloc",
          "operator new[] with an alignment: std::bad_alloc",
          "std::wstring::reserve: std::bad_alloc",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    120_000,
  );

  // The report is the runtime's on macOS, where the addon and the runtime share one C++ library.
  test.skipIf(!isMacOS || isASAN)(
    "a request that operator new cannot serve and the addon does not catch is reported as out of memory",
    async () => {
      // CI collects crash reports for crashes that nobody expects.
      const result = await printedBy("askForTooMuchAndLeaveIt", {
        BUN_CRASH_REPORT_URL: "",
        BUN_ENABLE_CRASH_REPORTING: "0",
      });
      expect(result.stderr).toContain("Bun has run out of memory");
      expect(result.stderr).not.toContain("A C++ exception occurred");
      expect(result.stdout).toBe("");
      expect(result.exitCode).not.toBe(0);
    },
    120_000,
  );

  test.skipIf(!isMacOS || isASAN)(
    "another exception that the addon does not catch is not reported as out of memory",
    async () => {
      const result = await printedBy("throwAndLeaveIt", {
        BUN_CRASH_REPORT_URL: "",
        BUN_ENABLE_CRASH_REPORTING: "0",
      });
      expect(result.stderr).toContain("A C++ exception occurred");
      expect(result.stderr).not.toContain("Bun has run out of memory");
      expect(result.stdout).toBe("");
      expect(result.exitCode).not.toBe(0);
    },
    120_000,
  );

  // With an operator delete that the runtime exports, the addon has the library's operator new and the runtime's
  // operator delete, which cannot release the library's block.
  test.skipIf(!isMacOS || isASAN)(
    "an addon that is loaded after a library with operators of its own calls that library's operators",
    async () => {
      const script = `require(${JSON.stringify(replacesOperators)}); require(${JSON.stringify(loadedAfter)});`;
      expect(await evaluate(script)).toEqual({
        stdout:
          "operator new: replaces-operators.node\noperator delete: replaces-operators.node\nreleased 1000 blocks\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    120_000,
  );

  // The addon of Dawn (the webgpu package) has such stubs. On macOS the loader looks in the runtime for a function to
  // put in their place only where the runtime's header has MH_WEAK_DEFINES, which an ASAN build lacks.
  test.skipIf(isMacOS && isASAN)(
    "a Node-API function of the runtime takes the place of an addon's weak stub of it",
    async () => {
      expect(await evaluate(`console.log(require(${JSON.stringify(weakStubs)}).text);`)).toEqual({
        stdout: "made by the runtime\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    120_000,
  );

  describe.each(Object.keys(variants))("with %s", variant => {
    const { env, callsExit } = variants[variant];

    test.concurrent.each([
      { how: "the script returns", exitCode: 0, endsTheEnvironment: true },
      { how: "process.exit is called", exitCode: 7, endsTheEnvironment: false },
      { how: "an exception is not caught", exitCode: 1, endsTheEnvironment: false },
      { how: "a rejection is not handled", exitCode: 1, endsTheEnvironment: false },
      { how: "a worker returns", exitCode: 0, endsTheEnvironment: true },
      { how: "a worker calls process.exit", exitCode: 0, endsTheEnvironment: true },
      { how: "a busy worker is terminated", exitCode: 0, endsTheEnvironment: true },
      { how: "process.exit is called beside a busy worker", exitCode: 5, endsTheEnvironment: false },
    ])(
      "when $how, the process ends as it does without the addon",
      async ({ how, exitCode, endsTheEnvironment }) => {
        // Where the other threads are when the process ends differs from run to run.
        for (let repeat = 0; repeat < 3; repeat++) {
          const [without, withAddon] = await Promise.all([
            run("exit.js", [how], env),
            run("exit.js", [how], { ...env, ADDON: addon }),
          ]);
          expect(without).toMatchObject({ exitCode, signalCode: null });

          expect({ ...withAddon, stdout: withAddon.stdout.replace(/^released by .*\n/gm, "") }).toEqual(without);

          const released = new Set(withAddon.stdout.split("\n").filter(line => line.startsWith("released by ")));
          expect([...whenTheProcessEnds, ...whenTheEnvironmentEnds, ...whenAThreadEnds]).toEqual(
            expect.arrayContaining([...released]),
          );
          expect([...released]).toEqual(
            expect.arrayContaining([
              ...(callsExit ? whenTheProcessEnds : []),
              ...(endsTheEnvironment ? whenTheEnvironmentEnds : []),
            ]),
          );
        }
      },
      120_000,
    );

    test("finalizers release what the addon lent, and the addon reads what it wrote to the runtime's memory", async () => {
      const result = await run("ownership.js", [], { ...env, ADDON: addon });
      expect(result).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0, signalCode: null });
      // The collector scans the stack conservatively, so a few of the 620 values may stay.
      const report = JSON.parse(result.stdout.split("\n")[0]);
      expect(report.failures).toEqual([]);
      expect(report.blocksOnLoanAfterCollecting).toBeLessThan(10);
      expect(Number(/^finalizers that ran as the environment ended: (\d+)$/m.exec(result.stdout)?.[1])).toBeGreaterThan(
        0,
      );
    }, 120_000);
  });
});
