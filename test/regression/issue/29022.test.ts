// https://github.com/oven-sh/bun/issues/29022
// https://github.com/oven-sh/bun/issues/20169
//
// MessagePort was missing Node's EventEmitter-style aliases and queries:
// removeListener, addListener, removeAllListeners, listenerCount, eventNames,
// setMaxListeners, getMaxListeners. It also ignored Node's dedup semantics,
// so `on(event, fn)` called multiple times with the same listener registered
// it multiple times (vs Node's "first registration wins").
import { expect, test } from "bun:test";
import { MessageChannel, MessagePort } from "node:worker_threads";

test("MessagePort exposes Node's EventEmitter surface", () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const present = [
      "on",
      "off",
      "once",
      "emit",
      "addListener",
      "removeListener",
      "removeAllListeners",
      "listenerCount",
      "eventNames",
      "setMaxListeners",
      "getMaxListeners",
    ] as const;

    for (const name of present) {
      expect(name in port1).toBe(true);
      expect(typeof (port1 as any)[name]).toBe("function");
      expect(name in MessagePort.prototype).toBe(true);
    }

    // Node's MessagePort does not expose these; don't add them on Bun either.
    for (const name of ["listeners", "rawListeners"] as const) {
      expect(name in port1).toBe(false);
    }
  } finally {
    port1.close();
    port2.close();
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
    expect(await promise).toBe("hello");

    port1.removeListener("message", handler);
    expect(port1.listenerCount("message")).toBe(0);
  } finally {
    port1.close();
    port2.close();
  }
});

test("listenerCount / eventNames track on/once/off", () => {
  const { port1, port2 } = new MessageChannel();
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

    port1.removeListener("message", b);
    expect(port1.listenerCount("message")).toBe(2);

    port1.removeListener("message", a);
    port1.removeListener("message", c);
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.eventNames()).toEqual([]);
  } finally {
    port1.close();
    port2.close();
  }
});

test("removeAllListeners with and without event name", () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const noop1 = () => {};
    const noop2 = () => {};
    port1.on("message", noop1);
    port1.on("message", noop2);
    port1.on("messageerror", noop1);

    expect(port1.listenerCount("message")).toBe(2);
    expect(port1.listenerCount("messageerror")).toBe(1);

    port1.removeAllListeners("message");
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.listenerCount("messageerror")).toBe(1);
    expect(port1.eventNames()).toEqual(["messageerror"]);

    port1.on("message", noop1);
    port1.removeAllListeners();
    expect(port1.listenerCount("message")).toBe(0);
    expect(port1.listenerCount("messageerror")).toBe(0);
    expect(port1.eventNames()).toEqual([]);
  } finally {
    port1.close();
    port2.close();
  }
});

test("getMaxListeners / setMaxListeners", () => {
  const { port1, port2 } = new MessageChannel();
  try {
    expect(typeof port1.getMaxListeners()).toBe("number");
    expect(port1.setMaxListeners(42)).toBe(port1);
    expect(port1.getMaxListeners()).toBe(42);

    // Matches EventEmitter.prototype.setMaxListeners validation.
    expect(() => port1.setMaxListeners(-1)).toThrow(/out of range|must be/i);
    expect(() => port1.setMaxListeners(NaN)).toThrow();
    // @ts-expect-error - intentional bad input
    expect(() => port1.setMaxListeners("10")).toThrow();
  } finally {
    port1.close();
    port2.close();
  }
});

test("removeListener / off without a listener throws ERR_INVALID_ARG_TYPE", () => {
  const { port1, port2 } = new MessageChannel();
  try {
    // @ts-expect-error - intentional missing argument
    expect(() => port1.removeListener("message")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    // @ts-expect-error - intentional missing argument
    expect(() => port1.off("message")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  } finally {
    port1.close();
    port2.close();
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

// https://github.com/oven-sh/bun/issues/20169
test("on() deduplicates same listener (matches Node's MessagePort)", async () => {
  const { port1, port2 } = new MessageChannel();
  try {
    let fired = 0;
    const onMessage = () => {
      fired++;
    };

    port1.on("message", onMessage);
    port1.on("message", onMessage);
    port1.on("message", onMessage);
    expect(port1.listenerCount("message")).toBe(1);

    port2.postMessage("hi");
    // Wait for the message to dispatch.
    while (fired === 0) await Bun.sleep(1);
    expect(fired).toBe(1);

    port1.off("message", onMessage);
    expect(port1.listenerCount("message")).toBe(0);

    // After off(), nothing should fire.
    port2.postMessage("hi again");
    await Bun.sleep(20);
    expect(fired).toBe(1);
  } finally {
    port1.close();
    port2.close();
  }
});

test("once() deduplicates with itself and with on()", () => {
  const { port1, port2 } = new MessageChannel();
  try {
    const fn = () => {};

    port1.once("message", fn);
    port1.once("message", fn);
    port1.once("message", fn);
    expect(port1.listenerCount("message")).toBe(1);

    // Adding an on() with the same listener is a no-op (first wins).
    port1.on("message", fn);
    expect(port1.listenerCount("message")).toBe(1);

    // Different listener adds a new slot.
    const fn2 = () => {};
    port1.on("message", fn2);
    expect(port1.listenerCount("message")).toBe(2);
  } finally {
    port1.close();
    port2.close();
  }
});
