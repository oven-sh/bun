// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { execFile } from "node:child_process";
import { readSync } from "node:fs";
import { open } from "node:fs/promises";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setEnvironmentData, Worker } from "node:worker_threads";
import { echoAnswer, echoEntry, owned, transferable } from "./worker-transfer-list-fixture.ts";

// A Worker cannot take a flag that belongs to the process: the constructor throws.
const rejected = { execArgv: ["--disallow-code-generation-from-strings"] };
const invalidExecArgv = { code: "ERR_WORKER_INVALID_EXEC_ARGV" };

describe("new Worker() that throws leaves the transfer list with the caller", () => {
  test("a rejected execArgv flag, and the same list then starts a worker", async () => {
    const { buf, port1, options, stillOwned } = transferable();
    assert.throws(() => new Worker(echoEntry, { eval: true, ...options(), ...rejected }), invalidExecArgv);
    assert.deepStrictEqual(stillOwned(), owned);

    const worker = new Worker(echoEntry, { eval: true, ...options() });
    try {
      const answer = await new Promise((resolve, reject) => {
        port1.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`the worker exited with code ${code} before it answered`)));
      });
      assert.deepStrictEqual({ answer, bytes: buf.byteLength }, { answer: echoAnswer, bytes: 0 });
    } finally {
      await worker.terminate();
      port1.close();
    }
  });

  test("a workerData getter that throws", () => {
    const { buf, port1, port2, stillOwned } = transferable();
    const workerData = {
      buf,
      port: port2,
      get thrower() {
        throw new Error("workerData getter");
      },
    };
    assert.throws(() => new Worker(echoEntry, { eval: true, workerData, transferList: [buf, port2] }), {
      message: "workerData getter",
    });
    assert.deepStrictEqual(stillOwned(), owned);
    port1.close();
  });
});

test("a rejected execArgv flag is reported before workerData is read", () => {
  let reads = 0;
  const workerData = {
    get uncloneable() {
      reads++;
      return () => {};
    },
  };
  assert.throws(() => new Worker(echoEntry, { eval: true, workerData, ...rejected }), invalidExecArgv);
  assert.strictEqual(reads, 0);
});

test("a rejected execArgv flag uses no threadId", async () => {
  const before = new Worker("", { eval: true });
  assert.throws(() => new Worker("", { eval: true, ...rejected }), invalidExecArgv);
  const after = new Worker("", { eval: true });
  try {
    assert.strictEqual(after.threadId, before.threadId + 1);
  } finally {
    await Promise.all([before.terminate(), after.terminate()]);
  }
});

// The constructor adds its own listeners through on(), and that emits 'newListener'.
test("a subclass whose on() and emit() use the worker during construction constructs", async () => {
  const threadIds: string[] = [];
  class Chatty extends Worker {
    on(name: string, listener: (...args: any[]) => void) {
      threadIds.push(typeof this.threadId);
      this.unref();
      this.ref();
      return super.on(name, listener);
    }
    emit(name: string, ...args: any[]) {
      threadIds.push(typeof this.threadId);
      return super.emit(name, ...args);
    }
  }

  const worker = new Chatty("", { eval: true });
  const exitCode = await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", resolve);
  });
  assert.deepStrictEqual({ exitCode, threadIds: [...new Set(threadIds)] }, { exitCode: 0, threadIds: ["number"] });
});

// Those registrations come before the transfer and before the thread, so an override that throws costs the caller nothing.
describe("a subclass that throws from the constructor's own listener registration keeps its transfer list and starts no thread", () => {
  class Deaf extends Worker {
    on(): this {
      throw new Error("the first on()");
    }
  }
  class HalfDeaf extends Worker {
    on(name: string, listener: (...args: any[]) => void) {
      if (name === "removeListener") throw new Error("the second on()");
      return super.on(name, listener);
    }
  }
  // The second registration emits 'newListener' for itself.
  class Mute extends Worker {
    emit(name: string, ...args: any[]) {
      if (name === "newListener") throw new Error("emit()");
      return super.emit(name, ...args);
    }
  }

  for (const [Subclass, message] of [
    [Deaf, "the first on()"],
    [HalfDeaf, "the second on()"],
    [Mute, "emit()"],
  ] as const) {
    test(`${message} throws`, async () => {
      const { port1, options, stillOwned } = transferable();
      // The process emits 'worker' on the tick after a thread started.
      let started = 0;
      const onWorker = () => started++;
      process.on("worker", onWorker);
      try {
        assert.throws(() => new Subclass(echoEntry, { eval: true, ...options() }), { message });
        const kept = stillOwned();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepStrictEqual({ ...kept, started }, { ...owned, started: 0 });
      } finally {
        process.off("worker", onWorker);
        port1.close();
      }
    });
  }
});

describe("a subclass override that runs during construction runs before the transfer and before the thread", () => {
  /** A Worker subclass that calls `visit` from the first on() of its constructor. */
  function during(visit: (worker: Worker) => void) {
    let visited = false;
    return class extends Worker {
      on(name: string, listener: (...args: any[]) => void) {
        if (!visited) {
          visited = true;
          visit(this);
        }
        return super.on(name, listener);
      }
    };
  }

  test("it reads the threadId, and a construction that it makes throw uses one", async () => {
    const seen: number[] = [];
    const Watcher = during(worker => seen.push(worker.threadId));
    const Thrower = during(() => {
      throw new Error("on() override");
    });
    const before = new Watcher("", { eval: true });
    assert.throws(() => new Thrower("", { eval: true }), { message: "on() override" });
    const after = new Worker("", { eval: true });
    try {
      assert.deepStrictEqual({ seen, after: after.threadId }, { seen: [before.threadId], after: before.threadId + 2 });
    } finally {
      await Promise.all([before.terminate(), after.terminate()]);
    }
  });

  test("a rejected execArgv flag is reported before it runs", () => {
    let calls = 0;
    const Counter = during(() => calls++);
    assert.throws(() => new Counter("", { eval: true, ...rejected }), invalidExecArgv);
    assert.strictEqual(calls, 0);
  });

  test("a FileHandle in the transfer list is still open, and stays open when the override throws", async () => {
    const handle = await open(fileURLToPath(import.meta.url));
    try {
      const firstBytes = () => {
        const bytes = Buffer.alloc(2);
        readSync(handle.fd, bytes, 0, 2, 0);
        return bytes.toString();
      };
      const expected = firstBytes();
      let inOverride: string | undefined;
      const Thrower = during(() => {
        inOverride = firstBytes();
        throw new Error("on() override");
      });
      assert.throws(() => new Thrower("", { eval: true, workerData: handle, transferList: [handle as any] }), {
        message: "on() override",
      });
      assert.deepStrictEqual({ inOverride, afterwards: firstBytes() }, { inOverride: expected, afterwards: expected });
    } finally {
      await handle.close();
    }
  });

  test("what it changes in workerData and in the environment data reaches the worker", async () => {
    const workerData = { changed: "no" };
    const Late = during(() => {
      workerData.changed = "in on()";
      setEnvironmentData("changed", "in on()");
    });
    const entry = `
      const { workerData, getEnvironmentData, parentPort } = require("node:worker_threads");
      parentPort.postMessage([workerData.changed, getEnvironmentData("changed")]);
    `;
    const worker = new Late(entry, { eval: true, workerData });
    try {
      const message = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      assert.deepStrictEqual(message, ["in on()", "in on()"]);
    } finally {
      setEnvironmentData("changed", undefined);
      await worker.terminate();
    }
  });

  // A timer that is not referenced fires only while something else keeps the process alive.
  test("unref() does nothing: the worker keeps the process alive", async () => {
    const script = `
      const { Worker } = require("node:worker_threads");
      let visited = false;
      class Unref extends Worker {
        on(name, listener) {
          if (!visited) {
            visited = true;
            this.unref();
          }
          return super.on(name, listener);
        }
      }
      new Unref("setInterval(() => {}, 1 << 30)", { eval: true });
      setTimeout(() => {
        console.log("the worker keeps the process alive");
        process.exit(0);
      }, 1).unref();
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script]);
    assert.strictEqual(stdout, "the worker keeps the process alive\n");
  });

  test("terminate() stops nothing, and a later terminate() stops the worker", async () => {
    let early: Promise<number> | undefined;
    const Hasty = during(worker => {
      early = worker.terminate();
    });
    const { port1, options } = transferable();
    const worker = new Hasty(echoEntry, { eval: true, ...options() });
    try {
      const answer = await new Promise((resolve, reject) => {
        port1.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`the worker exited with code ${code} before it answered`)));
      });
      const later = await worker.terminate();
      assert.deepStrictEqual({ answer, early: await early, later }, { answer: echoAnswer, early: 1, later: 1 });
    } finally {
      await worker.terminate();
      port1.close();
    }
  });

  test("the constructor then starts the thread itself: Atomics.wait() right after it is woken", async () => {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    const entry = `
      const { workerData } = require("node:worker_threads");
      Atomics.store(workerData, 0, 1);
      Atomics.notify(workerData, 0);
    `;
    const worker = new Worker(entry, { eval: true, workerData: shared });
    try {
      const woken = Atomics.wait(shared, 0, 0, 30_000);
      assert.deepStrictEqual(
        { woken: woken !== "timed-out", value: Atomics.load(shared, 0) },
        { woken: true, value: 1 },
      );
    } finally {
      await worker.terminate();
    }
  });

  test("getHeapSnapshot() and the calls like it report that the worker is not running", async () => {
    const methods = ["getHeapSnapshot", "getHeapStatistics", "cpuUsage", "startCpuProfile", "startHeapProfile"];
    const outcomes: Promise<string>[] = [];
    const Peek = during(worker => {
      for (const method of methods) {
        outcomes.push(
          (worker as any)[method]().then(
            () => "resolved",
            (error: { code: string }) => error.code,
          ),
        );
      }
    });
    const worker = new Peek("", { eval: true });
    try {
      assert.deepStrictEqual(
        await Promise.all(outcomes),
        methods.map(() => "ERR_WORKER_NOT_RUNNING"),
      );
    } finally {
      await worker.terminate();
    }
  });
});
