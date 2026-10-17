import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, tempDirWithFiles } from "harness";
import path from "node:path";
import { symbols, test_skipped } from "../../src/jsc/bindings/libuv/generate_uv_posix_stubs_constants";

// On POSIX, bun exports a stub for every unsupported libuv symbol so that a
// NAPI addon referencing it loads, and calling it aborts with a message naming
// the function. Coverage here comes in three layers:
//
// 1. plugin.c (generated) contains a typed call to every symbol in the list;
//    compiling it in beforeAll type-checks all of them against the libuv
//    headers on every run.
// 2. symbol_check.c resolves every symbol through the dynamic linker
//    (dlsym/dladdr) in-process and asserts each one lands in the same binary
//    that provides N-API, i.e. bun itself. This is the all-symbols guarantee
//    that every stub is exported and reachable, and it costs no subprocesses.
//    It covers the full list, including the test_skipped symbols: those are
//    exported stubs too, they just have no generated typed call in plugin.c,
//    so only layers 1 and 3 exempt them.
// 3. The abort path (stub -> CrashHandler__unsupportedUVFunction -> crash
//    message naming the symbol) costs one aborted bun process per symbol, so
//    it runs for a fixed sample: the first symbol of every 8th API family
//    (uv_fs_*, uv_tcp_*, ...) plus the last symbol in the list. The formatter
//    is shared by all stubs, so the sample exercises the mechanism while
//    layers 1 and 2 keep per-symbol coverage.
const callable_symbols = symbols.filter(s => !test_skipped.includes(s));

const family_reps: string[] = [];
{
  const seen = new Set<string>();
  for (const s of callable_symbols) {
    const family = /^uv_[a-z0-9]+/.exec(s)![0];
    if (!seen.has(family)) {
      seen.add(family);
      family_reps.push(s);
    }
  }
}
const abort_sample = [
  ...new Set([...family_reps.filter((_, i) => i % 8 === 0), callable_symbols[callable_symbols.length - 1]]),
];

const fixtures = path.join(import.meta.dir, "uv-stub-stuff");
const napiInclude = path.join(import.meta.dir, "../../src/runtime/napi");
const libuvInclude = path.join(import.meta.dir, "../../src/jsc/bindings/libuv");

// We use libuv on Windows
describe.if(!isWindows)("uv stubs", () => {
  let tempdir: string = "";
  const addon = (name: string) => path.join(tempdir, `${name}.node`);

  beforeAll(async () => {
    tempdir = tempDirWithFiles("uv-stubs", {});
    const cc = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
    if (!cc) throw new Error("uv_stub.test.ts: no C compiler (cc/clang/gcc) found in $PATH");

    // The addons are plain C using only stable napi v1 declarations, so they
    // compile against bun's own copy of the node headers: no node-gyp, no
    // package install, no header download.
    async function compile(source: string, name: string) {
      const cmd = [
        cc,
        "-shared",
        "-fPIC",
        `-DNODE_GYP_MODULE_NAME=${name}`,
        "-I",
        napiInclude,
        "-I",
        libuvInclude,
        source,
        "-o",
        addon(name),
      ];
      // The uv_* and napi_* references stay undefined until bun loads the
      // addon; macOS's linker rejects that without dynamic_lookup.
      if (isMacOS) cmd.push("-undefined", "dynamic_lookup");
      // dlsym/dladdr live in libdl on pre-2.34 glibc.
      if (isLinux) cmd.push("-ldl");
      await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "ignore", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`cc failed for ${source}:\n${stderr}`);
    }

    await Promise.all([
      compile(path.join(fixtures, "plugin.c"), "plugin"),
      compile(path.join(fixtures, "good_plugin.c"), "good_plugin"),
      compile(path.join(fixtures, "symbol_check.c"), "symbol_check"),
    ]);
  }, 60_000);

  test("every stub symbol resolves into the bun binary", () => {
    const { checkSymbols } = require(addon("symbol_check"));
    const { missing, modules, napiModule } = checkSymbols(symbols);
    expect(missing).toEqual([]);
    expect([...new Set(modules)]).toEqual([napiModule]);
    expect(modules).toHaveLength(symbols.length);
  });

  // The bodies share no mutable state (tempdir is read-only after beforeAll),
  // so run them concurrently.
  // An aborting debug/ASAN bun takes several seconds (startup + crash-handler
  // symbolication), and these run concurrently on a shared CPU budget, so the
  // local 5s default timeout is not enough.
  for (const symbol of abort_sample) {
    test.concurrent(
      `unsupported: ${symbol}`,
      async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", `require(${JSON.stringify(addon("plugin"))}).callUVFunc(${JSON.stringify(symbol)})`],
          env: { ...bunEnv, BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB: "1" },
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        // The crash banner colors the symbol name even when piped.
        const plain = Bun.stripANSI(stderr);
        expect(plain).toContain(
          `Bun encountered a crash when running a NAPI module that tried to call\nthe ${symbol} libuv function.`,
        );
        expect(plain).toContain(`unsupported uv function: ${symbol}`);
        expect(exitCode).not.toBe(0);
      },
      90_000,
    );
  }

  test.concurrent(
    "should not crash when calling supported uv functions",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `require(${JSON.stringify(addon("good_plugin"))}); console.log("HI!")`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // good_plugin's init calls uv_os_getpid (a real implementation, not a
      // stub) and prints the pid, which is proc.pid since Bun.spawn execs the
      // child directly. C stdio may flush it after console.log's output, so
      // don't assert ordering. stderr is part of the assertion so a crash
      // banner shows up in the failure diff, but debug builds may print
      // benign noise there, so its contents aren't pinned.
      expect({ exitCode, lines: stdout.split("\n"), stderr }).toEqual({
        exitCode: 0,
        lines: expect.arrayContaining([String(proc.pid), "HI!"]),
        stderr: expect.any(String),
      });
    },
    90_000,
  );
});
