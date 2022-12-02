import { test, describe, expect, it } from "bun:test";
import fs from "node:fs";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, {
  getEventListeners,
  captureRejectionSymbol,
} from "node:events";

describe("EventEmitter", () => {
  it("captureRejectionSymbol", () => {
    expect(EventEmitter.captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBeDefined();
  });
  test("getEventListeners", () => {
    expect(getEventListeners(new EventEmitter(), "hey").length).toBe(0);
  });
  test("EventEmitter constructor", () => {
    var emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    expect(emitter.getMaxListeners()).toBe(100);
  });

  // These are also tests for the done() function in the test runner.
  test("EventEmitter emit (different tick)", (done) => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    queueMicrotask(() => {
      emitter.emit("wow");
    });
  });

  // Unlike Jest, bun supports async and done
  test("async EventEmitter emit (microtask)", async (done) => {
    await 1;
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    emitter.emit("wow");
  });

  test("async EventEmitter emit (microtask) after", async (done) => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    await 1;
    emitter.emit("wow");
  });

  test("EventEmitter emit (same tick)", (done) => {
    var emitter = new EventEmitter();

    emitter.on("wow", () => done());

    emitter.emit("wow");
  });

  test("EventEmitter emit (setTimeout task)", (done) => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    setTimeout(() => emitter.emit("wow"), 1);
  });
});
