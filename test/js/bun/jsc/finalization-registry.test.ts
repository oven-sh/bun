// Test for FinalizationRegistry and DeferredWorkTimer integration
// This test verifies that FinalizationRegistry callbacks execute correctly
// after the JSCScheduler fix that drains microtasks after deferred work tasks.

import { describe, expect, test } from "bun:test";

describe("FinalizationRegistry", () => {
  test("callback executes after GC", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const registry = new FinalizationRegistry(() => {
      resolve();
    });

    // Create object in a scope so it can be GC'd
    {
      let obj = {};
      registry.register(obj, null);
    }

    // Trigger GC
    await globalThis.gc({ type: "major", execution: "async" });
    await globalThis.gc({ type: "major", execution: "async" });

    // The callback should execute, resolving the promise
    await promise;
  });

  test("callback executes with setImmediate", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const registry = new FinalizationRegistry(() => {
      resolve();
    });

    {
      let obj = {};
      registry.register(obj, null);
    }

    // Trigger GC first, then wait for callback via setImmediate
    await globalThis.gc({ type: "major", execution: "async" });
    await globalThis.gc({ type: "major", execution: "async" });

    // Give FinalizationRegistry time to process via setImmediate
    await new Promise<void>(resolve => setImmediate(resolve));
    await promise;
  });

  test("multiple callbacks execute", async () => {
    let count = 0;
    const { promise, resolve } = Promise.withResolvers<void>();

    const registry = new FinalizationRegistry(() => {
      count++;
      if (count === 3) {
        resolve();
      }
    });

    // Create multiple objects in separate scopes to ensure they can be GC'd
    {
      let obj1 = {};
      registry.register(obj1, null);
    }
    {
      let obj2 = {};
      registry.register(obj2, null);
    }
    {
      let obj3 = {};
      registry.register(obj3, null);
    }

    await globalThis.gc({ type: "major", execution: "async" });
    await globalThis.gc({ type: "major", execution: "async" });

    // Give some time for all callbacks to execute
    await new Promise<void>(resolve => setImmediate(resolve));

    await promise;
    expect(count).toBe(3);
  });

  test("callback receives correct held value", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const registry = new FinalizationRegistry((heldValue: string) => {
      resolve(heldValue);
    });

    {
      let obj = {};
      registry.register(obj, "test-value");
    }

    await globalThis.gc({ type: "major", execution: "async" });
    await globalThis.gc({ type: "major", execution: "async" });

    const result = await promise;
    expect(result).toBe("test-value");
  });

  test("unregister prevents callback", async () => {
    let called = false;
    const registry = new FinalizationRegistry(() => {
      called = true;
    });

    const token = {};
    {
      let obj = {};
      registry.register(obj, null, token);
    }

    // Unregister before GC
    registry.unregister(token);

    await globalThis.gc({ type: "major", execution: "async" });
    await globalThis.gc({ type: "major", execution: "async" });

    // Wait a bit to ensure callback doesn't execute
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(called).toBe(false);
  });

  test("callback executes with Promise microtask", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const registry = new FinalizationRegistry(() => {
      resolve();
    });

    {
      let obj = {};
      registry.register(obj, null);
    }

    // Queue a microtask that triggers GC
    await Promise.resolve().then(async () => {
      await globalThis.gc({ type: "major", execution: "async" });
      await globalThis.gc({ type: "major", execution: "async" });
    });

    await promise;
  });
});
