import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { describe, expect, test } from "bun:test";
import EventEmitter, { EventEmitterAsyncResource } from "events";

describe("EventEmitterAsyncResource", () => {
  test("is an EventEmitter", () => {
    const ee = new EventEmitterAsyncResource("test");
    expect(ee).toBeInstanceOf(EventEmitterAsyncResource);
    expect(ee).toBeInstanceOf(EventEmitter);
  });
  // triggerAsyncId echoes the constructor option like Node; the default is the
  // current execution async id (1 at the top level, matching node).
  test("triggerAsyncId reflects the option", () => {
    expect(new EventEmitterAsyncResource({ name: "x", triggerAsyncId: 7 }).triggerAsyncId).toBe(7);
    expect(new EventEmitterAsyncResource({ name: "x" }).triggerAsyncId).toBe(1);
    expect(new AsyncResource("x", { triggerAsyncId: 7 }).triggerAsyncId()).toBe(7);
    expect(new AsyncResource("x", 7).triggerAsyncId()).toBe(7);
    expect(new AsyncResource("x").triggerAsyncId()).toBe(1);
    let err;
    try {
      new EventEmitterAsyncResource({ name: "x", triggerAsyncId: -2 });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ASYNC_ID");
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

  // Node routes EventEmitterAsyncResource.emit through super.emit, so a
  // userland monkeypatch of EventEmitter.prototype.emit is observed like it
  // is for plain EventEmitter instances.
  test("emit routes through EventEmitter.prototype.emit", () => {
    const original = EventEmitter.prototype.emit;
    let calls = 0;
    try {
      EventEmitter.prototype.emit = function (...args) {
        calls++;
        return original.apply(this, args);
      };
      const ee = new EventEmitterAsyncResource("test");
      let fired = false;
      ee.on("x", () => {
        fired = true;
      });
      ee.emit("x");
      expect(fired).toBe(true);
      expect(calls).toBe(1);
    } finally {
      EventEmitter.prototype.emit = original;
    }
  });
});
