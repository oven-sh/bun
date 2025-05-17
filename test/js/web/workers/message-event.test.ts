import { describe, expect, test } from "bun:test";

describe("MessageEvent constructor", () => {
  test("returns an Event instance", () => {
    expect(new MessageEvent("message")).toBeInstanceOf(Event);
  });

  test("has the right defaults", () => {
    const expected = {
      type: "custom type",
      data: null,
      origin: "",
      lastEventId: "",
      source: null,
      ports: [],
    };
    expect(new MessageEvent("custom type")).toMatchObject(expected);
    expect(new MessageEvent("custom type", undefined)).toMatchObject(expected);
    expect(new MessageEvent("custom type", {})).toMatchObject(expected);
    // @ts-expect-error
    expect(new MessageEvent("custom type", null)).toMatchObject(expected);
  });

  test("includes all options in the returned object", () => {
    const { port1 } = new MessageChannel();
    expect(
      new MessageEvent("custom type", {
        data: 123,
        origin: "origin",
        lastEventId: "id",
        source: port1,
        ports: [port1],
      }),
    ).toMatchObject({
      type: "custom type",
      data: 123,
      origin: "origin",
      lastEventId: "id",
      source: port1,
      ports: [port1],
    });
  });

  test("coerces the type to a string", () => {
    // @ts-expect-error
    expect(new MessageEvent(5)).toMatchObject({ type: "5" });
    // @ts-expect-error
    expect(new MessageEvent(undefined)).toMatchObject({ type: "undefined" });
  });

  test("throws if you pass no arguments", () => {
    // @ts-expect-error
    expect(() => new MessageEvent()).toThrow({
      name: "TypeError",
      message: "Not enough arguments",
    });
  });

  test("throws if options is not an object", () => {
    // @ts-expect-error
    expect(() => new MessageEvent("message", 5)).toThrow(TypeError);
  });

  test("coerces options.origin to a string", () => {
    // @ts-expect-error
    expect(new MessageEvent("message", { origin: 123 })).toMatchObject({ origin: "123" });
  });

  test("coerces options.lastEventId to a string", () => {
    // @ts-expect-error
    expect(new MessageEvent("message", { lastEventId: 123 })).toMatchObject({ lastEventId: "123" });
  });

  test("throws if options.source is the wrong type", () => {
    // @ts-expect-error
    expect(() => new MessageEvent("message", { source: 1 })).toThrow({
      name: "TypeError",
      message: 'The "eventInitDict.source" property must be of type MessagePort. Received type number (1)',
    });
    // @ts-expect-error
    expect(() => new MessageEvent("message", { source: {} })).toThrow({
      name: "TypeError",
      message: 'The "eventInitDict.source" property must be of type MessagePort. Received an instance of Object',
    });
  });

  test("throws if options.ports is the wrong type", () => {
    // @ts-expect-error
    expect(() => new MessageEvent("message", { ports: 1 })).toThrow({
      name: "TypeError",
      message: "MessageEvent constructor: eventInitDict.ports is not iterable.",
    });
    // @ts-expect-error
    expect(() => new MessageEvent("message", { ports: [1] })).toThrow({
      name: "TypeError",
      message: "MessageEvent constructor: Expected every item of eventInitDict.ports to be an instance of MessagePort.",
    });
    // @ts-expect-error
    expect(() => new MessageEvent("message", { ports: [{}] })).toThrow({
      name: "TypeError",
      message: "MessageEvent constructor: Expected every item of eventInitDict.ports to be an instance of MessagePort.",
    });
  });
});
