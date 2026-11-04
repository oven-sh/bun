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

  test.each(["atexit", "threading", "finalizer", "flush"])(
    "terminate() while the interpreter of the worker is shutting down: %s",
    async where => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-at-exit-fixture.ts"), where],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "closed\n", stderr: "" });
      expect(exitCode).toBe(0);
    },
  );
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
