import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
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

  test("close() inside onmessage handler stops further deliveries", async () => {
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
    expect(got).toEqual([1, 2]);
    port1.close();
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
  test.skipIf(!isDebug && !isASAN)(
    "round-trip burst delivers in order with microtasks between each",
    async () => {
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
    },
  );

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
