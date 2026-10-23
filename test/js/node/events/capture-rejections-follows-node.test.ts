import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

test("an emitter with captureRejections has no `emit` of its own, so a subclass's `emit` is called", () => {
  const emitted: string[] = [];
  class Logged extends EventEmitter {
    emit(name: string | symbol, ...args: unknown[]) {
      emitted.push(String(name));
      return super.emit(name, ...args);
    }
  }
  const emitter = new Logged({ captureRejections: true });
  expect(Object.hasOwn(emitter, "emit")).toBe(false);
  emitter.on("x", () => {});
  emitter.emit("x");
  expect(emitted).toEqual(["x"]);
});

test("with captureRejections, a thenable that a listener returns is listened to", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const { promise, resolve } = Promise.withResolvers<Error>();
  emitter.on("error", resolve);
  emitter.on("x", () => ({
    then(_onFulfilled: unknown, onRejected: (reason: Error) => void) {
      onRejected(new Error("out of a thenable"));
    },
  }));
  emitter.emit("x");
  expect((await promise).message).toBe("out of a thenable");
});

test("with captureRejections, a rejection out of an 'error' listener is emitted as 'error' again", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const { promise, resolve } = Promise.withResolvers<Error>();
  let calls = 0;
  emitter.on("error", async error => {
    if (++calls === 1) throw new Error("second");
    resolve(error);
  });
  emitter.emit("error", new Error("first"));
  expect((await promise).message).toBe("second");
  expect(calls).toBe(2);
});
