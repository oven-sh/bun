// Python's C API (abi3t): see README.md. C sources are compiled here, with the machine's compiler, against the header in include/; each
// script must print what CPython 3.15 printed for the same source compiled against CPython's own headers.
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const compiler = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

// These builds take seconds to start Python, and a collection at every turn takes them minutes.
setDefaultTimeout(isDebug || isASAN ? 600_000 : 60_000);

/** Libraries that a script of the same name loads with ctypes.PyDLL. */
const libraries = ["references"];
/** Libraries for the tests at the end. */
const others = ["without_gil"];

// The collector is half of this. Each script runs as it comes and in modes that make the collector come at other times, or that make a cell
// which was freed too early show.
const modes: Record<string, Record<string, string>> = {
  "as it comes": {},
  "a collection every few allocations": { BUN_JSC_slowPathAllocsBetweenGCs: isDebug || isASAN ? "53" : "7" },
  "collecting all the time": { BUN_JSC_collectContinuously: "1" },
  "freed cells are overwritten": { BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" },
  "a heap that hardly grows": { BUN_JSC_heapGrowthMaxIncrease: "0.1" },
  "no generations, nothing concurrent": { BUN_JSC_useGenerationalGC: "0", BUN_JSC_useConcurrentGC: "0" },
};

describe.skipIf(!isLinux || !compiler)("the C API", () => {
  let built: ReturnType<typeof tempDir>;

  beforeAll(async () => {
    built = tempDir("python-capi", {});
    await Promise.all(
      [...libraries, ...others].map(async name => {
        await using proc = Bun.spawn({
          cmd: [
            compiler!,
            "-O1",
            "-g",
            "-fPIC",
            "-shared",
            "-pthread",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            join(root, "include"),
            join(root, `${name}.c`),
            "-o",
            join(String(built), `lib${name}.so`),
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ name, stdout, stderr, exitCode }).toEqual({ name, stdout: "", stderr: "", exitCode: 0 });
      }),
    );
  });

  for (const name of libraries) {
    for (const [mode, options] of Object.entries(modes)) {
      test.concurrent(`${name}: ${mode}`, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), join(root, `${name}.py`), join(String(built), `lib${name}.so`)],
          env: { ...bunEnv, ...options },
          cwd: String(built),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(stdout).toBe(readFileSync(join(root, `${name}.expected`), "utf8"));
        expect(exitCode).toBe(0);
      });
    }
  }

  // In CPython this spoils a count now and then. Here the counts are in a table that only the thread with the GIL may change.
  test.concurrent("Py_INCREF and Py_DECREF in a thread without the GIL are refused", async () => {
    const script = join(String(built), "without_gil.py");
    await Bun.write(
      script,
      `
import ctypes, gc, sys, weakref
lib = ctypes.PyDLL(sys.argv[1])
lib.change_in_another_thread.argtypes = [ctypes.py_object, ctypes.c_int]
lib.change_in_another_thread.restype = ctypes.c_long
lib.take_here.argtypes = lib.give_back_here.argtypes = [ctypes.py_object, ctypes.c_long]
lib.take_here.restype = lib.give_back_here.restype = None
class Thing: pass
thing = Thing()
ref = weakref.ref(thing)
print(lib.change_in_another_thread(thing, 0))
lib.take_here(thing, 1000)
print(lib.change_in_another_thread(thing, 1))
del thing
gc.collect()
print(ref() is not None)
lib.give_back_here(ref(), 1000)
gc.collect()
print(ref())
`,
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), script, join(String(built), "libwithout_gil.so")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe(
      "Python: Py_INCREF or Py_DECREF was called by a thread that does not hold the GIL; the count stays as it was\n",
    );
    expect(stdout).toBe("0\n0\nTrue\nNone\n");
    expect(exitCode).toBe(0);
  });
});
