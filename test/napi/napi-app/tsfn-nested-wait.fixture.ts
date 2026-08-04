// Fixture for test/napi/tsfn-nested-wait.test.ts (oven-sh/bun#36828); must run
// under `bun test` so expect(promise).resolves blocks in a nested event loop.
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
      // blocks inside this dispatch until call 2 is dispatched
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

test("calls queued behind a microtask that blocks in a nested wait are dispatched in order", async () => {
  const done = Promise.withResolvers<void>();
  const blocker = Promise.withResolvers<number>();
  const order: number[] = [];
  addon.startQueued((tag: number) => {
    order.push(tag);
    if (tag === 1) {
      // The block happens in the microtask drained between the two queued
      // calls, not in the callback itself.
      queueMicrotask(() => {
        expect(blocker.promise).resolves.toBe(2);
        order.push(3);
        done.resolve();
      });
    } else {
      blocker.resolve(tag);
    }
  });
  await done.promise;
  expect(order).toEqual([1, 2, 3]);
});
