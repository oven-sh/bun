import { JSCallback, viewSource } from "bun:ffi";
import { describe, expect, test } from "bun:test";

// Captures what a call throws, or undefined if it returned normally. Written
// explicitly so the assertions below distinguish a thrown Error from a
// returned one regardless of toThrow()'s handling of returned Errors.
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("FFI viewSource", () => {
  // Descriptor values must be objects like { args: [...], returns: "void" }.
  // https://github.com/oven-sh/bun/pull/28361, https://github.com/oven-sh/bun/pull/34396
  test.each([42, "not_an_object", true])("throws on non-object symbol descriptor value %p", value => {
    const err = thrown(() => viewSource({ myFunc: value as any }));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("Expected an object");
  });

  test("throws on an unknown FFI type", () => {
    const err = thrown(() => viewSource({ foo: { args: ["bogus_type" as any], returns: "void" } }));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("bogus_type");
  });

  test.each([null, undefined, 42])("throws on non-object options argument %p", value => {
    const err = thrown(() => viewSource(value as any));
    expect(err).toBeInstanceOf(TypeError);
  });

  test.each([null, undefined, 42, "str"])("throws on non-object callback descriptor %p", value => {
    const err = thrown(() => viewSource(value as any, true));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("Expected an object");
  });

  // print_callback swallowed a pending exception from the descriptor's getters
  // and returned a non-empty "Out of memory" error instance instead, tripping
  // "host fn return/exception state mismatch". The getter's error must propagate.
  test.each(["args", "threadsafe", "returns", "ptr"])(
    "propagates a throwing %s getter in the callback descriptor",
    prop => {
      const message = `boom from ${prop} getter`;
      const err = thrown(() =>
        viewSource(
          {
            get [prop]() {
              throw new Error(message);
            },
          },
          true,
        ),
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(message);
    },
  );

  // Sibling path through generate_symbols (the non-callback form of viewSource).
  test("propagates a throwing getter in a symbol descriptor", () => {
    const err = thrown(() =>
      viewSource({
        sym: {
          get args() {
            throw new Error("boom from symbol args getter");
          },
        },
      }),
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("boom from symbol args getter");
  });

  test("returns the generated source for a valid descriptor", () => {
    const src = viewSource({ foo: { args: ["i32"], returns: "i32" } });
    expect(src).toBeArray();
    expect(src).toHaveLength(1);
    expect(src[0]).toContain("JSFunctionCall");

    const cbSrc = viewSource({ args: ["i32"], returns: "i32" }, true);
    expect(typeof cbSrc).toBe("string");
    expect(cbSrc).toContain("my_callback_function");
  });
});

describe("FFI JSCallback", () => {
  test.each([null, undefined, 42, "str", true])("throws on non-object options %p", value => {
    const err = thrown(() => new JSCallback(() => {}, value as any));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("Expected object");
  });

  test.each([null, undefined, 42, "str", {}])("throws on non-callable callback %p", value => {
    const err = thrown(() => new JSCallback(value as any, { returns: "void" }));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("Expected callback function");
  });

  test("throws on an unknown FFI type", () => {
    const err = thrown(() => new JSCallback(() => {}, { args: ["bogus_type" as any], returns: "void" }));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as TypeError).message).toContain("bogus_type");
  });

  // FFI::callback had the same bug as print_callback: a descriptor getter that
  // throws left the exception pending while callback() returned an error value.
  test.each(["args", "threadsafe", "returns", "ptr"])("propagates a throwing %s getter in the descriptor", prop => {
    const message = `boom from ${prop} getter`;
    const err = thrown(
      () =>
        new JSCallback(() => {}, {
          get [prop]() {
            throw new Error(message);
          },
        }),
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(message);
  });

  test("constructs with a valid descriptor", () => {
    using cb = new JSCallback(() => {}, { args: ["i32"], returns: "void" });
    expect(typeof cb.ptr).toBe("number");
    expect(cb.ptr).not.toBe(0);
  });
});
