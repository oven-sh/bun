import { AsyncLocalStorage, AsyncResource } from "async_hooks";
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

  test("asyncResource is an EventEmitterReferencingAsyncResource with an eventEmitter back-reference", () => {
    const ee = new EventEmitterAsyncResource({ name: "X" });
    expect(ee.asyncResource).toBeInstanceOf(AsyncResource);
    expect(ee.asyncResource.constructor.name).toBe("EventEmitterReferencingAsyncResource");
    expect("eventEmitter" in ee.asyncResource).toBe(true);
    expect(ee.asyncResource.eventEmitter).toBe(ee);
  });

  test("prototype has asyncId/triggerAsyncId/asyncResource getters", () => {
    const names = Object.getOwnPropertyNames(EventEmitterAsyncResource.prototype).sort();
    expect(names).toEqual(["asyncId", "asyncResource", "constructor", "emit", "emitDestroy", "triggerAsyncId"]);

    for (const key of ["asyncId", "triggerAsyncId", "asyncResource"]) {
      const desc = Object.getOwnPropertyDescriptor(EventEmitterAsyncResource.prototype, key)!;
      expect({
        key,
        get: typeof desc.get,
        set: desc.set,
        enumerable: desc.enumerable,
        configurable: desc.configurable,
      }).toEqual({
        key,
        get: "function",
        set: undefined,
        enumerable: false,
        configurable: true,
      });
    }

    const ee = new EventEmitterAsyncResource({ name: "X" });
    expect(typeof ee.asyncId).toBe("number");
    expect(typeof ee.triggerAsyncId).toBe("number");
    expect(ee.asyncResource).toBeInstanceOf(AsyncResource);
  });

  test("requires options.name when instantiated directly", () => {
    expect(() => new EventEmitterAsyncResource()).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('"options.name"'),
      }),
    );
    expect(() => new EventEmitterAsyncResource({})).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => new EventEmitterAsyncResource({ name: 42 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("subclasses may omit options.name and default to the constructor name", () => {
    class Foo extends EventEmitterAsyncResource {}
    const foo = new Foo();
    expect(foo.asyncResource.eventEmitter).toBe(foo);
    expect(foo.asyncResource.type).toBe("Foo");

    class Bar extends EventEmitterAsyncResource {}
    const bar = new Bar({ name: "Override" });
    expect(bar.asyncResource.type).toBe("Override");
  });

  test("accepts a string as the resource name", () => {
    const ee = new EventEmitterAsyncResource("MyName");
    expect(ee.asyncResource.type).toBe("MyName");
    expect(ee.asyncResource.eventEmitter).toBe(ee);
  });

  test("emit returns a boolean", () => {
    const ee = new EventEmitterAsyncResource({ name: "X" });
    ee.on("foo", () => {});
    expect(ee.emit("foo")).toBe(true);
    expect(ee.emit("bar")).toBe(false);
  });

  test("getters and methods throw TypeError on invalid receiver", () => {
    const proto = EventEmitterAsyncResource.prototype;
    for (const key of ["asyncId", "triggerAsyncId", "asyncResource"]) {
      expect(() => Reflect.get(proto, key, {})).toThrow(TypeError);
    }
    expect(() => proto.emit.call({}, "x")).toThrow(TypeError);
    expect(() => proto.emitDestroy.call({})).toThrow(TypeError);

    const ee = new EventEmitterAsyncResource({ name: "X" });
    const resourceProto = Object.getPrototypeOf(ee.asyncResource);
    expect(() => Reflect.get(resourceProto, "eventEmitter", {})).toThrow(TypeError);
  });
});
