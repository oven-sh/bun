import { describe, it, expect } from "bun:test";

import { EventEmitter } from "events";
var emitters = [EventEmitter, require("events")];
describe("EventEmitter", () => {
  it("should emit events", () => {
    for (let Emitter of emitters) {
      const emitter = new Emitter();
      var called = false;
      const listener = () => {
        called = true;
      };
      emitter.on("test", listener);
      emitter.emit("test");
      expect(called).toBe(true);
    }
  });
});
