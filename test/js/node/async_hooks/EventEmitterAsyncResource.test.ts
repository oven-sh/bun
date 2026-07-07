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
  test("emit() returns a boolean like EventEmitter#emit", () => {
    const ee = new EventEmitterAsyncResource({ name: "R" });
    ee.on("e", () => {});
    ee.on("error", () => {});

    expect({
      withListener: ee.emit("e"),
      withoutListener: ee.emit("none"),
      errorWithListener: ee.emit("error", new Error("x")),
    }).toEqual({
      withListener: true,
      withoutListener: false,
      errorWithListener: true,
    });
  });
});
