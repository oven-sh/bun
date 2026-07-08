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
      expect(ee.emit("test")).toBe(true);
    });

    expect(val).toBe(123);
    expect(ee.emit("nobody-listening")).toBe(false);
  });

  test("captureRejections", async () => {
    let ee;
    const asl = new AsyncLocalStorage();
    asl.run(123, () => {
      ee = new EventEmitterAsyncResource({ name: "test", captureRejections: true });
    });

    let listenerStore;
    ee.on("test", async () => {
      listenerStore = asl.getStore();
      throw new Error("boom");
    });

    const { promise, resolve } = Promise.withResolvers();
    let rejectionStore;
    ee[Symbol.for("nodejs.rejection")] = (err, event) => {
      rejectionStore = asl.getStore();
      resolve({ err, event });
    };

    asl.run(456, () => {
      expect(ee.emit("test")).toBe(true);
    });
    // Listener runs in the resource's async scope even with captureRejections on
    // (own-property emit stamped by the base constructor must not shadow it).
    expect(listenerStore).toBe(123);

    const { err, event } = await promise;
    expect(err.message).toBe("boom");
    expect(event).toBe("test");
    expect(rejectionStore).toBe(123);
  });
});
