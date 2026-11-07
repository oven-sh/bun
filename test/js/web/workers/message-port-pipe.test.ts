import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import {
  MessageChannel as NodeMessageChannel,
  receiveMessageOnPort,
  type MessagePort as NodeMessagePort,
} from "node:worker_threads";

// Exercises the MessagePortPipe layer that backs MessagePort/MessageChannel:
// cross-thread wakeup coalescing, per-pipe isolation (no global registry),
// and thread-safety under concurrent channel churn.

describe("MessagePort pipe", () => {
  test("microtasks run between message events (task-source semantics)", async () => {
    const { port1, port2 } = new MessageChannel();
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      order.push("msg:" + e.data);
      queueMicrotask(() => order.push("mt:" + e.data));
      if (e.data === 3) queueMicrotask(resolve);
    };
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    await promise;
    // Each message is its own task → microtask checkpoint between each.
    expect(order).toEqual(["msg:1", "mt:1", "msg:2", "mt:2", "msg:3", "mt:3"]);
    port1.close();
    port2.close();
  });

  test("messages buffered before start() are delivered on start()", async () => {
    const { port1, port2 } = new MessageChannel();
    port1.postMessage("a");
    port1.postMessage("b");
    port1.postMessage("c");
    const got: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      got.push(e.data);
      if (got.length === 3) resolve();
    };
    await promise;
    expect(got).toEqual(["a", "b", "c"]);
    port1.close();
    port2.close();
  });

  test("receiveMessageOnPort pops in FIFO order", () => {
    const { port1, port2 } = new MessageChannel();
    const N = 500;
    for (let i = 0; i < N; i++) port1.postMessage({ i });
    for (let i = 0; i < N; i++) {
      expect(receiveMessageOnPort(port2)).toEqual({ message: { i } });
    }
    expect(receiveMessageOnPort(port2)).toBeUndefined();
    port1.close();
    port2.close();
  });

  test("close() inside onmessage handler still delivers already-queued messages", async () => {
    const { port1, port2 } = new MessageChannel();
    const got: number[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      got.push(e.data);
      if (e.data === 2) {
        port2.close();
        queueMicrotask(resolve);
      }
    };
    for (let i = 1; i <= 5; i++) port1.postMessage(i);
    await promise;
    await Bun.sleep(0);
    expect(got).toEqual([1, 2, 3, 4, 5]);
    port1.close();
  });

  // 1.4.0 to 1.4.4 ran the handlers of "second" and "third" inside close(), so "second" won.
  test("a handler that closes the port and then settles a promise settles it with its own message", async () => {
    const { port1, port2 } = new MessageChannel();
    const winner = new Promise(resolve => {
      port2.onmessage = e => {
        port2.close();
        resolve(e.data);
      };
    });
    port1.postMessage("first");
    port1.postMessage("second");
    port1.postMessage("third");
    expect(await winner).toBe("first");
    port1.close();
  });

  // close() from inside a handler only marks the port. The drain that is already running
  // delivers the rest of the inbox after the handler returns (depth 1, like node); close()
  // itself dispatches nothing, and the closing port discards everything posted on it.
  test("close() inside a handler does not re-enter the handler, and posts after it are discarded", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    const peerGot: string[] = [];
    let depth = 0;
    port2.onmessage = e => {
      depth++;
      seen.push(`${e.data}@${depth}`);
      port2.close();
      port2.postMessage(`after-close-${e.data}`);
      depth--;
    };
    port1.onmessage = e => peerGot.push(e.data);
    // port1's 'close' (fired because port2 closed) lands after anything port2 sent it.
    const { promise: peerClosed, resolve } = Promise.withResolvers<void>();
    port1.addEventListener("close", () => resolve());
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    await peerClosed;
    expect({ seen, peerGot }).toEqual({ seen: ["1@1", "2@1", "3@1"], peerGot: [] });
    port1.close();
  });

  test("the batch a handler closed in keeps going, including what the peer posts meanwhile; 'close' follows it", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    let depth = 0;
    port2.onmessage = e => {
      depth++;
      seen.push(`${e.data}@${depth}`);
      if (e.data === 1) {
        port2.close();
        port1.postMessage("from-peer");
      }
      depth--;
    };
    port2.addEventListener("close", () => {
      seen.push("close");
      resolve();
    });
    port1.postMessage(1);
    port1.postMessage(2);
    await closed;
    expect(seen).toEqual(["1@1", "2@1", "from-peer@1", "close"]);
    port1.close();
  });

  // Same thing on the other delivery loop: the peer closed first, so this side's
  // messages are flushed ahead of its 'close' event, and a handler closes during that flush.
  test("close() inside a handler while the peer's close is being delivered", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    let depth = 0;
    port1.postMessage("a");
    port1.postMessage("b");
    port1.close();
    port2.addEventListener("close", () => {
      seen.push("close");
      resolve();
    });
    port2.onmessage = e => {
      depth++;
      seen.push(`${e.data}@${depth}`);
      port2.close();
      depth--;
    };
    await closed;
    expect(seen).toEqual(["a@1", "b@1", "close"]);
  });

  // A callback queued by a handler runs between two deliveries, still inside the drain.
  test.each([
    ["queueMicrotask()", (fn: () => void) => queueMicrotask(fn)],
    ["process.nextTick()", (fn: () => void) => process.nextTick(fn)],
    ["a promise reaction", (fn: () => void) => void Promise.resolve().then(fn)],
  ])("close() from %s between two messages lets the batch finish", async (_, defer) => {
    const { port1, port2 } = new MessageChannel();
    const seen: (number | string)[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      seen.push(e.data);
      if (e.data === 1) defer(() => port2.close());
    };
    port2.addEventListener("close", () => {
      seen.push("close");
      resolve();
    });
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    await closed;
    expect(seen).toEqual([1, 2, 3, "close"]);
    port1.close();
  });

  // One drain delivers at most 1024 messages and leaves the rest to a later task. A port
  // that closed itself gets no later task, so the drain it closed in delivers the backlog.
  test.each([
    [3000, 1],
    [3000, 1500],
    [1025, 1024],
  ])("%d queued and close() in the handler of message %d: every message is delivered", async (total, closeAt) => {
    const { port1, port2 } = new MessageChannel();
    const peerGot: string[] = [];
    let handled = 0;
    let depth = 0;
    let maxDepth = 0;
    let inOrder = true;
    port2.onmessage = e => {
      maxDepth = Math.max(maxDepth, ++depth);
      if (e.data !== handled) inOrder = false;
      if (++handled === closeAt) {
        port2.close();
        port2.postMessage("after-close");
      }
      depth--;
    };
    port1.onmessage = e => peerGot.push(e.data);
    const { promise: peerClosed, resolve } = Promise.withResolvers<void>();
    port1.addEventListener("close", () => resolve());
    for (let i = 0; i < total; i++) port1.postMessage(i);
    await peerClosed;
    expect({ handled, maxDepth, inOrder, peerGot }).toEqual({
      handled: total,
      maxDepth: 1,
      inOrder: true,
      peerGot: [],
    });
    port1.close();
  });

  // After close() the drain takes what was queued at that point, or the rest of its 1024 if
  // that is more. The peer's answers queue behind that, so they cannot keep the port open.
  // Node handles max(queued when the drain began, 1000): 1000, 1000, 1025 and 2000 here.
  test.each([
    [1, 1024],
    [100, 1024],
    [1025, 1025],
    [2000, 2000],
  ])(
    "%d queued, the peer answers every message of the closing port: exactly %d are handled",
    async (queued, expected) => {
      const { port1, port2 } = new MessageChannel();
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      let handled = 0;
      let depth = 0;
      let maxDepth = 0;
      let answers = 0;
      port2.onmessage = () => {
        maxDepth = Math.max(maxDepth, ++depth);
        if (++handled === 1) port2.close();
        // The cap ends the test with a wrong count if the drain has no bound.
        if (answers++ < 5000) port1.postMessage("answer");
        depth--;
      };
      port2.addEventListener("close", () => resolve());
      for (let i = 0; i < queued; i++) port1.postMessage(i);
      await closed;
      expect({ handled, maxDepth }).toEqual({ handled: expected, maxDepth: 1 });
      port1.close();
    },
  );

  test("receiveMessageOnPort() in the handler that closed the port takes the next queued message", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: unknown[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      seen.push(e.data);
      if (e.data === 1) {
        port2.close();
        seen.push(receiveMessageOnPort(port2));
      }
    };
    port2.addEventListener("close", () => {
      seen.push("close");
      resolve();
    });
    for (let i = 1; i <= 4; i++) port1.postMessage(i);
    await closed;
    expect(seen).toEqual([1, { message: 2 }, 3, 4, "close"]);
    port1.close();
  });

  // close() returns before the rest of the batch is delivered, so what the handler does
  // next decides who gets it. Node prints the same three arrays.
  test.each([
    [
      "nothing",
      (_port: NodeMessagePort, _handler: (value: number) => void, _seen: unknown[]) => {},
      [1, "after close()", 2, 3, "close"],
    ],
    [
      "off()",
      (port: NodeMessagePort, handler: (value: number) => void) => void port.off("message", handler),
      [1, "after close()", "close"],
    ],
    [
      "a new listener",
      (port: NodeMessagePort, handler: (value: number) => void, seen: unknown[]) => {
        port.off("message", handler);
        port.on("message", value => seen.push(`new:${value}`));
      },
      [1, "after close()", "new:2", "new:3", "close"],
    ],
  ])("the statements after close() run before the rest of the batch: %s", async (_, after, expected) => {
    const { port1, port2 } = new NodeMessageChannel();
    const seen: unknown[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    const handler = (value: number) => {
      seen.push(value);
      if (value === 1) {
        port2.close();
        after(port2, handler, seen);
        seen.push("after close()");
      }
    };
    port2.on("message", handler);
    port2.on("close", () => {
      seen.push("close");
      resolve();
    });
    port1.postMessage(1);
    port1.postMessage(2);
    port1.postMessage(3);
    await closed;
    expect(seen).toEqual(expected);
    port1.close();
  });

  // postMessage() closes a port that is asked to transfer its own peer. Inside a handler
  // that close waits for the drain like any other.
  test("a port that posts its own peer from a handler is not re-entered by postMessage()", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: string[] = [];
    const { promise: closed, resolve } = Promise.withResolvers<void>();
    let depth = 0;
    port2.onmessage = e => {
      depth++;
      seen.push(`${e.data}@${depth}`);
      if (e.data === 1) {
        port2.postMessage("lost", [port1]);
        seen.push("postMessage returned");
      }
      depth--;
    };
    port2.addEventListener("close", () => {
      seen.push("close");
      resolve();
    });
    for (let i = 1; i <= 3; i++) port1.postMessage(i);
    await closed;
    expect(seen).toEqual(["1@1", "postMessage returned", "2@1", "3@1", "close"]);
  });

  // `expect(promise).resolves` waits with the event loop, so tasks run inside the caller (a
  // nested turn). A close() that waits for the drain completes in such a turn: it delivers
  // what is queued, in order, and closes. Without that this wait for 'close' never ends.
  test("close() between two deliveries, then a wait on the event loop for 'close'", async () => {
    const { port1, port2 } = new MessageChannel();
    const seen: unknown[] = [];
    const { promise: first, resolve: gotFirst } = Promise.withResolvers<void>();
    port2.onmessage = e => {
      seen.push(e.data);
      if (e.data === 1) gotFirst();
    };
    const closed = new Promise(resolve =>
      port2.addEventListener("close", () => {
        seen.push("close");
        resolve("closed");
      }),
    );
    const peerClosed = new Promise(resolve => port1.addEventListener("close", () => resolve("peer closed")));
    for (let i = 1; i <= 3; i++) port1.postMessage(i);
    await first;
    port2.close();
    seen.push("close() returned");
    await expect(closed).resolves.toBe("closed");
    expect(seen).toEqual([1, "close() returned", 2, 3, "close"]);
    await expect(peerClosed).resolves.toBe("peer closed");
  });

  // The same wait inside the handler. The handler turned the event loop itself, so the rest
  // arrives at depth 2 there, after close() returned. Each row has another delivery loop
  // on the stack, or another task that delivers, when the handler runs.
  test.each([
    [
      "the drain",
      (listen: (port: MessagePort) => void) => {
        const { port1, port2 } = new MessageChannel();
        listen(port2);
        for (let i = 1; i <= 4; i++) port1.postMessage(i);
        return [port1];
      },
    ],
    [
      "the flush that follows the peer's close",
      (listen: (port: MessagePort) => void) => {
        const { port1, port2 } = new MessageChannel();
        for (let i = 1; i <= 4; i++) port1.postMessage(i);
        port1.close();
        listen(port2);
        return [];
      },
    ],
    [
      "the drain, with a second drain task queued",
      (listen: (port: MessagePort) => void) => {
        const { port1, port2 } = new MessageChannel();
        const carrier = new MessageChannel();
        port2.onmessage = () => {};
        for (let i = 1; i <= 4; i++) port1.postMessage(i);
        // The transfer gives the side a new port in this thread, and that port schedules its own drain.
        carrier.port1.postMessage(port2, [port2]);
        listen(receiveMessageOnPort(carrier.port2)!.message as MessagePort);
        return [port1, carrier.port1, carrier.port2];
      },
    ],
  ])("close() in the handler, then a wait on the event loop for 'close', under %s", async (_, arrange) => {
    const seen: string[] = [];
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    const { promise: returned, resolve: onReturn } = Promise.withResolvers<void>();
    let depth = 0;
    const others = arrange(port => {
      port.addEventListener("close", () => {
        seen.push("close");
        onClose();
      });
      port.onmessage = e => {
        depth++;
        seen.push(`${e.data}@${depth}`);
        if (e.data === 1) {
          port.close();
          seen.push("close() returned");
          expect(closed).resolves.toBeUndefined();
          seen.push("wait returned");
          onReturn();
        }
        depth--;
      };
    });
    await returned;
    expect(seen).toEqual(["1@1", "close() returned", "2@2", "3@2", "4@2", "close", "wait returned"]);
    for (const port of others) port.close();
  });

  // A ref() taken after close() in the handler lasts until the port has closed. The script
  // has no process.exit(): it ends only if that ref is released.
  test.concurrent("ref() after close() in the handler is held until the port has closed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { MessageChannel } = require("worker_threads");
          const { port1, port2 } = new MessageChannel();
          const seen = [];
          port2.on("close", () => {
            seen.push("close", port2.hasRef());
            console.log(JSON.stringify(seen));
          });
          port2.on("message", value => {
            seen.push(value);
            if (value === 1) {
              port2.close();
              port2.ref();
            }
            seen.push(port2.hasRef());
          });
          port1.postMessage(1);
          port1.postMessage(2);
          port1.unref();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([1, true, 2, true, "close", false]);
    expect(exitCode).toBe(0);
  });

  // The closing port lives on a worker thread and its peer on the main thread.
  test.concurrent(
    "a port that closed itself in a worker's handler sends nothing to its peer on the main thread",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { Worker, MessageChannel } = require("worker_threads");
            const { port1, port2 } = new MessageChannel();
            const w = new Worker(
              \`
                const { parentPort } = require("worker_threads");
                parentPort.once("message", ({ port }) => {
                  const seen = [];
                  let depth = 0;
                  port.on("message", v => {
                    depth++;
                    seen.push(v + "@" + depth);
                    port.close();
                    port.postMessage("after-close-" + v);
                    depth--;
                  });
                  port.on("close", () => parentPort.postMessage(seen));
                });
              \`,
              { eval: true },
            );
            const peerGot = [];
            port1.on("message", v => peerGot.push(v));
            // port1's 'close' lands after anything the worker's port sent it.
            const peerClosed = new Promise(resolve => port1.once("close", resolve));
            const workerSaw = new Promise(resolve => w.once("message", resolve));
            // Queued before the transfer, so the worker's first drain has all three.
            port1.postMessage(1);
            port1.postMessage(2);
            port1.postMessage(3);
            w.postMessage({ port: port2 }, [port2]);
            const [seen] = await Promise.all([workerSaw, peerClosed]);
            console.log(JSON.stringify({ seen, peerGot }));
            await w.terminate();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ seen: ["1@1", "2@1", "3@1"], peerGot: [] });
      expect(exitCode).toBe(0);
    },
  );

  // The main thread posts into the closing port until the handler that called close() has
  // seen 2000 more posts land. A drain that went on until the inbox is empty would handle
  // them. It handles the backlog and stops.
  test.concurrent(
    "a closing port in a worker that the main thread floods delivers its backlog and closes",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { Worker, MessageChannel } = require("worker_threads");
            const { port1, port2 } = new MessageChannel();
            // [0]: flood messages the main thread has posted, counted one batch late. [1]: the handler stopped waiting.
            const shared = new Int32Array(new SharedArrayBuffer(8));
            const queued = 1100, batch = 200;
            const w = new Worker(
              \`
                const { parentPort, workerData: shared } = require("worker_threads");
                parentPort.once("message", ({ port }) => {
                  let handled = 0, depth = 0, maxDepth = 0, before = 0, after = 0;
                  port.on("message", () => {
                    maxDepth = Math.max(maxDepth, ++depth);
                    if (++handled === 1) {
                      before = Atomics.load(shared, 0);
                      port.close();
                      after = Atomics.load(shared, 0);
                      for (let n; (n = Atomics.load(shared, 0)) < after + 2000; ) Atomics.wait(shared, 0, n);
                      Atomics.store(shared, 1, 1);
                    }
                    port.postMessage("after-close");
                    depth--;
                  });
                  port.on("close", () => parentPort.postMessage({ handled, maxDepth, before, after }));
                  parentPort.postMessage("listening");
                });
              \`,
              { eval: true, workerData: shared },
            );
            let peerGot = 0;
            port1.on("message", () => peerGot++);
            // port1's 'close' lands after anything the worker's port sent it.
            const peerClosed = new Promise(resolve => port1.once("close", resolve));
            const flood = () => {
              if (Atomics.load(shared, 1)) return;
              for (let i = 0; i < batch; i++) port1.postMessage("flood");
              Atomics.add(shared, 0, batch);
              Atomics.notify(shared, 0);
              setImmediate(flood);
            };
            const report = new Promise((resolve, reject) => {
              w.on("message", m => (m === "listening" ? flood() : resolve(m)));
              w.on("error", reject);
              w.on("exit", code => reject(new Error("the worker exited with " + code)));
            });
            for (let i = 0; i < queued; i++) port1.postMessage(i);
            w.postMessage({ port: port2 }, [port2]);
            const [{ handled, maxDepth, before, after }] = await Promise.all([report, peerClosed]);
            // Queued at close(): the 1100 and the flood so far.
            const backlogDelivered = handled >= queued + before;
            const stopped = handled <= queued + after + batch + 1024;
            console.log(JSON.stringify({ backlogDelivered, stopped, maxDepth, peerGot }));
            await w.terminate();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ backlogDelivered: true, stopped: true, maxDepth: 1, peerGot: 0 });
      expect(exitCode).toBe(0);
    },
  );

  // Bun.ModuleGraph.dispose() stops the ports of the graph while one of their handlers is
  // on the stack. That close is immediate and delivers nothing, also after close().
  test.concurrent.each([
    ["dispose, then a nested turn", [1, "disposed", "nested turn done"]],
    ["close, then dispose", [1, "disposed"]],
  ])("a graph disposed in the handler of its port gets no more messages: %s", async (mode, expected) => {
    using dir = tempDir("message-port-dispose", {
      "graph.mjs": `
        // Globals from the host: mode, report(label), hold(port), disposeGraph(), nestedTurn(), finished().
        const { port1, port2 } = new MessageChannel();
        port2.onmessage = e => {
          report(typeof e.data === "object" ? "port" : e.data);
          if (e.data !== 1) return;
          if (mode === "close, then dispose") port2.close();
          disposeGraph();
          if (mode === "dispose, then a nested turn") nestedTurn();
          finished();
        };
        port1.postMessage(1);
        // Delivering this one after dispose() would make a port in the disposed graph.
        const carried = new MessageChannel();
        hold(carried.port2);
        port1.postMessage({ port: carried.port1 }, [carried.port1]);
        port1.postMessage(2);
      `,
      "host.mjs": `
        import { join } from "node:path";
        const mode = process.argv[2];
        const seen = [];
        const held = [];
        const { promise: done, resolve: finished } = Promise.withResolvers();
        // Made here, in the host's context. A channel made inside the graph's handler would be the disposed graph's.
        const turn = new MessageChannel();
        let turned;
        turn.port2.onmessage = () => turned();
        const graph = new Bun.ModuleGraph({
          globals: {
            mode,
            report: label => seen.push(label),
            hold: port => held.push(port),
            finished,
            disposeGraph: () => {
              graph.dispose();
              seen.push("disposed");
            },
            // Bun.build() waits with the event loop for an async plugin setup(): a nested turn.
            nestedTurn: () => {
              const setup = () =>
                new Promise(resolve => {
                  turned = resolve;
                  turn.port1.postMessage(0);
                });
              Bun.build({ entrypoints: [join(import.meta.dir, "graph.mjs")], plugins: [{ name: "turn", setup }] }).catch(() => {});
              seen.push("nested turn done");
            },
          },
        });
        await graph.import(join(import.meta.dir, "graph.mjs"));
        await done;
        turn.port1.close();
        console.log(JSON.stringify(seen));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "host.mjs", mode],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test("messages queued on a port follow it across transfer", async () => {
    const { port1: A, port2: B } = new MessageChannel();
    const { port1: C, port2: D } = new MessageChannel();
    // Queue into C's inbox before and after the transfer; the pipe buffers
    // while the side is detached and flushes when the new owner start()s.
    D.postMessage("before-1");
    D.postMessage("before-2");
    A.postMessage(null, [C]);
    D.postMessage("after");
    const got: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    B.onmessage = e => {
      const newC = e.ports[0];
      newC.onmessage = ev => {
        got.push(ev.data);
        if (got.length === 3) resolve();
      };
    };
    await promise;
    expect(got).toEqual(["before-1", "before-2", "after"]);
    A.close();
    B.close();
    D.close();
  });

  // A handler that synchronously transfers *this port* through a local
  // carrier and re-wraps it via receiveMessageOnPort produces a new
  // MessagePort bound to the same {pipe, side} on the same context. The
  // drain loop must notice the port identity changed and stop (the new
  // owner's attach()-scheduled drain delivers the rest) rather than
  // dispatching to the stale detached wrapper and dropping messages.
  test("same-context re-attach inside handler: inbox follows new wrapper", async () => {
    const { port1: A, port2: B } = new MessageChannel();
    const got: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    A.onmessage = e => {
      got.push("old:" + e.data);
      if (e.data === 1) {
        const c = new MessageChannel();
        c.port1.postMessage(A, [A]);
        const newA = receiveMessageOnPort(c.port2)!.message as MessagePort;
        newA.onmessage = ev => {
          got.push("new:" + ev.data);
          if (ev.data === 3) resolve();
        };
        c.port1.close();
        c.port2.close();
      }
    };
    B.postMessage(1);
    B.postMessage(2);
    B.postMessage(3);
    await promise;
    expect(got).toEqual(["old:1", "new:2", "new:3"]);
    B.close();
  });

  test("chained transfer delivers through every hop", async () => {
    // Pipe X is transferred A→B, then B transfers it onward C→D.
    const { port1: A, port2: B } = new MessageChannel();
    const { port1: C, port2: D } = new MessageChannel();
    const { port1: X1, port2: X2 } = new MessageChannel();
    const { promise, resolve } = Promise.withResolvers<string>();
    B.onmessage = e => C.postMessage(null, [e.ports[0]]);
    D.onmessage = e => {
      const x = e.ports[0];
      x.onmessage = ev => resolve(ev.data);
    };
    A.postMessage(null, [X1]);
    X2.postMessage("hello through two hops");
    expect(await promise).toBe("hello through two hops");
    for (const p of [A, B, C, D, X2]) p.close();
  });

  // GC contract: JS wrappers for MessageChannel / MessagePort / BroadcastChannel
  // should be reclaimed once closed and unreferenced. The listener-side port
  // is kept alive by hasPendingActivity() while its peer is open, and released
  // once the peer closes.
  test("objectTypeCounts drop after close + GC; peer-open pins listening port", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { heapStats } = require("bun:jsc");
          const count = k => heapStats().objectTypeCounts[k] || 0;
          async function settle() { for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(0); } }

          await settle();
          const base = { mc: count("MessageChannel"), mp: count("MessagePort"), bc: count("BroadcastChannel") };

          // 1. MessageChannel / BroadcastChannel wrapper counts drop after close+GC.
          {
            const chans = [], bcs = [];
            for (let i = 0; i < 200; i++) {
              const c = new MessageChannel();
              c.port1.postMessage(i); // touch ports so wrappers exist
              c.port2;
              chans.push(c);
            }
            for (let i = 0; i < 100; i++) bcs.push(new BroadcastChannel("t" + i));
            const peak = { mc: count("MessageChannel"), mp: count("MessagePort"), bc: count("BroadcastChannel") };
            for (const c of chans) { c.port1.close(); c.port2.close(); }
            for (const b of bcs) b.close();
            chans.length = 0; bcs.length = 0;
            await settle();
            const after = { mc: count("MessageChannel"), mp: count("MessagePort"), bc: count("BroadcastChannel") };
            // Peak should be well above baseline; after close+GC should be near baseline.
            // Allow slack for conservative stack scanning.
            const ok1 =
              peak.mc - base.mc >= 150 &&
              peak.mp - base.mp >= 300 &&
              peak.bc - base.bc >= 80 &&
              after.mc - base.mc <= 20 &&
              after.mp - base.mp <= 20 &&
              after.bc - base.bc <= 10;
            if (!ok1) { console.error("part1", JSON.stringify({ base, peak, after })); process.exit(1); }
          }

          // 2. hasPendingActivity: port with listener is pinned while peer open,
          //    released once peer closes.
          await settle();
          const base2 = count("MessagePort");
          const senders = [];
          for (let i = 0; i < 100; i++) {
            const { port1, port2 } = new MessageChannel();
            port2.onmessage = () => {}; // listener → kept alive iff peer open
            senders.push(port1);
            // port2 is otherwise unreferenced
          }
          await settle();
          const pinned = count("MessagePort") - base2; // expect ≈ 200 (100 held + 100 pinned)
          for (const p of senders) p.close();
          await settle();
          const afterPeerClose = count("MessagePort") - base2; // expect ≈ 100 (held senders only)
          senders.length = 0;
          await settle();
          const afterDropAll = count("MessagePort") - base2; // expect ≈ 0
          const ok2 = pinned >= 180 && afterPeerClose <= 120 && afterPeerClose >= 80 && afterDropAll <= 20;
          if (!ok2) { console.error("part2", JSON.stringify({ base2, pinned, afterPeerClose, afterDropAll })); process.exit(1); }

          console.log("OK");
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  // A port transferred through a carrier whose destination is already
  // closed never reaches a new owner. The endpoint must be marked Closed
  // when the in-transit struct is dropped, otherwise the peer's
  // hasPendingActivity() pins it forever.
  test("port dropped in transit does not pin its peer", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { port1: A, port2: B } = new MessageChannel();
          B.close();
          const finalized = { count: 0 };
          const reg = new FinalizationRegistry(() => { finalized.count++; });
          for (let i = 0; i < 200; i++) {
            const { port1: C, port2: D } = new MessageChannel();
            D.onmessage = () => {};
            reg.register(D, "D");
            A.postMessage(null, [C]); // C dropped: B is closed
          }
          for (let i = 0; i < 10; i++) { Bun.gc(true); await Bun.sleep(0); }
          // If dropped-in-transit endpoints weren't closed, every D would
          // be pinned via isOtherSideOpen and finalized.count would be 0.
          console.log(JSON.stringify({ finalized: finalized.count }));
          A.close();
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { finalized } = JSON.parse(stdout.trim());
    expect(finalized).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });

  // The old design kept every channel in a process-global HashMap with no
  // lock (MessagePortChannelRegistry). Concurrent new MessageChannel() from
  // worker threads mutated that map simultaneously. Under ASAN this shows
  // up as heap corruption / SEGV inside the HashMap; with the pipe design
  // there is no shared map at all.
  //
  // Sanitizer-gated: the race being exercised is a memory-safety bug that
  // only surfaces deterministically under ASAN/UBSan.
  test.skipIf(!isDebug && !isASAN)("concurrent MessageChannel creation across workers is race-free", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker } = require("worker_threads");
          const workerSrc = \`
            const { parentPort, MessageChannel } = require("worker_threads");
            for (let i = 0; i < 2000; i++) {
              const { port1, port2 } = new MessageChannel();
              port1.postMessage(i);
              port1.close();
              port2.close();
            }
            parentPort.postMessage("done");
          \`;
          const workers = [];
          for (let i = 0; i < 4; i++) {
            workers.push(new Promise((resolve, reject) => {
              const w = new Worker(workerSrc, { eval: true });
              w.on("message", resolve);
              w.on("error", reject);
            }));
          }
          // Churn on the main thread at the same time.
          for (let i = 0; i < 2000; i++) {
            const { port1, port2 } = new MessageChannel();
            port1.postMessage(i);
            port1.close();
            port2.close();
          }
          await Promise.all(workers);
          console.log("OK");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isDebug && !isASAN)("burst of postMessage across threads delivers every message in order", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker, MessageChannel } = require("worker_threads");
          const { port1, port2 } = new MessageChannel();
          const w = new Worker(
            \`
              const { parentPort } = require("worker_threads");
              parentPort.once("message", ({ port }) => {
                for (let i = 0; i < 1000; i++) port.postMessage(i);
                port.postMessage("end");
              });
            \`,
            { eval: true },
          );
          w.postMessage({ port: port2 }, [port2]);
          let next = 0;
          port1.on("message", v => {
            if (v === "end") {
              if (next !== 1000) { console.error("got", next); process.exit(1); }
              console.log("OK");
              port1.close();
              w.terminate();
              return;
            }
            if (v !== next) { console.error("out of order", v, next); process.exit(1); }
            next++;
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});

// worker.postMessage / parentPort.postMessage go through the same coalesced
// inbox+batch-drain path as MessagePortPipe. Verify the observable ordering
// matches Node: messages arrive in order with a microtask checkpoint between
// each, for both directions.
describe("Worker postMessage inbox", () => {
  test.skipIf(!isDebug && !isASAN)("round-trip burst delivers in order with microtasks between each", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Worker, isMainThread, parentPort } = require("node:worker_threads");
          const N = 200;
          const order = [];
          const w = new Worker(
            \`
              const { parentPort } = require("node:worker_threads");
              const order = [];
              let n = 0;
              parentPort.on("message", d => {
                order.push("m" + d);
                queueMicrotask(() => order.push("u" + d));
                parentPort.postMessage(d);
                if (++n === ${"${N}"}) {
                  queueMicrotask(() => parentPort.postMessage({ done: order }));
                }
              });
            \`,
            { eval: true },
          );
          let echoed = 0;
          w.on("message", v => {
            if (typeof v === "object" && v.done) {
              // Worker-side ordering: m0,u0,m1,u1,...
              for (let i = 0; i < N; i++) {
                if (v.done[2*i] !== "m"+i || v.done[2*i+1] !== "u"+i) {
                  console.error("worker order wrong at", i, v.done.slice(2*i, 2*i+4));
                  process.exit(1);
                }
              }
              if (echoed !== N) { console.error("echoed", echoed, "expected", N); process.exit(1); }
              console.log("OK");
              w.terminate();
              return;
            }
            order.push("m" + v);
            queueMicrotask(() => order.push("u" + v));
            if (v !== echoed) { console.error("parent out of order", v, echoed); process.exit(1); }
            echoed++;
            if (echoed === N) {
              queueMicrotask(() => {
                for (let i = 0; i < N; i++) {
                  if (order[2*i] !== "m"+i || order[2*i+1] !== "u"+i) {
                    console.error("parent order wrong at", i, order.slice(2*i, 2*i+4));
                    process.exit(1);
                  }
                }
              });
            }
          });
          await new Promise(r => w.once("online", r));
          for (let i = 0; i < N; i++) w.postMessage(i);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("messages sent before worker online are delivered once it starts", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const w = new Worker(
          \`
            const { parentPort } = require("node:worker_threads");
            const got = [];
            parentPort.on("message", d => {
              got.push(d);
              if (got.length === 5) parentPort.postMessage(got);
            });
          \`,
          { eval: true },
        );
        // Post before the worker can possibly be online.
        for (let i = 0; i < 5; i++) w.postMessage(i);
        w.on("message", got => {
          if (JSON.stringify(got) !== JSON.stringify([0,1,2,3,4])) {
            console.error("wrong", got);
            process.exit(1);
          }
          console.log("OK");
          w.terminate();
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });
});
