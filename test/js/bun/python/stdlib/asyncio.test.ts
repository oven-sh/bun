// Translated from CPython 3.15's Lib/test/test_asyncio: of test_queues.py, QueueBasicTests, QueueGetTests, QueuePutTests,
// LifoQueueTests, PriorityQueueTests and the three QueueJoinTests; of test_timeouts.py, the tests named below.
//
// There each test is a coroutine that a loop of its own runs. Here it is an async function of JavaScript, the coroutines in it
// are async functions too, and the loop is the one that Bun's event loop runs. What follows from that:
//  - To call an `async def` gives JavaScript a promise, and the coroutine is under way as a task. `asyncio.create_task(q.get())`
//    gives a task that waits for that one, and cancels it if it is cancelled.
//  - A step of an async function of JavaScript takes more turns of the loop than a step of a coroutine. Where a test there
//    counts turns (`await asyncio.sleep(0)` twice), it waits here for what it is waiting for: until().
//  - Nothing can cancel an async function of JavaScript. What is cancelled is the waiting for it.
// Not translated: repr and str of queues, the tests that cancel a coroutine written in the test at a certain step
// (test_get_cancel_drop_*, test_put_cancel_drop, test_put_cancelled_race, test_cancelled_put*), shutdown(); of the timeouts,
// the tests whose body catches the CancelledError or goes on after it (see "cancelling stops at JavaScript"), rescheduling,
// nested timeouts, task groups.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import { JSError } from "python:_js";
import asyncio, { CancelledError } from "python:asyncio";
import {
  KeyError,
  RuntimeError,
  TimeoutError,
  TypeError as PyTypeError,
  ValueError,
  int,
  len,
  range,
  repr,
  sum,
} from "python:builtins";
import { getitem } from "python:operator";
import { GenericAlias } from "python:types";
import { asyncWith, raises, raisesAsync, t } from "./helpers";

/** Lets the loop turn until the condition holds. */
async function until(condition: () => boolean) {
  while (!condition()) await asyncio.sleep(0);
}

/** Lets the loop turn often enough for whatever can go on to go on. */
async function settle() {
  for (let i = 0; i < 10; i++) await asyncio.sleep(0);
}

describe("QueueBasicTests", () => {
  test("test_generic_alias", () => {
    const q = getitem(asyncio.Queue, int);
    expect(q.__args__).toEqual(t(int));
    expect(q).toBeInstanceOf(GenericAlias);
  });

  test("test_empty", async () => {
    const q = asyncio.Queue();
    expect(q.empty()).toBe(true);
    await q.put(1);
    expect(q.empty()).toBe(false);
    expect(await q.get()).toBe(1);
    expect(q.empty()).toBe(true);
  });

  test("test_full", async () => {
    let q = asyncio.Queue();
    expect(q.full()).toBe(false);

    q = asyncio.Queue(kwargs({ maxsize: 1 }));
    await q.put(1);
    expect(q.full()).toBe(true);
  });

  test("test_order", async () => {
    const q = asyncio.Queue();
    for (const i of [1, 3, 2]) await q.put(i);

    const items = [await q.get(), await q.get(), await q.get()];
    expect(items).toEqual([1, 3, 2]);
  });

  test("test_maxsize", async () => {
    const q = asyncio.Queue(kwargs({ maxsize: 2 }));
    expect(q.maxsize).toBe(2);
    const have_been_put: number[] = [];

    async function putter() {
      for (let i = 0; i < 3; i++) {
        await q.put(i);
        have_been_put.push(i);
      }
      return true;
    }

    const task = asyncio.create_task(putter());
    await settle();

    // The putter is blocked after putting two items.
    expect(have_been_put).toEqual([0, 1]);
    expect(await q.get()).toBe(0);

    // Let the putter resume and put last item.
    await until(() => have_been_put.length == 3);
    expect(have_been_put).toEqual([0, 1, 2]);
    expect(await q.get()).toBe(1);
    expect(await q.get()).toBe(2);

    await until(() => task.done());
    expect(task.result()).toBe(true);
  });
});

describe("QueueGetTests", () => {
  test("test_blocking_get", async () => {
    const q = asyncio.Queue();
    q.put_nowait(1);

    expect(await q.get()).toBe(1);
  });

  test("test_get_with_putters", async () => {
    const loop = asyncio.get_running_loop();

    const q = asyncio.Queue(1);
    await q.put(1);

    const waiter = loop.create_future();
    q._putters.append(waiter);

    expect(await q.get()).toBe(1);
    expect(waiter.done()).toBe(true);
    expect(waiter.result()).toBeUndefined();
  });

  test("test_blocking_get_wait", async () => {
    const loop = asyncio.get_running_loop();
    const q = asyncio.Queue();
    const started = asyncio.Event();
    let finished = false;

    async function queue_get() {
      started.set();
      const res = await q.get();
      finished = true;
      return res;
    }

    const queue_get_task = asyncio.create_task(queue_get());
    await started.wait();
    expect(finished).toBe(false);
    loop.call_later(0.01, q.put_nowait, 1);
    const res = await queue_get_task;
    expect(finished).toBe(true);
    expect(res).toBe(1);
  });

  test("test_nonblocking_get", () => {
    const q = asyncio.Queue();
    q.put_nowait(1);
    expect(q.get_nowait()).toBe(1);
  });

  test("test_nonblocking_get_exception", () => {
    const q = asyncio.Queue();
    expect(q.get_nowait).toThrow(asyncio.QueueEmpty);
  });

  test("test_get_cancelled_race", async () => {
    const q = asyncio.Queue();

    const t1 = asyncio.create_task(q.get());
    const t2 = asyncio.create_task(q.get());

    await until(() => len(q._getters) == 2);
    t1.cancel();
    await until(() => t1.done());
    expect(t1.cancelled()).toBe(true);
    await q.put("a");
    await asyncio.sleep(0);
    expect(await t2).toBe("a");
  });

  test("test_get_with_waiting_putters", async () => {
    const q = asyncio.Queue(kwargs({ maxsize: 1 }));
    q.put("a");
    q.put("b");
    expect(await q.get()).toBe("a");
    expect(await q.get()).toBe("b");
  });

  test("test_why_are_getters_waiting", async () => {
    async function consumer(queue: any, num_expected: number) {
      for (let i = 0; i < num_expected; i++) await queue.get();
    }

    async function producer(queue: any, num_items: number) {
      for (let i = 0; i < num_items; i++) await queue.put(i);
    }

    const producer_num_items = 5;

    const q = asyncio.Queue(1);
    await asyncWith(asyncio.TaskGroup(), async tg => {
      tg.create_task(producer(q, producer_num_items));
      tg.create_task(consumer(q, producer_num_items));
    });
    expect(q.empty()).toBe(true);
  });

  test("test_cancelled_getters_not_being_held_in_self_getters", async () => {
    const queue = asyncio.Queue(kwargs({ maxsize: 5 }));

    await raisesAsync(TimeoutError, () => asyncio.wait_for(queue.get(), 0.1));

    expect(len(queue._getters)).toBe(0);
  });
});

describe("QueuePutTests", () => {
  test("test_blocking_put", async () => {
    const q = asyncio.Queue();

    // No maxsize, won't block.
    await q.put(1);
    expect(await q.get()).toBe(1);
  });

  test("test_blocking_put_wait", async () => {
    const q = asyncio.Queue(kwargs({ maxsize: 1 }));
    const started = asyncio.Event();
    let finished = false;

    async function queue_put() {
      started.set();
      await q.put(1);
      await q.put(2);
      finished = true;
    }

    const loop = asyncio.get_running_loop();
    loop.call_later(0.01, q.get_nowait);
    const queue_put_task = asyncio.create_task(queue_put());
    await started.wait();
    expect(finished).toBe(false);
    await queue_put_task;
    expect(finished).toBe(true);
  });

  test("test_nonblocking_put", () => {
    const q = asyncio.Queue();
    q.put_nowait(1);
    expect(q.get_nowait()).toBe(1);
  });

  test("test_nonblocking_put_exception", () => {
    const q = asyncio.Queue(kwargs({ maxsize: 1 }));
    q.put_nowait(1);
    expect(() => q.put_nowait(2)).toThrow(asyncio.QueueFull);
  });

  test("test_float_maxsize", async () => {
    let q = asyncio.Queue(kwargs({ maxsize: 1.3 }));
    q.put_nowait(1);
    q.put_nowait(2);
    expect(q.full()).toBe(true);
    expect(() => q.put_nowait(3)).toThrow(asyncio.QueueFull);

    q = asyncio.Queue(kwargs({ maxsize: 1.3 }));

    await q.put(1);
    await q.put(2);
    expect(q.full()).toBe(true);
  });

  test("test_put_cancelled", async () => {
    const q = asyncio.Queue();

    async function queue_put() {
      await q.put(1);
      return true;
    }

    const task = asyncio.create_task(queue_put());

    expect(await q.get()).toBe(1);
    await until(() => task.done());
    expect(task.result()).toBe(true);
  });
});

describe("LifoQueueTests", () => {
  test("test_order", async () => {
    const q = asyncio.LifoQueue();
    for (const i of [1, 3, 2]) await q.put(i);

    const items = [await q.get(), await q.get(), await q.get()];
    expect(items).toEqual([2, 3, 1]);
  });
});

describe("PriorityQueueTests", () => {
  test("test_order", async () => {
    const q = asyncio.PriorityQueue();
    for (const i of [1, 3, 2]) await q.put(i);

    const items = [await q.get(), await q.get(), await q.get()];
    expect(items).toEqual([1, 2, 3]);
  });
});

describe.each([
  ["QueueJoinTests", asyncio.Queue],
  ["LifoQueueJoinTests", asyncio.LifoQueue],
  ["PriorityQueueJoinTests", asyncio.PriorityQueue],
])("%s", (_, q_class) => {
  test("test_task_done_underflow", () => {
    const q = q_class();
    expect(q.task_done).toThrow(ValueError);
  });

  test("test_task_done", async () => {
    const q = q_class();
    // there: 100
    for (let i = 0; i < 30; i++) q.put_nowait(i);

    let accumulator = 0;

    // Two workers get items from the queue and call task_done after each.
    // Join the queue and assert all items have been processed.
    let running = true;

    async function worker() {
      while (running) {
        const item = await q.get();
        accumulator += item;
        q.task_done();
      }
    }

    await asyncWith(asyncio.TaskGroup(), async tg => {
      const tasks = [tg.create_task(worker()), tg.create_task(worker())];

      await q.join();
      expect(accumulator).toBe(sum(range(30)));

      // close running generators
      running = false;
      for (const _ of tasks) q.put_nowait(0);
    });
  });

  test("test_join_empty_queue", async () => {
    const q = q_class();

    // Test that a queue join()s successfully, and before anything else
    // (done twice for insurance).

    await q.join();
    await q.join();
  });

  test("test_format", () => {
    const q = q_class();
    expect(q._format()).toBe("maxsize=0");

    q._unfinished_tasks = 2;
    expect(q._format()).toBe("maxsize=0 tasks=2");
  });
});

// The body of each `async with` is a function that returns what it would await there.
describe("TimeoutTests", () => {
  test("test_timeout_basic", async () => {
    const cm = asyncio.timeout(0.01);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(10)));
    expect(cm.expired()).toBe(true);
  });

  test("test_timeout_at_basic", async () => {
    const loop = asyncio.get_running_loop();

    const deadline = loop.time() + 0.01;
    const cm = asyncio.timeout_at(deadline);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(10)));
    expect(cm.expired()).toBe(true);
    expect(cm.when()).toBe(deadline);
  });

  test("test_timeout_not_called", async () => {
    const loop = asyncio.get_running_loop();
    const cm = asyncio.timeout(10);
    await asyncWith(cm, () => asyncio.sleep(0.01));
    const t1 = loop.time();

    expect(cm.expired()).toBe(false);
    expect(cm.when()).toBeGreaterThan(t1);
  });

  test("test_timeout_disabled", async () => {
    const cm = asyncio.timeout(undefined);
    await asyncWith(cm, () => asyncio.sleep(0.01));

    expect(cm.expired()).toBe(false);
    expect(cm.when()).toBeUndefined();
  });

  test("test_timeout_at_disabled", async () => {
    const cm = asyncio.timeout_at(undefined);
    await asyncWith(cm, () => asyncio.sleep(0.01));

    expect(cm.expired()).toBe(false);
    expect(cm.when()).toBeUndefined();
  });

  test("test_timeout_zero", async () => {
    const loop = asyncio.get_running_loop();
    const t0 = loop.time();
    const cm = asyncio.timeout(0);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(10)));
    const t1 = loop.time();
    expect(cm.expired()).toBe(true);
    expect(t0 <= cm.when() && cm.when() <= t1).toBe(true);
  });

  test("test_timeout_zero_sleep_zero", async () => {
    const loop = asyncio.get_running_loop();
    const t0 = loop.time();
    const cm = asyncio.timeout(0);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(0)));
    const t1 = loop.time();
    expect(cm.expired()).toBe(true);
    expect(t0 <= cm.when() && cm.when() <= t1).toBe(true);
  });

  test("test_timeout_in_the_past_sleep_zero", async () => {
    const loop = asyncio.get_running_loop();
    const t0 = loop.time();
    const cm = asyncio.timeout(-11);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(0)));
    const t1 = loop.time();
    expect(cm.expired()).toBe(true);
    expect(t0 >= cm.when() && cm.when() <= t1).toBe(true);
  });

  test("test_foreign_exception_passed", async () => {
    // there: 0.01
    const cm = asyncio.timeout(10);
    await raisesAsync(KeyError, () =>
      asyncWith(cm, async () => {
        throw new KeyError();
      }),
    );
    expect(cm.expired()).toBe(false);
  });

  test("test_outer_task_is_not_cancelled", async () => {
    async function outer() {
      await raisesAsync(TimeoutError, () => asyncWith(asyncio.timeout(0.001), () => asyncio.sleep(10)));
    }

    const task = asyncio.create_task(outer());
    await task;
    expect(task.cancelled()).toBe(false);
    expect(task.done()).toBe(true);
  });

  test("test_repr_active", async () => {
    await asyncWith(asyncio.timeout(10), async cm => {
      expect(repr(cm)).toMatch(/<Timeout \[active\] when=\d+\.\d*>/);
    });
  });

  test("test_repr_expired", async () => {
    const cm = asyncio.timeout(0.01);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(10)));
    expect(repr(cm)).toBe("<Timeout [expired]>");
  });

  test("test_repr_finished", async () => {
    const cm = asyncio.timeout(10);
    await asyncWith(cm, () => asyncio.sleep(0));

    expect(repr(cm)).toBe("<Timeout [finished]>");
  });

  test("test_repr_disabled", async () => {
    await asyncWith(asyncio.timeout(undefined), async cm => {
      expect(repr(cm)).toBe("<Timeout [active] when=None>");
    });
  });

  test("test_timeout_already_entered", async () => {
    // there: 0.01
    await asyncWith(asyncio.timeout(10), async cm => {
      await raisesAsync(RuntimeError, () => asyncWith(cm, async () => {}), /has already been entered/);
    });
  });

  test("test_timeout_double_enter", async () => {
    // there: 0.01
    const cm = asyncio.timeout(10);
    await asyncWith(cm, async () => {});
    await raisesAsync(RuntimeError, () => asyncWith(cm, async () => {}), /has already been entered/);
  });

  test("test_timeout_finished", async () => {
    // there: 0.01
    const cm = asyncio.timeout(10);
    await asyncWith(cm, async () => {});
    raises(RuntimeError, () => cm.reschedule(0.02), /finished/);
  });

  test("test_timeout_expired", async () => {
    const cm = asyncio.timeout(0.01);
    await raisesAsync(TimeoutError, () => asyncWith(cm, () => asyncio.sleep(1)));
    raises(RuntimeError, () => cm.reschedule(0.02), /expired/);
  });

  test("test_timeout_not_entered", () => {
    const cm = asyncio.timeout(0.01);
    raises(RuntimeError, () => cm.reschedule(0.02), /has not been entered/);
  });
});

describe("between the languages", () => {
  test("the loop that Bun runs is the running loop for what JavaScript calls", async () => {
    const loop = asyncio.get_running_loop();
    expect(asyncio.get_event_loop()).toBe(loop);
    expect(await (async () => asyncio.get_running_loop())()).toBe(loop);
    expect(asyncio.Future().get_loop()).toBe(loop);
  });

  test("gather() takes coroutines, promises and futures", async () => {
    const future = asyncio.Future();
    queueMicrotask(() => future.set_result("d"));
    expect(await asyncio.gather(asyncio.sleep(0, "a"), Promise.resolve("b"), (async () => "c")(), future)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(await Promise.all([asyncio.sleep(0, "a"), Promise.resolve("b"), future])).toEqual(["a", "b", "d"]);
  });

  test("gather(return_exceptions=True)", async () => {
    const thrown = new RangeError("of JavaScript");
    const [a, b, c] = await asyncio.gather(
      asyncio.sleep(0, 1),
      Promise.reject(thrown),
      asyncio.wait_for(asyncio.Event().wait(), 0),
      kwargs({ return_exceptions: true }),
    );
    expect(a).toBe(1);
    // What JavaScript throws is a JSError while it is in Python. Raised, it comes out as what was thrown. As a value it does not.
    expect(b).toBeInstanceOf(JSError);
    expect(b.value).toBe(thrown);
    expect(c).toBeInstanceOf(TimeoutError);
  });

  test("a task for a coroutine that JavaScript has called cancels it", async () => {
    const event = asyncio.Event();
    const task = asyncio.create_task(event.wait());
    await until(() => len(event._waiters) == 1);
    task.cancel();
    await raisesAsync(CancelledError, () => task);
    expect(task.cancelled()).toBe(true);
    expect(len(event._waiters)).toBe(0);
  });

  test("wait_for() gives up on a promise", async () => {
    const { promise, resolve } = Promise.withResolvers();
    await raisesAsync(TimeoutError, () => asyncio.wait_for(promise, 0.001));
    resolve(1);
    expect(await asyncio.wait_for(promise, 10)).toBe(1);
  });

  test("cancelling stops at JavaScript", async () => {
    // TimeoutTests.test_waiter_cancelled: there the body sees the CancelledError. An async function of JavaScript cannot be
    // cancelled: the `async with` stops waiting for it, and it goes on.
    let cancelled = false;
    const event = asyncio.Event();
    const { promise: ended, resolve } = Promise.withResolvers<void>();
    await raisesAsync(TimeoutError, () =>
      asyncWith(asyncio.timeout(0.01), async () => {
        try {
          await event.wait();
        } catch (error) {
          cancelled = true;
          throw error;
        } finally {
          resolve();
        }
      }),
    );
    expect(cancelled).toBe(false);
    expect(len(event._waiters)).toBe(1);
    event.set();
    await ended;
    expect(cancelled).toBe(false);
  });

  test("there is no current task behind an await of JavaScript", async () => {
    expect(asyncio.current_task()).toBeUndefined();
    await asyncWith(asyncio.timeout(10), async () => {
      const task = asyncio.current_task();
      expect(task).toBeInstanceOf(asyncio.Task);
      await asyncio.sleep(0);
      expect(asyncio.current_task()).toBeUndefined();
    });
  });

  test("create_task() takes the promise that JavaScript has of a coroutine", async () => {
    const sleeping = asyncio.sleep(0, "slept");
    expect(sleeping).toBeInstanceOf(Promise);
    const task = asyncio.create_task(sleeping);
    expect(task).toBeInstanceOf(asyncio.Task);
    expect(await task).toBe("slept");
    // A promise is to asyncio what the coroutine is in Python.
    expect(asyncio.iscoroutine(sleeping)).toBe(true);
    expect(asyncio.ensure_future(sleeping)).toBeInstanceOf(asyncio.Task);
    await raisesAsync(PyTypeError, () => asyncio.wait([sleeping]), /Passing coroutines is forbidden/);
    raises(PyTypeError, () => asyncio.create_task(5), /a coroutine was expected/);
  });

  test("callbacks of the loop are functions of JavaScript", async () => {
    const loop = asyncio.get_running_loop();
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    loop.call_later(0.002, () => {
      order.push("later");
      resolve();
    });
    loop.call_soon((word: string) => order.push(word), "soon");
    await promise;
    expect(order).toEqual(["soon", "later"]);
  });

  test("an async generator of either language in the other", async () => {
    async function* count() {
      yield 1;
      yield 2;
    }
    const q = asyncio.Queue();
    for await (const item of count()) await q.put(item);
    expect([q.get_nowait(), q.get_nowait()]).toEqual([1, 2]);
  });
});
