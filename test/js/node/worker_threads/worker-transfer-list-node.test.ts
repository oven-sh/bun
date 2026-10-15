// Also runs in Node.js (`node --test <file>`), so it uses node:test and imports only Node modules.
import assert from "node:assert";
import { execFile } from "node:child_process";
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

// A SHARE_ENV worker puts the thread that starts it in an env tree, and nothing takes the thread out
// again. So each row below has a process of its own, which prints one line of JSON.
function inAProcessOfItsOwn(script: string, flags: string[] = []): Promise<unknown> {
  return new Promise(resolve => {
    execFile(process.execPath, [...flags, "-e", script], (error, stdout, stderr) => {
      if (error) return resolve({ error: error.message, stdout, stderr });
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ stdout, stderr });
      }
    });
  });
}

describe("new Worker() with env: SHARE_ENV", () => {
  test("a constructor that throws while it serializes workerData leaves process.env with the caller", async () => {
    const printed = await inAProcessOfItsOwn(`
      const { Worker, SHARE_ENV, MessageChannel, setEnvironmentData } = require("node:worker_threads");
      const env = process.env;
      const { port1, port2 } = new MessageChannel();
      const threw = {};
      function construct(what, options) {
        try {
          new Worker("", { eval: true, env: SHARE_ENV, ...options });
          threw[what] = "did not throw";
        } catch (e) {
          threw[what] = e.name;
        }
      }
      construct("workerData that cannot be cloned", { workerData: () => {} });
      construct("a workerData getter that throws", { workerData: { get thrower() { throw new RangeError("workerData getter"); } } });
      construct("a port that is not in transferList", { workerData: port2 });
      setEnvironmentData("key", () => {});
      construct("environmentData that cannot be cloned", {});
      setEnvironmentData("key", undefined);
      port1.close();

      const sameObject = process.env === env;
      // The object from before the constructors is still the env: a worker that shares it gets this write.
      env.WRITTEN_AFTER_THE_THROWS = "yes";
      const worker = new Worker(
        "require('node:worker_threads').parentPort.postMessage(process.env.WRITTEN_AFTER_THE_THROWS ?? null)",
        { eval: true, env: SHARE_ENV },
      );
      worker.once("message", workerSees => {
        console.log(JSON.stringify({ threw, sameObject, workerSees }));
        process.exit(0);
      });
    `);
    assert.deepStrictEqual(printed, {
      threw: {
        "workerData that cannot be cloned": "DataCloneError",
        "a workerData getter that throws": "RangeError",
        "a port that is not in transferList": "DataCloneError",
        "environmentData that cannot be cloned": "DataCloneError",
      },
      sameObject: true,
      workerSees: "yes",
    });
  });

  // The env that the worker shares is read once workerData is serialized.
  test("a process.env write and delete that a workerData getter makes reach the parent and the worker", async () => {
    const printed = await inAProcessOfItsOwn(`
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      const fromBefore = process.env;
      fromBefore.DELETED_BY_THE_GETTER = "not deleted";
      const workerData = {
        get getter() {
          fromBefore.WRITTEN_BY_THE_GETTER = "yes";
          delete fromBefore.DELETED_BY_THE_GETTER;
          return true;
        },
      };
      function sees() {
        return {
          writtenByTheGetter: process.env.WRITTEN_BY_THE_GETTER ?? null,
          deletedByTheGetter: process.env.DELETED_BY_THE_GETTER ?? null,
          writtenAfterTheConstructor: process.env.WRITTEN_AFTER_THE_CONSTRUCTOR ?? null,
        };
      }
      const worker = new Worker(
        sees + "; const { parentPort } = require('node:worker_threads'); parentPort.once('message', () => parentPort.postMessage(sees()));",
        { eval: true, env: SHARE_ENV, workerData },
      );
      process.env.WRITTEN_AFTER_THE_CONSTRUCTOR = "yes";
      worker.once("message", workerSees => {
        console.log(JSON.stringify({ parentSees: sees(), workerSees }));
        process.exit(0);
      });
      worker.postMessage("read");
    `);
    const sees = { writtenByTheGetter: "yes", deletedByTheGetter: null, writtenAfterTheConstructor: "yes" };
    assert.deepStrictEqual(printed, { parentSees: sees, workerSees: sees });
  });

  // The rest pass without the fix too. They pin what the later swap of process.env must keep.

  // The getter's worker founds the env tree while the constructor serializes, so the outer worker joins that tree.
  test("a worker that a workerData getter starts shares the env with the worker under construction", async () => {
    const printed = await inAProcessOfItsOwn(`
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      function sees() {
        return [process.env.WRITTEN_BY_THE_GETTER ?? null, process.env.WRITTEN_AFTER_THE_CONSTRUCTOR ?? null];
      }
      const answers = sees + "; const { parentPort } = require('node:worker_threads'); parentPort.once('message', () => parentPort.postMessage(sees()));";
      let inner;
      const workerData = {
        get getter() {
          inner = new Worker(answers, { eval: true, env: SHARE_ENV });
          process.env.WRITTEN_BY_THE_GETTER = "yes";
          return true;
        },
      };
      const outer = new Worker(answers, { eval: true, env: SHARE_ENV, workerData });
      process.env.WRITTEN_AFTER_THE_CONSTRUCTOR = "yes";
      const ask = worker => new Promise(resolve => worker.once("message", resolve).postMessage("read"));
      Promise.all([ask(inner), ask(outer)]).then(([innerSees, outerSees]) => {
        console.log(JSON.stringify({ parentSees: sees(), innerSees, outerSees }));
        process.exit(0);
      });
    `);
    const sees = ["yes", "yes"];
    assert.deepStrictEqual(printed, { parentSees: sees, innerSees: sees, outerSees: sees });
  });

  test("the second and the third worker leave the process.env of the first", async () => {
    const printed = await inAProcessOfItsOwn(`
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      new Worker("", { eval: true, env: SHARE_ENV });
      const env = process.env;
      new Worker("", { eval: true, env: SHARE_ENV });
      const second = process.env === env;
      const buf = new ArrayBuffer(8);
      new Worker("", { eval: true, env: SHARE_ENV, workerData: buf, transferList: [buf] });
      console.log(JSON.stringify({ second, third: process.env === env }));
      process.exit(0);
    `);
    assert.deepStrictEqual(printed, { second: true, third: true });
  });

  test("an object that a workerData getter assigns to process.env stays there", async () => {
    const printed = await inAProcessOfItsOwn(`
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      const assigned = {};
      const workerData = {
        get getter() {
          process.env = assigned;
          return true;
        },
      };
      new Worker("", { eval: true, env: SHARE_ENV, workerData });
      console.log(JSON.stringify({ stillAssigned: process.env === assigned }));
      process.exit(0);
    `);
    assert.deepStrictEqual(printed, { stillAssigned: true });
  });

  // --trace-env puts a Proxy over the env in process.env.
  test("with --trace-env, the parent reads what the worker writes", async () => {
    const printed = await inAProcessOfItsOwn(
      `
      const { Worker, SHARE_ENV } = require("node:worker_threads");
      const worker = new Worker("process.env.WRITTEN_BY_THE_WORKER = 'yes'", { eval: true, env: SHARE_ENV });
      worker.once("exit", () => {
        console.log(JSON.stringify({ parentSees: process.env.WRITTEN_BY_THE_WORKER ?? null }));
      });
    `,
      ["--trace-env"],
    );
    assert.deepStrictEqual(printed, { parentSees: "yes" });
  });
});
