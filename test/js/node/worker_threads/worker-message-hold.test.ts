/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * Node stops the port of a Worker when the Worker's last 'message' listener is
 * removed and starts it at the next one, so what the worker posts in between
 * waits for that listener:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/worker/io.js#L211-L247
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MessageChannel, postMessageToThread, Worker } from "node:worker_threads";

// A debug or sanitizer build of Bun takes the shorter sweep below.
const slowBuild =
  typeof Bun !== "undefined" && (await import("harness").then(harness => harness.isDebug || harness.isASAN));

// A port's message is handled in a task of its own, so this resolves when this
// thread has had a turn at every port that had a message by now.
async function turn() {
  const { port1, port2 } = new MessageChannel();
  const handled = once(port2, "message");
  port1.postMessage(null);
  await handled;
  port1.close();
}

// Posts a batch on parentPort when told to, and answers on the port that came with it.
const workerSource = `
  const { parentPort, workerData: { side } } = require("node:worker_threads");
  side.on("message", ({ batch, ack, then }) => {
    for (const message of batch) parentPort.postMessage(message);
    if (then === "close parentPort") parentPort.close();
    ack.postMessage(null);
    if (then === "exit") side.close();
  });`;

type Post = (batch: unknown[], then?: "close parentPort" | "exit") => Promise<void>;

/**
 * Runs `body` with a Worker of `workerSource`. `post` resolves when the worker has posted the batch and
 * the parent end of parentPort has had its turn with it: the answer comes on a port made for that one
 * answer, and this thread takes one more turn behind it.
 * `heard`: one 'message' listener heard "ready" and removed itself, so the Worker has none left.
 */
async function withWorker(heard: boolean, body: (worker: Worker, post: Post) => Promise<void>) {
  const { port1: side, port2 } = new MessageChannel();
  const worker = new Worker(workerSource, { eval: true, workerData: { side: port2 }, transferList: [port2] });
  const post: Post = async (batch, then) => {
    const { port1, port2: ack } = new MessageChannel();
    const { promise: acked, resolve, reject } = Promise.withResolvers<void>();
    const onExit = (code: number) =>
      reject(new Error(`the worker exited with code ${code} before it answered ${JSON.stringify(batch)}`));
    port1.once("message", () => resolve());
    worker.once("error", reject);
    if (then !== "exit") worker.once("exit", onExit);
    try {
      side.postMessage({ batch, ack, then }, [ack]);
      await acked;
    } finally {
      worker.off("error", reject).off("exit", onExit);
      port1.close();
    }
    await turn();
  };
  try {
    if (heard) {
      const ready = once(worker, "message");
      await post(["ready"]);
      assert.deepStrictEqual(await ready, ["ready"]);
    }
    await body(worker, post);
  } finally {
    side.close();
    await worker.terminate();
  }
}

// `listen` attaches the next listener. Resolves with what it hears up to "end", which is posted after it:
// a build that dropped what was held fails on the comparison and does not wait for it.
async function collect(worker: Worker, post: Post, listen: (onMessage: (message: unknown) => void) => void) {
  const got: unknown[] = [];
  const { promise: ended, resolve, reject } = Promise.withResolvers<void>();
  const onExit = (code: number) => reject(new Error(`the worker exited with code ${code} before "end" arrived`));
  worker.once("error", reject).once("exit", onExit);
  try {
    listen(message => {
      got.push(message);
      if (message === "end") resolve();
    });
    await post(["end"]);
    await ended;
  } finally {
    worker.off("error", reject).off("exit", onExit);
  }
  return got;
}

// Runs `script` in a process of its own, which has to end by itself.
async function run(script: string) {
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [code, signal] = await once(child, "close");
  return { stdout, code, signal };
}

describe("a Worker whose last 'message' listener was removed holds what the worker posts", () => {
  // The calls that change who listens, a post of two messages, and a turn of this thread, in every order
  // of up to three (two on a slow build), against a model of two lines: a message goes to the listeners
  // there are when the port has its turn, and waits while there are none.
  test("in every order of listener changes, posts and turns", async () => {
    const length = slowBuild ? 2 : 3;
    await withWorker(false, async (worker, post) => {
      let got: unknown[] = [];
      let next = 0;
      const listener = (message: unknown) => void got.push(message);
      // `listeners` holds true for a once() listener. `held` is what waits for a listener.
      type Model = { listeners: boolean[]; held: number[]; got: number[]; next: number };
      const deliver = (model: Model) => {
        while (model.held.length > 0 && model.listeners.length > 0) {
          const message = model.held.shift()!;
          for (const isOnce of model.listeners.slice()) {
            model.got.push(message);
            if (isOnce) model.listeners.splice(model.listeners.indexOf(true), 1);
          }
        }
      };
      const calls: [name: string, call: () => unknown, model: (model: Model) => void][] = [
        ["on", () => worker.on("message", listener), model => void model.listeners.push(false)],
        ["once", () => worker.once("message", listener), model => void model.listeners.push(true)],
        ["off", () => worker.off("message", listener), model => void model.listeners.pop()],
        ["removeAllListeners", () => worker.removeAllListeners("message"), model => void (model.listeners.length = 0)],
        ["post", () => post([next++, next++]), model => (model.held.push(model.next++, model.next++), deliver(model))],
        ["turn", turn, deliver],
      ];
      // Removes every listener and resolves with what the Worker still held.
      const rest = async () => {
        worker.removeAllListeners("message");
        const held = await collect(worker, post, onMessage => worker.on("message", onMessage));
        worker.removeAllListeners("message");
        return held.slice(0, -1);
      };

      await rest();
      const wrong: string[] = [];
      let count = 0;
      await (async function each(order: number[]) {
        const model: Model = { listeners: [], held: [], got: [], next: 0 };
        got = [];
        next = 0;
        for (const index of order) {
          await calls[index][1]();
          calls[index][2](model);
        }
        await turn();
        deliver(model);
        const actual = { got, held: await rest() };
        count++;
        try {
          assert.deepStrictEqual(actual, { got: model.got, held: model.held });
        } catch {
          wrong.push(`${order.map(index => calls[index][0]).join(", ")}: ${JSON.stringify(actual)}`);
        }
        if (order.length < length) for (let index = 0; index < calls.length; index++) await each([...order, index]);
      })([]);
      assert.deepStrictEqual(
        { count, wrong: wrong.length, first: wrong.slice(0, 5) },
        { count: [1, 7, 43, 259][length], wrong: 0, first: [] },
      );
    });
  });

  // once() removes its listener before it calls it, so the port stops inside its own dispatch. 70 messages
  // are more than the port takes out of its queue at once (64), so what it took and did not deliver goes back.
  const held = Array.from({ length: 70 }, (_, index) => index);
  const again: [when: string, readd: (add: () => void) => void][] = [
    ["synchronously", add => add()],
    ["from a microtask", add => queueMicrotask(add)],
    ["from process.nextTick", add => process.nextTick(add)],
    ["from setImmediate", add => setImmediate(add)],
  ];
  for (const [when, readd] of again) {
    test(`a once() listener that is added again ${when} gets one held message at a time, in order`, async () => {
      await withWorker(true, async (worker, post) => {
        await post(held);
        const got = await collect(worker, post, onMessage => {
          const listener = (message: unknown) => {
            onMessage(message);
            if (message !== "end") readd(() => worker.once("message", listener));
          };
          worker.once("message", listener);
        });
        assert.deepStrictEqual(got, [...held, "end"]);
      });
    });
  }

  test("one await of events.once(worker, 'message') after another gets each message", async () => {
    await withWorker(true, async (worker, post) => {
      await post(["a", "b"]);
      const first = once(worker, "message");
      await post(["c"]);
      const second = once(worker, "message");
      await post(["d"]);
      assert.deepStrictEqual([await first, await second], [["a"], ["b"]]);
    });
  });

  test("only a 'message' listener starts the port, and only the removal of the last one stops it", async () => {
    await withWorker(true, async (worker, post) => {
      const other = () => {};
      worker.on("messageerror", other);
      await post(["held"]);
      const got: unknown[] = [];
      worker.on("message", message => got.push(message));
      worker.on("message", other);
      worker.off("message", other);
      worker.off("messageerror", other);
      await post(["live"]);
      assert.deepStrictEqual(got, ["held", "live"]);
    });
  });

  test("ref() and unref() do not start the port", async () => {
    await withWorker(true, async (worker, post) => {
      worker.unref();
      worker.ref();
      await post(["a"]);
      assert.deepStrictEqual(await collect(worker, post, onMessage => worker.on("message", onMessage)), ["a", "end"]);
    });
  });

  // The port is started when the Worker is made: only a removal stops it.
  test("a Worker that never had a 'message' listener drops what arrives before the first one", async () => {
    await withWorker(false, async (worker, post) => {
      const other = () => {};
      for (const event of ["messageerror", "exit"]) worker.on(event, other).off(event, other);
      await post(["dropped"]);
      assert.deepStrictEqual(await collect(worker, post, onMessage => worker.on("message", onMessage)), ["end"]);
    });
  });

  test("what the worker posted before it closed parentPort arrives, one listener at a time", async () => {
    await withWorker(true, async (worker, post) => {
      await post([1, 2, 3], "close parentPort");
      const got: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        worker.once("message", message => got.push(message));
        await turn();
      }
      assert.deepStrictEqual(got, [1, 2, 3]);
    });
  });

  test("a reply that the worker posts from 'workerMessage' waits for the next 'message' listener", async () => {
    const worker = new Worker(
      `const { parentPort, threadId } = require("node:worker_threads");
       process.on("workerMessage", value => parentPort.postMessage({ heard: value }));
       parentPort.on("message", () => parentPort.postMessage("end"));
       parentPort.postMessage(threadId);`,
      { eval: true },
    );
    try {
      const [threadId] = await once(worker, "message");
      await postMessageToThread(threadId, "ping");
      await turn();
      const got: unknown[] = [];
      const { promise: ended, resolve, reject } = Promise.withResolvers<void>();
      worker.once("error", reject);
      worker.on("message", message => {
        got.push(message);
        if (message === "end") resolve();
      });
      worker.postMessage("more");
      await ended;
      assert.deepStrictEqual(got, [{ heard: "ping" }, "end"]);
    } finally {
      await worker.terminate();
    }
  });

  // removeAllListeners() with no argument also removes what starts the port again, in Node as here.
  // So the listener that is added behind it hears nothing until the exit.
  test("what is still held when the worker exits goes to the listeners there are then, ahead of 'exit'", async () => {
    await withWorker(true, async (worker, post) => {
      worker.removeAllListeners();
      const events: unknown[] = [];
      worker.on("message", message => events.push(message));
      worker.on("exit", code => events.push(`exit ${code}`));
      await post(["a", "b"]);
      assert.deepStrictEqual(events, []);
      const exited = once(worker, "exit");
      await post([], "exit");
      await exited;
      assert.deepStrictEqual(events, ["a", "b", "exit 0"]);
    });
  });

  // The worker posts when the parent has no 'message' listener left, and ends. `listen` runs in the parent then.
  const heldAtTheExit = (messages: string, listen: string) => `
    const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
    // Does not read back: the buffer is written with 8 bytes, and the view is made of it when it has grown.
    const makeUnreadable = () => {
      const buffer = new ArrayBuffer(8, { maxByteLength: 65536 });
      return { buffer, get grow() { buffer.resize(65536); return 1; }, get view() { return new DataView(buffer, 4096, 16); } };
    };
    const worker = new Worker(
      'const { parentPort } = require("node:worker_threads");' +
      'const makeUnreadable = ' + makeUnreadable + ';' +
      'parentPort.once("message", () => { for (const message of ${messages}) parentPort.postMessage(message); });' +
      'parentPort.postMessage("ready");',
      { eval: true },
    );
    worker.once("message", () => {
      worker.removeAllListeners();
      ${listen}
      worker.on("exit", code => console.log("exit:", code));
      worker.postMessage("go");
    });`;

  test("a 'message' listener that throws does not end the drain at the exit", async () => {
    const { stdout, code } = await run(
      heldAtTheExit(
        `["a", "b", "c"]`,
        `process.on("uncaughtException", error => console.log("uncaught:", error.message));
         worker.on("message", message => {
           console.log("message:", message);
           if (message !== "b") throw new Error("thrown at " + message);
         });`,
      ),
    );
    assert.deepStrictEqual(
      { stdout, code },
      {
        stdout: "message: a\nmessage: b\nmessage: c\nexit: 0\nuncaught: thrown at a\nuncaught: thrown at c\n",
        code: 0,
      },
    );
  });

  test("a held message that does not deserialize ends the drain at the exit with 'messageerror'", async () => {
    const { stdout, code } = await run(
      heldAtTheExit(
        `["before", makeUnreadable(), "after"]`,
        `const { port1, port2 } = new MessageChannel();
         port1.postMessage(makeUnreadable());
         try { receiveMessageOnPort(port2); } catch { console.log("does not deserialize"); }
         port1.close();
         worker.on("message", message => console.log("message:", message));
         worker.on("messageerror", error => console.log("messageerror:", error instanceof Error));`,
      ),
    );
    assert.deepStrictEqual(
      { stdout, code },
      { stdout: "does not deserialize\nmessage: before\nmessageerror: true\nexit: 0\n", code: 0 },
    );
  });

  // The worker is unref'ed, so only the port holds the parent: the listener that is added again holds it
  // until "second" is there, and then nothing does, whatever the worker still posts.
  test("the port holds the parent again with the next listener, and not while it holds messages", async () => {
    const { stdout, code, signal } = await run(`
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(
        'const { parentPort } = require("node:worker_threads");' +
        'parentPort.once("message", () => {' +
        '  parentPort.postMessage("second");' +
        '  setInterval(() => parentPort.postMessage("more"), 1);' +
        '});' +
        'parentPort.postMessage("first");',
        { eval: true },
      );
      worker.unref();
      worker.once("message", first => {
        console.log(first);
        setImmediate(() => {
          worker.once("message", second => console.log(second));
          worker.postMessage("go");
        });
      });`);
    assert.deepStrictEqual({ stdout, code, signal }, { stdout: "first\nsecond\n", code: 0, signal: null });
  });
});

// A port that hears of its peer's close before it is started (a 'close' listener first) gets what is
// queued from that close. A listener that removes itself stops that as it stops any delivery: the rest
// waits for the next listener.
test("a MessagePort keeps what a 'message' listener that removed itself left when its peer closed", async () => {
  const { port1, port2 } = new MessageChannel();
  try {
    for (const message of [1, 2, 3]) port1.postMessage(message);
    port1.close();
    port2.on("close", () => {});
    assert.deepStrictEqual(await once(port2, "message"), [1]);
    await turn();
    const rest: unknown[] = [];
    port2.on("message", message => rest.push(message));
    await turn();
    assert.deepStrictEqual(rest, [2, 3]);
  } finally {
    port2.close();
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 60_000 }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
