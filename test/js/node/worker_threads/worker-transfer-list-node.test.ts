// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { describe, test } from "node:test";
import { Worker } from "node:worker_threads";
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
