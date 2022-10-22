import { test, describe, expect } from "bun:test";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, { getEventListeners } from "node:events";

describe("EventEmitter", () => {
  test("getEventListeners", () => {
    expect(getEventListeners(new EventEmitter(), "hey").length).toBe(0);
  });
  test("EventEmitter constructor", () => {
    var emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    expect(emitter.getMaxListeners()).toBe(100);
  });
});
