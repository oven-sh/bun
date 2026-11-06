// Each worker has a Python of its own.
import { float } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";
import {
  BufferError,
  ValueError,
  bytearray,
  bytes,
  complex,
  dict,
  frozenset,
  id,
  len,
  memoryview,
  float as pyfloat,
  set,
  slice,
  tuple,
} from "python:builtins";
import datetime from "python:datetime";
import { getitem } from "python:operator";
import sys from "python:sys";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(120_000);

function start() {
  const worker = new Worker(join(import.meta.dir, "fixtures", "worker-fixture.ts"));
  return Object.assign(worker, {
    ask: (operation: string, rest = {}) =>
      new Promise<any>((resolve, reject) => {
        worker.addEventListener("message", event => resolve(event.data), { once: true });
        worker.addEventListener("error", reject, { once: true });
        worker.postMessage({ operation, ...rest });
      }),
    closed: new Promise<number>(resolve => worker.addEventListener("close", (event: any) => resolve(event.code))),
    [Symbol.dispose]: () => worker.terminate(),
  });
}

// What is to run when Python exits runs, once, in a worker as in the main program: the functions of atexit, the listeners of "exit",
// the finalizers.
describe.concurrent("Python exits", () => {
  const pythonWorker = "a worker that is a module of Python";
  const worker = "a worker of JavaScript that calls Python";
  const main = "the main program, of JavaScript, which calls Python";
  const pythonMain = "the main program, of Python";
  const rows: [how: string, where: string, stdout: string, status: number][] = [];
  for (const how of ["sys.exit(3)", "raise SystemExit(3)"]) {
    rows.push(
      [how, pythonWorker, "atexit\nfinalizer\nclosed with 3\n", 0],
      [how, worker, "atexit\nlistener of exit: 3\nfinalizer\nclosed with 3\n", 0],
      [how, main, "atexit\nlistener of exit: 3\nfinalizer\n", 3],
      [how, pythonMain, "atexit\nfinalizer\n", 3],
    );
  }
  rows.push(
    [
      "sys.exit(3) in a function that a callback of the event loop calls",
      pythonWorker,
      "atexit\nfinalizer\nclosed with 3\n",
      0,
    ],
    [
      "sys.exit(3) in a function that a callback of the event loop calls",
      worker,
      "went on\natexit\nlistener of exit: 3\nfinalizer\nclosed with 3\n",
      0,
    ],
    [
      "sys.exit(3) in a function that a callback of the event loop calls",
      main,
      "went on\natexit\nlistener of exit: 3\nfinalizer\n",
      3,
    ],
    ["sys.exit(3) in a function that a callback of the event loop calls", pythonMain, "atexit\nfinalizer\n", 3],
    // It ends the thread.
    ["sys.exit(5) in a thread", pythonWorker, "the thread has ended\natexit\nfinalizer\nclosed with 0\n", 0],
    [
      "sys.exit(5) in a thread",
      worker,
      "the thread has ended\nwent on\natexit\nlistener of exit: 0\nfinalizer\nclosed with 0\n",
      0,
    ],
    ["sys.exit(5) in a thread", main, "the thread has ended\nwent on\natexit\nlistener of exit: 0\nfinalizer\n", 0],
    ["sys.exit(5) in a thread", pythonMain, "the thread has ended\natexit\nfinalizer\n", 0],
    // It is reported, and there is no second round.
    [
      "sys.exit(3), and sys.exit(4) in a function of atexit",
      pythonWorker,
      "atexit, which exits\natexit\nfinalizer\nclosed with 3\n",
      0,
    ],
    [
      "sys.exit(3), and sys.exit(4) in a function of atexit",
      worker,
      "atexit, which exits\natexit\nlistener of exit: 3\nfinalizer\nclosed with 3\n",
      0,
    ],
    [
      "sys.exit(3), and sys.exit(4) in a function of atexit",
      main,
      "atexit, which exits\natexit\nlistener of exit: 3\nfinalizer\n",
      3,
    ],
    ["sys.exit(3), and sys.exit(4) in a function of atexit", pythonMain, "atexit, which exits\natexit\nfinalizer\n", 3],
    // The status is the later one, and there is no second round.
    [
      "sys.exit(3), and sys.exit(4) in a listener of exit",
      worker,
      "atexit\nlistener of exit: 3\nfinalizer\nclosed with 4\n",
      0,
    ],
    ["sys.exit(3), and sys.exit(4) in a listener of exit", main, "atexit\nlistener of exit: 3\nfinalizer\n", 4],
  );
  test.each(rows)("%s, in %s", async (how, where, expected, status) => {
    const fixtures = join(import.meta.dir, "fixtures");
    await using proc = Bun.spawn({
      cmd:
        where === pythonMain
          ? [bunExe(), join(fixtures, "exit-in-worker.py")]
          : [bunExe(), join(fixtures, "exit-in-worker-fixture.ts"), where],
      env: { ...bunEnv, HOW: how },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(expected);
    if (how.endsWith("in a function of atexit"))
      expect(stderr).toStartWith("Exception ignored in atexit callback <function again at ");
    else expect(stderr).toBe("");
    expect(exitCode).toBe(status);
  });
});

describe.concurrent("workers", () => {
  test("started at once have interpreters of their own, and share memory", async () => {
    using first = start();
    using second = start();
    const identities = await Promise.all([first.ask("identity"), second.ask("identity")]);
    expect(new Set([...identities, id(sys.modules)]).size).toBe(3);

    const buffer = new SharedArrayBuffer(4);
    expect(await first.ask("write", { buffer, index: 0, value: 7 })).toEqual([7, 0, 0, 0]);
    expect(await second.ask("write", { buffer, index: 1, value: 9 })).toEqual([7, 9, 0, 0]);
    expect([...new Uint8Array(buffer)]).toEqual([7, 9, 0, 0]);
  });

  test("Python starts threads in one", async () => {
    using worker = start();
    expect(await worker.ask("threads")).toEqual({ results: [499500, 499501, 499502, 499503], isMainThread: true });
  });

  test.each(["sleep", "loop"])("terminate() ends one that is in time.sleep() or in a loop: %s", async operation => {
    using worker = start();
    expect(await worker.ask(operation)).toBe("started");
    worker.terminate();
    await worker.closed;
  });

  test("an exception nobody catches is an error event with the traceback", async () => {
    using worker = start();
    const event: ErrorEvent = await worker.ask("raise").catch(event => event);
    expect(event.message).toStartWith("Traceback (most recent call last):\n");
    expect(event.message).toContain("worker-fixture.ts");
    expect(event.message).toEndWith('\n  File "<string>", line 1, in <module>\nValueError: in the worker');
  });

  test("sys.exit() ends the worker with the status", async () => {
    using worker = start();
    worker.postMessage({ operation: "exit" });
    expect(await worker.closed).toBe(3);
  });

  test("what is posted of Python's is its counterpart in JavaScript, if it has just one", async () => {
    using worker = start();
    expect(await worker.ask("postTuple")).toEqual([1, 2]);
    expect(await worker.ask("postDict")).toBe("DataCloneError");
  });

  // The threads end before the VM of the worker goes: wherever they wait, and without another line of Python.
  test.each(["terminated", "terminated, not daemons", "ends"])(
    "a worker with threads of Python's that run and wait: %s",
    async how => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-with-threads-fixture.ts"), how],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "survived and the threads are gone\n", stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  test.each([
    "in a finalizer, with more to come",
    "in sys.unraisablehook",
    "in an audit hook for sys.unraisablehook",
    "two threads collect, and finalizers make more to finalize",
    "in sys.unraisablehook, for what a thread raised",
    "in sys.unraisablehook, for what one of gc.callbacks raised",
    "in sys.unraisablehook, for what warning of a coroutine raised",
    "in sys.stderr.write(), for what a finalizer raised in a thread",
    "in sys.stderr.write(), for what sys.unraisablehook raised",
    "in sys.stderr.write(), for gc.DEBUG_STATS",
    "in the finalizer of a stream, which asks whether it is closed",
    "in the finalizer of a stream, which sets an attribute",
    "in the finalizer of a stream, and then waits for a lock",
    "in the finalizer of a stream, and then sleeps",
    "in the finalizer of a stream, and then returns to a loop in JavaScript",
    "in the __repr__ of what is named in a report",
    "in sys.unraisablehook, for a stream that cannot be written before a system call",
    "in the finally of a generator, while an exception leaves its loop",
    "in the finally of a generator, while an exception leaves its loop in a thread",
    "in sys.excepthook, for a KeyboardInterrupt",
    "in from_param() of an argument for C",
    "in _as_parameter_ of an argument for C",
    "in a function that C calls",
    "in the codec of a source",
    "in __index__ of what a handler of expat returns",
    "in an audit hook, for what the initializer of a module imports",
    "in __index__ of how much a file that nothing else refers to is to read",
    "in a trace function that is told of an exception",
    "in a trace function that is told of the return of a frame that an exception leaves",
    "in a profile function that is told of the return of a frame that an exception leaves",
    "in toString() of what JavaScript has thrown, of which a trace function is to be told",
    "in a callback of sys.monitoring for RAISE",
    "in a callback of sys.monitoring for PY_UNWIND",
    "in a callback of sys.monitoring for EXCEPTION_HANDLED",
    "in toString() of what JavaScript has thrown, which leaves a generator",
    "in toString() of what JavaScript has thrown, which leaves a coroutine",
    "in toString() of what JavaScript has thrown, which leaves an asynchronous generator",
    "in a getter of the error that JavaScript has thrown, which leaves a generator",
    "in a getter of the error that JavaScript throws into a generator",
    "catching what JavaScript throws, over and over",
    "in the finally of a generator that only enumerate() has, while an exception leaves the loop",
    "in the finally of a generator that `in` has left half way, and then in a loop",
    "in the finally of a generator that islice() lets go of, and then in a loop",
    "about to call what is not an object to JavaScript",
  ])("terminate() of a worker whose Python is %s", async what => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-at-work-fixture.ts"), what],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "survived\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("terminate() of workers in which Python is starting", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-at-start-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "survived\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.each([
    "atexit",
    "threading",
    "finalizer",
    "flush",
    "atexit, which raises",
    "threading, which raises",
    "flush, which raises",
  ])("terminate() while the interpreter of the worker is shutting down: %s", async where => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-at-exit-fixture.ts"), where],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "closed\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

describe("structuredClone()", () => {
  // A dict could be an object or a Map, a date a Date or a string.
  test.each([
    ["dict", dict([["a", 1]])],
    ["date", datetime.date(2020, 1, 1)],
    ["complex", complex(1, 2)],
    ["memoryview of ints", memoryview(bytes(8)).cast("i")],
    ["function", len],
  ])("refuses a %s", (_, value) => {
    expect(() => structuredClone(value)).toThrow("The object can not be cloned.");
  });

  // A float that is a whole number, or a NaN, is an object where it is in a list.
  test("takes a list of floats", () => {
    const clone = structuredClone([float(2), 1.5, pyfloat("nan"), [float(3)]]);
    expect(clone).toEqual([2, 1.5, NaN, [3]]);
    expect(clone.map(item => typeof item)).toEqual(["number", "number", "number", "object"]);
  });

  test("a tuple is an Array, a set a Set, bytes a Uint8Array", () => {
    const clone = structuredClone({
      tuple: tuple([1, tuple(["a", float(2)])]),
      set: set([1, "a"]),
      frozenset: frozenset([tuple([1])]),
      bytes: bytes([1, 2]),
      bytearray: bytearray([3]),
      memoryview: getitem(memoryview(bytes([4, 5, 6])), slice(1, 3)),
    });
    expect(clone).toStrictEqual({
      tuple: [1, ["a", 2]],
      set: new Set([1, "a"]),
      frozenset: new Set([[1]]),
      bytes: new Uint8Array([1, 2]),
      bytearray: new Uint8Array([3]),
      memoryview: new Uint8Array([5, 6]),
    });
  });

  test("what is shared stays shared, and a cycle a cycle", () => {
    const shared = tuple([1]);
    const [first, second] = structuredClone([shared, shared]);
    expect(first).toBe(second);
    const list: unknown[] = [];
    list.push(tuple([list]));
    const clone = structuredClone(list) as any;
    expect(clone[0][0]).toBe(clone);
  });

  test("a view that cannot give its bytes says so", () => {
    expect(() => structuredClone(getitem(memoryview(bytes(4)), slice(undefined, undefined, 2)))).toThrow(BufferError);
    const released = memoryview(bytes(1));
    released.release();
    expect(() => structuredClone(released)).toThrow(ValueError);
  });
});
