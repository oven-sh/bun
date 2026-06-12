import { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId } from "async_hooks";
import { describe, expect, test } from "bun:test";
import EventEmitter, { EventEmitterAsyncResource } from "events";
import "harness";

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

  // https://github.com/oven-sh/bun/issues/32168
  test("executionAsyncId() inside a handler matches asyncId", async () => {
    const ee = new EventEmitterAsyncResource({ name: "Q" });
    const outerExecutionAsyncId = executionAsyncId();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ee.on("foo", () => {
      try {
        expect(executionAsyncId()).toBe(ee.asyncId);
        expect(triggerAsyncId()).toBe(ee.triggerAsyncId);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    await Promise.resolve().then(() => {
      expect(ee.emit("foo")).toBe(true);
    });
    await promise;
    expect(executionAsyncId()).toBe(outerExecutionAsyncId);
  });

  test("asyncId is a unique number delegating to the async resource", () => {
    const a = new EventEmitterAsyncResource({ name: "A" });
    const b = new EventEmitterAsyncResource({ name: "B" });
    expect(typeof a.asyncId).toBe("number");
    expect(a.asyncId).toBeGreaterThan(0);
    expect(b.asyncId).not.toBe(a.asyncId);
    expect(a.asyncId).toBe(a.asyncResource.asyncId());
    expect(a.triggerAsyncId).toBe(a.asyncResource.triggerAsyncId());
  });

  test("asyncResource is an EventEmitterReferencingAsyncResource", () => {
    const ee = new EventEmitterAsyncResource({ name: "Q" });
    expect(ee.asyncResource).toBeInstanceOf(AsyncResource);
    expect(ee.asyncResource.constructor.name).toBe("EventEmitterReferencingAsyncResource");
    expect(ee.asyncResource.eventEmitter).toBe(ee);
  });

  test("asyncId, triggerAsyncId, asyncResource are prototype getters", () => {
    const ee = new EventEmitterAsyncResource({ name: "Q" });
    for (const key of ["asyncId", "triggerAsyncId", "asyncResource", "emit"]) {
      expect(Object.hasOwn(ee, key)).toBe(false);
    }
    for (const key of ["asyncId", "triggerAsyncId", "asyncResource"]) {
      const desc = Object.getOwnPropertyDescriptor(EventEmitterAsyncResource.prototype, key)!;
      expect(typeof desc.get).toBe("function");
    }
    expect(() => Reflect.get(EventEmitterAsyncResource.prototype, "asyncId")).toThrow(TypeError);
  });

  test("triggerAsyncId defaults to the executionAsyncId at construction", () => {
    const outer = new AsyncResource("outer");
    let ee;
    const ret = outer.runInAsyncScope(() => {
      ee = new EventEmitterAsyncResource({ name: "Q" });
      return "ran";
    });
    expect(ret).toBe("ran");
    expect(ee.triggerAsyncId).toBe(outer.asyncId());
    expect(ee.triggerAsyncId).toBeGreaterThan(1);
    expect(new EventEmitterAsyncResource({ name: "Q", triggerAsyncId: 7 }).triggerAsyncId).toBe(7);
  });

  test("emit returns the boolean from EventEmitter#emit", () => {
    const ee = new EventEmitterAsyncResource({ name: "Q" });
    expect(ee.emit("nobody-listening")).toBe(false);
    ee.on("x", () => {});
    expect(ee.emit("x")).toBe(true);
  });

  test("options.name is required when constructed directly", () => {
    expect(() => new EventEmitterAsyncResource()).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(() => new EventEmitterAsyncResource({})).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(() => new EventEmitterAsyncResource({ name: 5 })).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
  });

  test("name can be passed as a string, and subclasses default to the class name", () => {
    const ee = new EventEmitterAsyncResource("StrName");
    expect(typeof ee.asyncId).toBe("number");

    class Sub extends EventEmitterAsyncResource {}
    const sub = new Sub();
    expect(typeof sub.asyncId).toBe("number");
    expect(sub.asyncResource.eventEmitter).toBe(sub);
  });

  test("captureRejections preserves context tracking and still captures", async () => {
    const asl = new AsyncLocalStorage();
    let ee;
    asl.run(123, () => {
      ee = new EventEmitterAsyncResource({ name: "Q", captureRejections: true });
    });
    expect(Object.hasOwn(ee, "emit")).toBe(false);

    const { promise, resolve } = Promise.withResolvers();
    let store = "unset";
    let handlerExecutionAsyncId;
    ee.on("error", resolve);
    ee.on("test", async () => {
      store = asl.getStore();
      handlerExecutionAsyncId = executionAsyncId();
      throw new Error("rejected!");
    });
    asl.run(456, () => {
      ee.emit("test");
    });
    expect(store).toBe(123);
    expect(handlerExecutionAsyncId).toBe(ee.asyncId);
    const err = await promise;
    expect(err.message).toBe("rejected!");
  });
});
