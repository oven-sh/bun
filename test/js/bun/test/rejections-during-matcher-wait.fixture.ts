// Run by test-test.test.ts ("unhandled rejections around a matcher's synchronous
// promise wait"), which checks which of these tests pass and which errors are
// reported against which test. `.resolves`, `.rejects`, `toThrow()` on a function
// returning a promise and an async custom matcher all block the test inside the
// matcher until the promise settles, running the event loop from there.
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const error1 = new Error("error1");
const swallow = () => {};

/// `settled` resolves and every promise in `rejected` rejects with `error1`, all
/// from one timer callback: whichever of them a matcher is waiting on, the others
/// settle while it waits.
function settleTogether(rejectedCount: number) {
  const settled = Promise.withResolvers<void>();
  const rejected = Array.from({ length: rejectedCount }, () => Promise.withResolvers<never>());
  setTimeout(() => {
    settled.resolve();
    for (const { reject } of rejected) reject(error1);
  }, 1);
  return { settled: settled.promise, rejected: rejected.map(r => r.promise) };
}

declare module "bun:test" {
  interface Matchers<T> {
    toSettle(): void;
  }
}

expect.extend({
  toSettle(received: Promise<unknown>) {
    return received.then(() => ({ pass: true, message: () => "settled" }));
  },
});

test("toThrow(): siblings rejecting during the first wait are checked by the next ones", () => {
  for (const p of settleTogether(3).rejected) {
    expect(async () => {
      await p;
    }).toThrow(error1);
  }
});

test(".rejects: siblings rejecting during the first wait are checked by the next ones", () => {
  for (const p of settleTogether(3).rejected) {
    expect(p).rejects.toBe(error1);
  }
});

test(".resolves: rejections during the wait can be handled after it", () => {
  const { settled, rejected } = settleTogether(2);
  expect(settled).resolves.toBeUndefined();
  for (const p of rejected) p.catch(swallow);
});

test("custom async matcher: rejections during the wait can be handled after it", () => {
  const { settled, rejected } = settleTogether(2);
  expect(settled).toSettle();
  for (const p of rejected) p.catch(swallow);
});

test("toThrow(): a rejection from before the call can still be handled after it", () => {
  const p = Promise.reject(error1);
  expect(() => {
    throw error1;
  }).toThrow(error1);
  p.catch(swallow);
});

test("toThrow(): a rejection left unhandled during the wait fails the test", () => {
  expect(async () => {
    await new Promise<void>(resolve =>
      setTimeout(() => {
        Promise.reject(new Error("UNHANDLED_DURING_TOTHROW_WAIT"));
        resolve();
      }, 1),
    );
  }).not.toThrow();
});

test("toThrow(): a rejection left unhandled by the function itself fails the test", () => {
  expect(() => {
    Promise.reject(new Error("UNHANDLED_FROM_THE_FUNCTION"));
    throw error1;
  }).toThrow(error1);
});

test("toThrow(): an exception thrown by a callback during the wait fails the test", () => {
  expect(async () => {
    await new Promise<void>(resolve =>
      setTimeout(() => {
        resolve();
        throw new Error("THROWN_DURING_TOTHROW_WAIT");
      }, 1),
    );
  }).not.toThrow();
});

test(".rejects: a rejection left unhandled during the wait fails the test", () => {
  expect(
    new Promise((_, reject) =>
      setTimeout(() => {
        Promise.reject(new Error("UNHANDLED_DURING_REJECTS_WAIT"));
        reject(error1);
      }, 1),
    ),
  ).rejects.toBe(error1);
});

test("resumed by an event loop task: a rejection it leaves is its own", async () => {
  await readFile(import.meta.path);
  Promise.reject(new Error("UNHANDLED_AFTER_TASK_RESUME"));
});

test("resumed by an event loop task: a rejection left during a wait is its own", async () => {
  await readFile(import.meta.path);
  expect(
    new Promise((_, reject) =>
      setTimeout(() => {
        Promise.reject(new Error("UNHANDLED_DURING_WAIT_AFTER_TASK_RESUME"));
        reject(error1);
      }, 1),
    ),
  ).rejects.toBe(error1);
});

test("the test after those passes", () => {});
