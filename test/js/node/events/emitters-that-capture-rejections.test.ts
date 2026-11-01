import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

const turnOfTheEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

test("an emitter with captureRejections has an `emit` of its own, and `emitter.emit()` calls that one", () => {
  const emitted: string[] = [];
  class Logged extends EventEmitter {
    emit(name: string | symbol, ...args: unknown[]) {
      emitted.push(String(name));
      return super.emit(name, ...args);
    }
  }

  const emitter = new Logged({ captureRejections: true });
  expect(Object.hasOwn(emitter, "emit")).toBe(true);
  expect(Object.keys(emitter)).toEqual(["_events", "_eventsCount", "_maxListeners", "emit"]);
  expect(emitter.emit.name).toBe("emit");
  expect(emitter.emit).not.toBe(Logged.prototype.emit);
  expect(emitter.emit).not.toBe(EventEmitter.prototype.emit);
  expect(emitter.emit).toBe(new EventEmitter({ captureRejections: true }).emit);
  const heard: unknown[] = [];
  emitter.on("x", value => heard.push(value));
  expect(emitter.emit("x", 1)).toBe(true);
  expect(heard).toEqual([1]);
  expect(emitted).toEqual([]);

  for (const options of [undefined, { captureRejections: false }]) {
    emitted.length = 0;
    const other = new Logged(options);
    expect(Object.hasOwn(other, "emit")).toBe(false);
    expect(other.emit).toBe(Logged.prototype.emit);
    other.on("x", () => {});
    expect(other.emit("x")).toBe(true);
    expect(emitted).toEqual(["x"]);
  }
});

test("with captureRejections, a promise that a listener returns is listened to, and no other object with a `then`", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const errors: string[] = [];
  emitter.on("error", error => errors.push(error.message));

  let reads = 0;
  emitter.on("thenable", () => ({
    get then() {
      reads++;
      return (_onFulfilled: unknown, onRejected: (reason: Error) => void) => onRejected(new Error("out of a thenable"));
    },
  }));
  expect(emitter.emit("thenable")).toBe(true);
  await turnOfTheEventLoop();
  expect(reads).toBe(0);
  expect(errors).toEqual([]);

  emitter.on("promise", () => Promise.reject(new Error("out of a promise")));
  expect(emitter.emit("promise")).toBe(true);
  expect(errors).toEqual([]);
  await turnOfTheEventLoop();
  expect(errors).toEqual(["out of a promise"]);
});

test("with captureRejections, a promise that an 'error' listener returns is not listened to", async () => {
  const emitter = new EventEmitter({ captureRejections: true });
  const seen: string[] = [];
  const returned: Promise<never>[] = [];
  emitter.on("error", error => {
    seen.push(error.message);
    const promise = Promise.reject(new Error("second"));
    returned.push(promise);
    return promise;
  });
  expect(emitter.emit("error", new Error("first"))).toBe(true);
  expect(returned).toHaveLength(1);
  await expect(returned[0]).rejects.toThrow("second");
  await turnOfTheEventLoop();
  expect(seen).toEqual(["first"]);
  expect(returned).toHaveLength(1);
});
