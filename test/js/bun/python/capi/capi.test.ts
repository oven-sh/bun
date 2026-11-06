// Python's C API (abi3t): see README.md. C sources are compiled here, with the machine's compiler, against the header in include/; each
// script must print what CPython 3.15 printed for the same source compiled against CPython's own headers.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const compiler = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

/** Libraries that a script of the same name loads with ctypes.PyDLL. */
const libraries = ["references", "ownership", "loaded", "raises_as_loaded", "first_by_cdll", "identity"];
/** Libraries for the scripts in here/ alone. */
const others = ["without_gil"];

// These builds take seconds to start Python, and a collection at every turn takes them minutes.
const isSlow = isDebug || isASAN;
const limit = isSlow ? 120_000 : 20_000;

// The collector is half of this. Each script runs as it comes and in modes that make the collector come at other times, or that make a cell
// which was freed too early show.
const modes: Record<string, { options: Record<string, string>; limit: number }> = {
  "as it comes": { options: {}, limit },
  "a collection every few allocations": {
    options: { BUN_JSC_slowPathAllocsBetweenGCs: isSlow ? "53" : "7" },
    limit: isSlow ? 600_000 : 60_000,
  },
  "collecting all the time": { options: { BUN_JSC_collectContinuously: "1" }, limit: isSlow ? 600_000 : limit },
  "freed cells are overwritten": { options: { BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" }, limit },
  "a heap that hardly grows": { options: { BUN_JSC_heapGrowthMaxIncrease: "0.1" }, limit },
  "no generations, nothing concurrent": {
    options: { BUN_JSC_useGenerationalGC: "0", BUN_JSC_useConcurrentGC: "0" },
    limit,
  },
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

  async function run(script: string, library: string, options: Record<string, string> = {}, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(root, script), join(String(built), `lib${library}.so`), ...args],
      env: { ...bunEnv, ...options },
      cwd: String(built),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  for (const name of libraries) {
    for (const [mode, { options, limit }] of Object.entries(modes)) {
      test.concurrent(
        `${name}: ${mode}`,
        async () => {
          const { stdout, stderr, exitCode } = await run(`${name}.py`, name, options);
          expect(stderr).toBe("");
          expect(stdout).toBe(readFileSync(join(root, `${name}.expected`), "utf8"));
          expect(exitCode).toBe(0);
        },
        limit,
      );
    }
  }

  // What follows has no counterpart in CPython, where it is the end of the process, now or later.

  const refusedToGiveBack =
    "Python: Py_DECREF was called by a thread that does not hold the GIL; the count stays as it was: the object is held for ever\n";
  const refusedToTake =
    "Python: Py_INCREF was called by a thread that does not hold the GIL; the count stays as it was, " +
    "and from now on no count falls: whatever C owns is held for ever\n";
  const notThisOne = "the C API serves the first Python interpreter of a process, and that is not this one";

  test.concurrent(
    "Py_DECREF in a thread without the GIL is refused",
    async () => {
      expect(await run("here/without_gil.py", "without_gil", {}, "gives back")).toEqual({
        stdout: "(True, True)\n0\nTrue\nNone\n(True, True)\n",
        stderr: refusedToGiveBack,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "Py_DECREF in a thread without the GIL is refused while the thread ends",
    async () => {
      expect(await run("here/without_gil.py", "without_gil", {}, "gives back as it ends")).toEqual({
        stdout: "(True, True)\n0 4\nTrue\nNone\n(True, True)\n",
        stderr: refusedToGiveBack,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "Py_INCREF in a thread without the GIL is refused, and from then on no count falls",
    async () => {
      expect(await run("here/without_gil.py", "without_gil", {}, "takes")).toEqual({
        stdout: "(True, True)\n0\nTrue\n(True, False)\n",
        stderr: refusedToTake,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "in a thread without the GIL, every function that looks at something fails",
    async () => {
      const answers = "3221225472 1 0 1 1 1 -1 -1 1 | 1 1 1 1\n";
      expect(await run("here/without_gil.py", "without_gil", {}, "asks")).toEqual({
        stdout: answers.repeat(2),
        stderr: "Python: a function of the C API was called by a thread that does not hold the GIL; it fails\n",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "when the interpreter that had the API has ended, every function that looks at something fails",
    async () => {
      expect(await run("here/worker_had_the_api.mjs", "without_gil")).toEqual({
        stdout: "worker: held\nmain: 3221225472 1 0 1 1 1 -1 -1 1 | 0 1 1 1\nmain: 1110\n" + `main: ${notThisOne}\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  // What all_but_a_call() in here/in_two.py returns, in an interpreter that the API is not for.
  const allButACall =
    "[[1], 1, [1], <class 'int'>, <class 'int'>, [1, <class 'float'>], <class 'str'>, 1, ['s'], 4, b'ab', 'ValueError: NULL pointer access', " +
    "'ArgumentError: too many arguments (2000), maximum is 1024', \"ArgumentError: argument 1: TypeError: Don't know how to convert parameter 1\", " +
    "1, 'CDLL', 'PyDLL']";
  const refusedToAnother = (what: string, consequence: string) =>
    `Python: ${what} called for an interpreter that the C API does not serve (it serves the first of the process); ` +
    `${consequence}, and nothing changes for the interpreter that it serves\n`;
  // The constructor of loaded.c does both, in this order.
  const refusedBoth =
    refusedToAnother("Py_INCREF or Py_DECREF was", "the count stays as it was") +
    refusedToAnother("a function of the C API was", "it fails");
  async function runInTwo(script: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(root, "here", script), String(built), ...args],
      env: bunEnv,
      cwd: String(built),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent(
    "the API is main's if Python begins there, whatever a worker does",
    async () => {
      expect(await runInTwo("whose_it_is.mjs", "main first")).toEqual({
        stdout: `worker: ${allButACall}\nworker has the API: ImportError: ${notThisOne}\nmain has the API: True\n`,
        stderr: refusedBoth,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "the API is main's from the moment at which Python begins there, before it has a use for it",
    async () => {
      expect(await runInTwo("whose_it_is.mjs", "main first, which has no use for it yet")).toEqual({
        stdout:
          "before Python begins: 0\nwhen it has begun: 1\n" +
          `worker has the API: ImportError: ${notThisOne}\nmain has the API: True\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "the API is a worker's if Python begins there, whatever main does",
    async () => {
      expect(await runInTwo("whose_it_is.mjs", "a worker first")).toEqual({
        stdout: `main: ${allButACall}\nmain has the API: ImportError: ${notThisOne}\nworker has the API: True\n`,
        stderr: refusedBoth,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "when the interpreter that the API serves has ended, it serves nobody",
    async () => {
      expect(await runInTwo("whose_it_is.mjs", "a worker first, which ends")).toEqual({
        stdout:
          `worker has the API: True\nmain has the API: ImportError: ${notThisOne}\n` +
          `worker has the API: ImportError: ${notThisOne}\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "C that runs for another interpreter is refused, and that costs the interpreter that has the API nothing",
    async () => {
      expect(await runInTwo("another_interpreter.mjs")).toEqual({
        stdout: "main: (True, True)\nworker: 3221225472 1 0 1 1 1 -1 -1 1 | 1 1 1 1\nmain: (True, True)\n",
        stderr: refusedBoth,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "id() of a built-in type is the address of its symbol in every interpreter",
    async () => {
      expect(await runInTwo("identity_in_two.mjs")).toEqual({
        stdout:
          `worker: (True, True, True) ImportError: ${notThisOne} (True, True, True)\n` +
          "worker: null and undefined: True True\n" +
          "main: (True, True, True) True (True, True, True)\nthe same in both: true and later: true\n" +
          "main: null and undefined: True True\n",
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "prototypes over functions of Python's and of ctypes' own need no API, and take it from nobody",
    async () => {
      expect(await run("here/callbacks_in_two.mjs", "ownership")).toEqual({
        stdout: "worker (4, b'ab', ['s'])\nmain (4, b'ab', ['s'])\nmain has the API: true\n",
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "neither a reference nor what C raised outlives a call that ends otherwise than by its result",
    async () => {
      expect(await run("here/ends_otherwise.py", "ownership")).toEqual({
        stdout: "KeyError 0\nKeyError 0\nKeyError 0\nNone\nValueError by a function of a CDLL\nTrue\n",
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "a tuple that C changes after its hash was asked for",
    async () => {
      expect(await run("here/changed_tuple.py", "ownership")).toEqual({
        stdout: "(5,) True True False\n",
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );
});
