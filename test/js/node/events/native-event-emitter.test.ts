import { describe, test, expect } from "bun:test";
import stream from "stream";

describe("Native EventEmitter", () => {
  test("newListener fires before the listener is actually added", () => {
    const emitter = new stream.Stream(); // stream extends native EventEmitters
    let called = false;
    emitter.on("newListener", (event: any, listener: any) => {
      expect(event).toBe("foo");
      expect(emitter.listeners("foo")).toEqual([]);
      expect(emitter.listenerCount("foo")).toEqual(0);
      called = true;
    });
    emitter.on("foo", () => {});
    expect(called).toBe(true);
  });
});
