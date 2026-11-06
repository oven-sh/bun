// Python's C API (abi3t): see README.md. C sources are compiled here, with the machine's compiler, against the header in include/; each
// script must print what CPython 3.15 printed for the same source compiled against CPython's own headers.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const compiler = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

/** Libraries that a script of the same name loads with ctypes.PyDLL. */
const libraries = ["references", "ownership", "loaded", "raises_as_loaded", "goes", "first_by_cdll", "identity"];
/** Libraries for the scripts in here/ alone. */
const others = ["without_gil", "everything"];

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
  }, 60_000);

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
  // The constructor of loaded.c calls functions; the reference that it takes is to an exception, and nobody counts those.
  const refusedToEnter = refusedToAnother("a function of the C API was", "it fails");
  const refusedBoth = refusedToEnter + refusedToAnother("Py_INCREF or Py_DECREF was", "the count stays as it was");
  // What the scripts have such an interpreter do, and what whoever comes next on that thread finds.
  const whatIsRefusedToAnother = (who: string, next: string) =>
    `${who}: 3221225472 1 0 1 1 1 -1 -1 1 | 1 1 1 1\n${who}, what C makes: ValueError: PyObject is NULL\n` +
    `${who}, what C raises: [None, None, None]\n${next}, the next call: 7\n` +
    `${who}, what C raises: [None, None, None]\n${next}, the next library: CDLL\n` +
    `${who}, a library that raises as it goes: None\n${next}, the next call: 7\n`;
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
        stderr: refusedToEnter,
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
        stderr: refusedToEnter,
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
        stdout: "main: (True, True)\n" + whatIsRefusedToAnother("worker", "worker") + "main: (True, True)\n",
        stderr: refusedBoth,
        exitCode: 0,
      });
    },
    limit,
  );

  // What call_everything() in everything.c says. Who is refused is told the same whatever he asks with; only Py_IsInitialized() knows more.
  const refusedEverything = (isInitialized: 0 | 1) =>
    `1 1 3221225472 NULL 0 1 000 2 2 2 1 1 2 2 1 1 1 1 | ${isInitialized} NULL NULL NULL NULL NULL NULL 0 0 | ` +
    "NULL NULL NULL NULL -1 NULL -1 NULL -1 NULL -1 NULL -1 NULL -1 -1";
  const servedEverything = (isException: 0 | 1) =>
    `1 1 3221225472 object 0 1 000 2 2 2 2 2 2 2 2 2 2 1 | 1 NULL NULL object object object object 1 ${isException} | ` +
    "object object object object -1 object -1 object -1 NULL -1 object -1 NULL -1 -1";
  const everything = (when: string, answers: (isException: 0 | 1) => string) =>
    `${when}: what was kept is NULL: 0\n with the exception: ${answers(1)}\n with the type:      ${answers(0)}\n`;
  const raisedWithWhatWasKept = "ValueError: with what was read as the library was loaded\n";

  test("everything.c calls every function that is declared", () => {
    const declared = readFileSync(join(root, "include", "declarations.h"), "utf8").matchAll(/\b(\w+)\([^)]*\);/g);
    const source = readFileSync(join(root, "everything.c"), "utf8");
    expect([...declared].map(match => match[1]).filter(name => !new RegExp(`\\b${name}\\(`).test(source))).toEqual([]);
  });

  test.concurrent(
    "what a library reads as JS loads it, before there is any Python, is good later; until then every function fails",
    async () => {
      expect(await runInTwo("everything.mjs", "JS loads it before there is any Python")).toEqual({
        stdout:
          everything("before Python begins", () => refusedEverything(0)) +
          everything("when it has begun", () => refusedEverything(1)) +
          `main: ${raisedWithWhatWasKept}` +
          everything("with the API", servedEverything),
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "what a library reads as a worker loads it, before main has a use for the API, is good later",
    async () => {
      expect(await runInTwo("everything.mjs", "a worker loads it before main has a use for the API")).toEqual({
        stdout: `worker: CDLL\nmain: ${raisedWithWhatWasKept}`,
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "when the interpreter that had the API has ended, every function fails whatever it is called with",
    async () => {
      expect(await runInTwo("everything.mjs", "a worker has the API and ends")).toEqual({
        stdout:
          "worker: holds a list\n" +
          everything("when the interpreter has ended", () => refusedEverything(0)) +
          ` with the list:      ${refusedEverything(0)}\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  const refusedWithoutGIL =
    "Python: a function of the C API was called by a thread that does not hold the GIL; it fails\n";
  for (const what of ["an exception", "a type"]) {
    test.concurrent(
      `a worker's JS that calls the API with ${what} is refused, and that is all: nobody counts references to it`,
      async () => {
        expect(await runInTwo("ffi_in_worker.mjs", what)).toEqual({
          stdout: `main: holds a list (True, True)\nworker: ${refusedEverything(1)}\nmain: (True, True)\n`,
          stderr: refusedWithoutGIL,
          exitCode: 0,
        });
      },
      limit,
    );
  }

  test.concurrent(
    "a worker's JS that takes a reference to an object of main's is a thread without the GIL",
    async () => {
      expect(await runInTwo("ffi_in_worker.mjs", "a list of main's")).toEqual({
        stdout: `main: holds a list (True, True)\nworker: ${refusedEverything(1)}\nmain: (True, False)\n`,
        stderr: refusedToTake + refusedWithoutGIL,
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "C that runs for the interpreter of another realm, on the same thread, is refused",
    async () => {
      expect(await runInTwo("realm.mjs")).toEqual({
        stdout:
          "main has the API: True\nmain: (True, True)\n" +
          `realm has the API: ImportError: ${notThisOne}\nrealm: ${allButACall}\n` +
          whatIsRefusedToAnother("realm", "main") +
          " realm: (0, 0)\nmain, around the realm: (4, 4)\n main: (4, 4)\nrealm, around main: (0, 0)\nmain: (True, True)\n",
        stderr: refusedBoth,
        exitCode: 0,
      });
    },
    limit,
  );

  for (const [others, mainToo] of [
    [0, false],
    [16, false],
    [0, true],
  ] as const) {
    const main = mainToo ? `main has the API: ImportError: ${notThisOne}\n` : "";
    test.concurrent(
      "from the collection that finds the realm dead whose interpreter had the API, nobody has the API " +
        `(${others} other realms${mainToo ? ", Python in the main realm too" : ""})`,
      async () => {
        expect(await runInTwo("realm_first.mjs", String(others), ...(mainToo ? ["main too"] : []))).toEqual({
          stdout:
            `realm has the API: True\n${main}the realm has gone: true ${others}\n` +
            `JS calls C: ${servedEverything(1)}\nJS calls C: ${refusedEverything(0)}\n${main}` +
            (mainToo ? "main, the next call and the next library: 7 CDLL\n" : ""),
          stderr: "",
          exitCode: 0,
        });
      },
      limit,
    );
  }

  test.concurrent(
    "an address in the middle of a symbol stands for no object",
    async () => {
      expect(await run("here/in_the_middle.py", "identity")).toEqual({
        stdout:
          "[<class 'int'>, <class 'ValueError'>, None]\n" +
          "ValueError the memory does not hold a reference to an object\n".repeat(18),
        stderr: "",
        exitCode: 0,
      });
    },
    limit,
  );

  test.concurrent(
    "an exception whose type is NULL",
    async () => {
      expect(await run("here/null_type.py", "ownership")).toEqual({
        stdout: "SystemError _PyErr_SetObject: the exception is NULL\n".repeat(3),
        stderr: "",
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
          "worker: null and undefined: True True\nworker: zero and minus zero: True True\n" +
          "main: (True, True, True) True (True, True, True)\nthe same in both: true and later: true\n" +
          "main: null and undefined: True True\nmain: zero and minus zero: True True\n",
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
