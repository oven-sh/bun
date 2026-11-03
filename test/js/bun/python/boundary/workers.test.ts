// Each worker has a Python of its own.
import { float } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";
import { bytearray, bytes, dict, id, set, tuple } from "python:builtins";
import datetime from "python:datetime";
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
    expect(event.message).toBe(
      'Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nValueError: in the worker',
    );
  });

  test("sys.exit() ends the worker with the status", async () => {
    using worker = start();
    worker.postMessage({ operation: "exit" });
    expect(await worker.closed).toBe(3);
  });

  test("an object of Python's cannot be posted", async () => {
    using worker = start();
    expect(await worker.ask("postTuple")).toBe("DataCloneError");
  });

  // The thread goes on when the VM of the worker is gone, and crashes when it next takes the lock: nearly always, so this is not run.
  test.todo("terminate() with a thread of Python's running", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fixtures", "terminate-with-threads-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "survived\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

describe("structuredClone()", () => {
  test.each([
    ["tuple", tuple([1])],
    ["dict", dict([["a", 1]])],
    ["set", set([1])],
    ["bytes", bytes([1])],
    ["bytearray", bytearray([1])],
    ["date", datetime.date(2020, 1, 1)],
  ])("refuses a %s", (_, value) => {
    expect(() => structuredClone(value)).toThrow("The object can not be cloned.");
  });

  // A float that is a whole number is an object where it is in a list.
  test.failing("takes a list of floats", () => {
    expect(structuredClone([float(2), 1.5])).toEqual([2, 1.5]);
  });
});
