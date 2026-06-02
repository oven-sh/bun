import { AsyncLocalStorage } from "async_hooks";
import { describe, expect, test } from "bun:test";
import EventEmitter, { EventEmitterAsyncResource } from "events";

describe("EventEmitterAsyncResource", () => {
  test("is an EventEmitter", () => {
    const ee = new EventEmitterAsyncResource("test");
    expect(ee).toBeInstanceOf(EventEmitterAsyncResource);
    expect(ee).toBeInstanceOf(EventEmitter);
  });
  test("has context tracking", () => {
    let ee;
    const asl = new AsyncLocalStorage();
    asl.run(123, () => {
      ee = new EventEmitterAsyncResource("test");
    });

    let val;
    ee.on("test", () => {
      val = asl.getStore();
    });

    asl.run(456, () => {
      ee.emit("test");
    });

    expect(val).toBe(123);
  });

  test("asyncId/triggerAsyncId delegate to the underlying AsyncResource", () => {
    const ee = new EventEmitterAsyncResource({ name: "test", triggerAsyncId: 9 });
    expect(ee.asyncId).toBe(ee.asyncResource.asyncId());
    expect(ee.triggerAsyncId).toBe(ee.asyncResource.triggerAsyncId());
    expect(ee.triggerAsyncId).toBe(9);
    expect(ee.asyncId).toBeGreaterThan(0);

    // Without an explicit triggerAsyncId it still matches the inner resource.
    const ee2 = new EventEmitterAsyncResource({ name: "test2" });
    expect(ee2.triggerAsyncId).toBe(ee2.asyncResource.triggerAsyncId());
  });
});
