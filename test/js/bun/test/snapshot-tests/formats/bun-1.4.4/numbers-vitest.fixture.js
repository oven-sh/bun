import { describe, expect, test } from "vitest";

// Bun 1.4.4 wrote the .snap file, in a run of this file alone. It has the header of Bun.
// Each test calls a snapshot matcher that throws before it compares, and then takes a snapshot.
// The number in the key of that snapshot says whether the matcher that threw took one.
const unprintable = () => ({
  get a() {
    throw new Error("unprintable");
  },
});
const trap = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error("trap");
      },
    },
  );
const unmergeable = () => ({
  a: 1,
  get b() {
    throw new Error("unmergeable");
  },
});
class Unreadable extends Error {
  get message() {
    throw new Error("unreadable");
  }
}
const throwUnreadable = () => {
  throw new Unreadable();
};
// The trap runs as the value is printed, and takes a snapshot then.
const nested = () =>
  new Proxy(
    { a: 1 },
    {
      ownKeys(target) {
        expect("inner").toMatchSnapshot();
        return Reflect.ownKeys(target);
      },
    },
  );
const number = () => expect.any(Number);
const after = (call, message) => {
  expect(call).toThrow(message);
  expect("after").toMatchSnapshot();
};

describe("inline", () => {
  test("an error whose message cannot be read", () => {
    after(() => expect(throwUnreadable).toThrowErrorMatchingInlineSnapshot(), "unreadable");
  });
  test("properties for what is no object", () => {
    after(() => expect(1).toMatchInlineSnapshot({ a: number() }), "must be an object when the matcher has");
  });
  test("properties that cannot be compared", () => {
    after(() => expect(unprintable()).toMatchInlineSnapshot({ a: number() }), "unprintable");
  });
  test("properties that do not match", () => {
    after(() => expect({ a: "1" }).toMatchInlineSnapshot({ a: number() }), "to match properties");
  });
  test("a value that cannot be printed", () => {
    after(() => expect(trap()).toMatchInlineSnapshot(), "trap");
  });
  // Bun 1.4.4 printed this value, and the text is another one. The format of "vitest" merges the properties in first.
  test("properties that cannot be merged", () => {
    const text = "another text";
    after(() => expect(unmergeable()).toMatchInlineSnapshot({ a: number() }, text), /unmergeable|InlineSnapshot/);
  });
  // Nothing throws here. The format of "vitest" reads the message when it prints the error.
  test("an error that is printed", () => {
    expect(() => {
      throw new Error("printed");
    }).toThrowErrorMatchingInlineSnapshot(`"printed"`);
    expect("after").toMatchSnapshot();
  });
});

describe("in the snapshot file", () => {
  test("an error whose message cannot be read", () => {
    after(() => expect(throwUnreadable).toThrowErrorMatchingSnapshot(), "unreadable");
  });
  test("properties for what is no object", () => {
    after(() => expect(1).toMatchSnapshot({ a: number() }), "must be an object when the matcher has");
  });
  test("properties that cannot be compared", () => {
    after(() => expect(unprintable()).toMatchSnapshot({ a: number() }), "unprintable");
  });
  test("properties that do not match", () => {
    after(() => expect({ a: "1" }).toMatchSnapshot({ a: number() }), "to match properties");
  });
  test("a value that cannot be printed", () => {
    after(() => expect(trap()).toMatchSnapshot(), "trap");
  });
  test("a snapshot that is taken while another one prints", () => {
    expect(nested()).toMatchSnapshot();
  });
});
