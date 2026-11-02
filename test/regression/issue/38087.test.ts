import { expect, test } from "bun:test";

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

test("custom inspect on web platform prototypes is writable like in Node", () => {
  for (const Class of [
    URL,
    URLSearchParams,
    ReadableStream,
    WritableStream,
    TransformStream,
    ReadableStreamDefaultReader,
    WritableStreamDefaultWriter,
    BroadcastChannel,
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, inspectSymbol);
    expect(descriptor, Class.name).toMatchObject({
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
});

test("assigning an instance-level custom inspect to a URL succeeds in strict mode", () => {
  // SvelteKit's make_trackable does exactly this during SSR (issue #38087).
  const url = new URL("https://example.com/");
  const custom = () => "custom";
  url[inspectSymbol] = custom;
  expect(Object.getOwnPropertyDescriptor(url, inspectSymbol)).toEqual({
    value: custom,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  expect(Bun.inspect(url)).toBe("custom");
});
