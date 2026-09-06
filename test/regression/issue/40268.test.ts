import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/40268
// node:worker_threads read MessagePort / MessageChannel / BroadcastChannel /
// Worker from the mutable globals at module load. User code that replaces them
// before the module loads (happy-dom's global registrator does) broke
// `new Worker()` with "port.on is not a function".
test("new Worker works after user code replaces the web globals", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `class FakePort extends EventTarget {}
      class FakeChannel {}
      class FakeBroadcastChannel {}
      class FakeWorker {}
      globalThis.MessagePort = FakePort;
      globalThis.MessageChannel = FakeChannel;
      globalThis.BroadcastChannel = FakeBroadcastChannel;
      globalThis.Worker = FakeWorker;

      const wt = await import("node:worker_threads");

      // The module exports are the intrinsics, not the replaced globals.
      if (wt.MessagePort === FakePort) throw new Error("MessagePort export is the replaced global");
      if (wt.MessageChannel === FakeChannel) throw new Error("MessageChannel export is the replaced global");
      if (wt.BroadcastChannel === FakeBroadcastChannel) throw new Error("BroadcastChannel export is the replaced global");
      // The node-style emitter methods landed on the intrinsic prototype.
      if (typeof wt.MessagePort.prototype.on !== "function") throw new Error("MessagePort.prototype.on missing");

      const { port1, port2 } = new wt.MessageChannel();
      if (!(port1 instanceof wt.MessagePort)) throw new Error("MessageChannel made a non-intrinsic port");
      port1.close();
      port2.close();

      const w = new wt.Worker("", { eval: true });
      await w.terminate();
      console.log("ok");`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
