import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.takeHeapSnapshot does not crash with exotic objects on the heap", async () => {
  const code = `
    const vm = require("vm");
    // Put a variety of objects on the heap that exercise class-name resolution
    // during the snapshot's JSON serialization.
    globalThis.sr = new ShadowRealm();
    globalThis.p = new Proxy({}, {
      getOwnPropertyDescriptor() { ArrayBuffer(); },
      get() { ArrayBuffer(); },
    });
    globalThis.child = Object.create(globalThis.p);
    globalThis.ctx = vm.createContext({});
    vm.runInContext("globalThis.x = {}", globalThis.ctx);
    console.takeHeapSnapshot();
    console.error("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
