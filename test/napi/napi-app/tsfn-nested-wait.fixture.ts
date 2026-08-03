// Fixture for test/napi/tsfn-nested-wait.test.ts (oven-sh/bun#36828). Run
// under `bun test`: expect(promise).resolves waits for the promise by running
// a nested event loop, which is the ingredient that used to deadlock
// threadsafe function dispatch.
import { expect, test } from "bun:test";
import { join } from "path";

const addon = require(join(import.meta.dir, "build/Debug/tsfn_nested_wait_addon.node"));

test("calls pushed while a callback blocks in a nested wait are dispatched", async () => {
  const done = Promise.withResolvers<void>();
  const blocker = Promise.withResolvers<number>();
  const order: number[] = [];
  addon.startConcurrent((tag: number) => {
    order.push(tag);
    if (tag === 1) {
      addon.signalBlocked();
      // Blocks the event loop inside this threadsafe function dispatch until
      // `blocker` settles; it only settles when call 2, pushed by the addon
      // thread while we are blocked here, gets dispatched.
      expect(blocker.promise).resolves.toBe(2);
      order.push(3);
      done.resolve();
    } else {
      blocker.resolve(tag);
    }
  });
  await done.promise;
  expect(order).toEqual([1, 2, 3]);
});

test("calls queued behind a callback that blocks in a nested wait are dispatched", async () => {
  const done = Promise.withResolvers<void>();
  const blocker = Promise.withResolvers<number>();
  const order: number[] = [];
  // Both calls are already queued before the first dispatch runs.
  addon.startQueued((tag: number) => {
    order.push(tag);
    if (tag === 1) {
      expect(blocker.promise).resolves.toBe(2);
      order.push(3);
      done.resolve();
    } else {
      blocker.resolve(tag);
    }
  });
  await done.promise;
  expect(order).toEqual([1, 2, 3]);
});
