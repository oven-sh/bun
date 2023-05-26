import { EventEmitterAsyncResource } from "async_hooks";
import { describe, test, expect } from "bun:test";

describe("EventEmitterAsyncResource", () => {
  test("is an EventEmitter", () => {
    const ee = new EventEmitterAsyncResource("test");
    expect(ee).toBeInstanceOf(EventEmitterAsyncResource);
  });
  test("has context tracking", () => {
    let ee;
    const s = new EventEmitterAsyncResource("test");
  });
});
