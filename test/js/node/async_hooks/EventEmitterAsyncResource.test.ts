import EventEmitter, { EventEmitterAsyncResource } from "events";
import { AsyncLocalStorage } from "async_hooks";
import { describe, test, expect } from "bun:test";

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
});
