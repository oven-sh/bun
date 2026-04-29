import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { receiveMessageOnPort } from "node:worker_threads";

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

  // The old design kept every channel in a process-global HashMap with no
  // lock (MessagePortChannelRegistry). Concurrent new MessageChannel() from
  // worker threads mutated that map simultaneously. Under ASAN this shows
  // up as heap corruption / SEGV inside the HashMap; with the pipe design
  // there is no shared map at all.
  test("concurrent MessageChannel creation across workers is race-free", async () => {
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
  }, 60_000);

  test("burst of postMessage across threads delivers every message in order", async () => {
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
  }, 60_000);
});
