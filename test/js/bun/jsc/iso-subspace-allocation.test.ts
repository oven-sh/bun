// subspaceForImpl<T> is the lazy-init path that every JS class with its own
// IsoSubspace goes through on first allocation. It picks a HeapCellType,
// constructs the server IsoSubspace under a lock, optionally registers it as
// an output-constraint space, then constructs the per-VM GCClient wrapper.
//
// The slow path is shared out-of-line (subspaceForImplSlow in
// BunClientData.cpp); this test exercises each of its branches so a
// regression in that function shows up as a crash or GC corruption rather
// than silently wrong behavior in some rarely-allocated class.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("IsoSubspace lazy init survives GC across all HeapCellType branches", async () => {
  // Run in a subprocess so every class hits the cold subspaceForImpl path
  // (the test runner has already warmed most of them in this VM).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      /* js */ `
        const vm = require("node:vm");
        const { EventEmitter } = require("node:events");

        // JSDestructibleObject branch (heap.destructibleObjectHeapCellType):
        // generated classes are all JSDestructibleObject-derived.
        let keep = [
          new Blob(["x"]),
          new Request("http://a/"),
          new Response("b"),
          new Headers({ a: "1" }),
          new URLSearchParams("a=1"),
          new TextEncoder(),
          new TextDecoder(),
          new FormData(),
          Bun.CryptoHasher ? new Bun.CryptoHasher("sha1") : null,
        ];

        // Non-destructible branch (heap.cellHeapCellType): AsyncContextFrame,
        // reached via AsyncLocalStorage.run.
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        als.run({ v: 1 }, () => {
          if (als.getStore().v !== 1) throw new Error("als");
        });

        // UseCustomHeapCellType::Yes branch: NodeVMGlobalObject + the global
        // object itself. Also re-enters subspaceForImpl from a nested VM.
        const ctx = vm.createContext({ out: null });
        vm.runInContext("out = 1 + 1", ctx);
        if (ctx.out !== 2) throw new Error("vm");

        // visitOutputConstraints override -> outputConstraintSpaces().append:
        // MessageChannel / MessagePort / EventEmitter all override it.
        const mc = new MessageChannel();
        const ee = new EventEmitter();
        ee.on("x", () => {});
        const po = new PerformanceObserver(() => {});
        keep.push(mc, ee, po);

        Bun.gc(true);

        // Second allocation of each hits the fast path (client slot cached).
        let keep2 = [
          new Blob(["y"]),
          new Request("http://b/"),
          new Response("c"),
          new MessageChannel(),
          vm.createContext({}),
        ];

        Bun.gc(true);

        // Drop everything and collect — destructors run through the
        // HeapCellType picked by subspaceForImpl.
        keep = null;
        keep2 = null;
        mc.port1.close();
        mc.port2.close();
        Bun.gc(true);
        Bun.gc(true);

        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("IsoSubspace lazy init across Worker VMs (shared server slot, per-VM client slot)", async () => {
  // Workers share the JSHeapData (server subspaces) under useGlobalGC but get
  // their own clientSubspaces; the locked double-check in subspaceForImplSlow
  // is what keeps that safe.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--smol",
      "-e",
      /* js */ `
        const src = \`
          const { parentPort } = require("node:worker_threads");
          // Force a spread of subspace first-allocations in this VM.
          const keep = [
            new Blob(["w"]),
            new Response("w"),
            new URL("http://w/"),
            new MessageChannel(),
            new AbortController(),
          ];
          Bun.gc(true);
          parentPort.postMessage("done");
        \`;

        const workers = [];
        for (let i = 0; i < 4; i++) {
          workers.push(
            new Promise((resolve, reject) => {
              const w = new Worker("data:text/javascript," + encodeURIComponent(src));
              w.onmessage = () => { w.terminate(); resolve(); };
              w.onerror = reject;
            }),
          );
        }
        await Promise.all(workers);
        Bun.gc(true);
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
