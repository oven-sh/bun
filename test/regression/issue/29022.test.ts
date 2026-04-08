// https://github.com/oven-sh/bun/issues/29022
//
// MessagePort was missing Node's EventEmitter-style aliases and queries:
// removeListener, addListener, removeAllListeners, listenerCount, eventNames,
// listeners, rawListeners, setMaxListeners, getMaxListeners.
import { expect, test } from "bun:test";
import { MessageChannel, MessagePort } from "node:worker_threads";

test("MessagePort exposes Node's EventEmitter surface", () => {
  const { port1 } = new MessageChannel();
  try {
    const methods = [
      "on",
      "off",
      "once",
      "emit",
      "addListener",
      "removeListener",
      "removeAllListeners",
      "listenerCount",
      "eventNames",
      "listeners",
      "rawListeners",
      "setMaxListeners",
      "getMaxListeners",
    ] as const;

    for (const name of methods) {
      expect(name in port1).toBe(true);
      expect(typeof (port1 as any)[name]).toBe("function");
    }

    // And they're grafted onto the prototype, not the instance.
    for (const name of methods) {
      expect(name in MessagePort.prototype).toBe(true);
    }
  } finally {
    port1.close();
  }
});

test("addListener / removeListener are aliases for on / off", async () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const handler = (msg: unknown) => resolve(msg);
    port1.addListener("message", handler);
    expect(port1.listenerCount("message")).toBe(1);

    port2.postMessage("hello");
    const received = await promise;
    expect(received).toBe("hello");

    port1.removeListener("message", handler);
    expect(port1.listenerCount("message")).toBe(0);
  } finally {
    port1.close();
    port2.close();
  }
});

test("listenerCount / eventNames / listeners track on/once/off", () => {
  const { port1 } = new MessageChannel();
  try {
    const a = () => {};
    const b = () => {};
    const c = () => {};

    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.eventNames()).toEqual([]);

    port1.on("message", a);
    port1.on("message", b);
    port1.once("message", c);

    expect(port1.listenerCount("message")).toBe(3);
    expect(port1.eventNames()).toEqual(["message"]);
    expect(port1.listeners("message")).toEqual([a, b, c]);
    expect(port1.rawListeners("message")).toEqual([a, b, c]);

    // Node's removeListener removes the last matching instance (FILO).
    port1.on("message", a);
    expect(port1.listenerCount("message")).toBe(4);
    port1.removeListener("message", a);
    expect(port1.listeners("message")).toEqual([a, b, c]);

    port1.removeListener("message", a);
    expect(port1.listeners("message")).toEqual([b, c]);
  } finally {
    port1.close();
  }
});

test("removeAllListeners with and without event name", () => {
  const { port1 } = new MessageChannel();
  try {
    const noop = () => {};
    port1.on("message", noop);
    port1.on("message", noop);
    port1.on("messageerror", noop);

    expect(port1.listenerCount("message")).toBe(2);
    expect(port1.listenerCount("messageerror")).toBe(1);

    port1.removeAllListeners("message");
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.listenerCount("messageerror")).toBe(1);
    expect(port1.eventNames()).toEqual(["messageerror"]);

    port1.on("message", noop);
    port1.removeAllListeners();
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.listenerCount("messageerror")).toBe(0);
    expect(port1.eventNames()).toEqual([]);
  } finally {
    port1.close();
  }
});

test("getMaxListeners / setMaxListeners", () => {
  const { port1 } = new MessageChannel();
  try {
    expect(typeof port1.getMaxListeners()).toBe("number");
    expect(port1.setMaxListeners(42)).toBe(port1);
    expect(port1.getMaxListeners()).toBe(42);
  } finally {
    port1.close();
  }
});

test("once cleans up tracking after it fires", async () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    port1.once("message", msg => resolve(msg));
    expect(port1.listenerCount("message")).toBe(1);

    port2.postMessage("one");
    expect(await promise).toBe("one");

    // Listener count must decrement after once fires.
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.eventNames()).toEqual([]);
  } finally {
    port1.close();
    port2.close();
  }
});
