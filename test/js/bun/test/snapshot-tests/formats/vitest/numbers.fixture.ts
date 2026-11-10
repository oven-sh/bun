// @ts-nocheck
import { describe, expect, test } from "vitest";

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
class Unserializable {}
expect.addSnapshotSerializer({
  test: value => value instanceof Unserializable,
  serialize() {
    throw new Error("unserializable");
  },
});
const number = () => expect.any(Number);
const after = (call, message) => {
  expect(call).toThrow(message);
  expect("after").toMatchSnapshot();
};

describe("in the snapshot file", () => {
  test("not", () => {
    after(() => expect(1).not.toMatchSnapshot(), "cannot be used with");
  });
  test("a function that does not throw", () => {
    after(() => expect(() => {}).toThrowErrorMatchingSnapshot(), /did(n't| not) throw/);
  });
  test("an error whose message cannot be read", () => {
    after(() => expect(throwUnreadable).toThrowErrorMatchingSnapshot(), "unreadable");
  });
  test("properties for what is no object", () => {
    after(() => expect(1).toMatchSnapshot({ a: number() }), "must be an object when the matcher has");
  });
  test("properties for a function", () => {
    after(() => expect(() => {}).toMatchSnapshot({ a: number() }), /must be an object|to match properties/);
  });
  test("properties that cannot be compared", () => {
    after(() => expect(unprintable()).toMatchSnapshot({ a: number() }), "unprintable");
  });
  test("properties of an array that cannot be compared", () => {
    after(() => expect([unprintable()]).toMatchSnapshot([{ a: number() }]), "unprintable");
  });
  test("properties that cannot be merged", () => {
    after(() => expect(unmergeable()).toMatchSnapshot({ a: number() }), "unmergeable");
  });
  test("a value that cannot be printed", () => {
    after(() => expect(trap()).toMatchSnapshot(), "trap");
  });
  test("a getter that throws", () => {
    after(() => expect(unprintable()).toMatchSnapshot(), "unprintable");
  });
  test("a serializer that throws", () => {
    after(() => expect(new Unserializable()).toMatchSnapshot(), "unserializable");
  });
  test("a hint", () => {
    expect(() => expect(trap()).toMatchSnapshot("hint")).toThrow("trap");
    expect("after").toMatchSnapshot("hint");
    expect("without the hint").toMatchSnapshot();
  });
  test("twice", () => {
    expect(() => expect(trap()).toMatchSnapshot()).toThrow("trap");
    after(() => expect(trap()).toMatchSnapshot(), "trap");
  });
  test("a snapshot that is taken while another one prints", () => {
    const value = {
      get inner() {
        expect("inner").toMatchSnapshot();
        return 1;
      },
    };
    expect(value).toMatchSnapshot();
  });
});

describe("inline", () => {
  test("not", () => {
    after(() => expect(1).not.toMatchInlineSnapshot(), "cannot be used with");
  });
  test("a function that does not throw", () => {
    after(() => expect(() => {}).toThrowErrorMatchingInlineSnapshot(), /did(n't| not) throw/);
  });
  test("an error whose message cannot be read", () => {
    after(() => expect(throwUnreadable).toThrowErrorMatchingInlineSnapshot(), "unreadable");
  });
  test("properties for what is no object", () => {
    after(() => expect(1).toMatchInlineSnapshot({ a: number() }), "must be an object when the matcher has");
  });
  test("properties for a function", () => {
    after(() => expect(() => {}).toMatchInlineSnapshot({ a: number() }), /must be an object|to match properties/);
  });
  test("properties that cannot be compared", () => {
    after(() => expect(unprintable()).toMatchInlineSnapshot({ a: number() }), "unprintable");
  });
  test("a value that cannot be printed", () => {
    after(() => expect(trap()).toMatchInlineSnapshot(), "trap");
  });
  test("a serializer that throws", () => {
    after(() => expect(new Unserializable()).toMatchInlineSnapshot(), "unserializable");
  });
  test("after one in the snapshot file", () => {
    expect(() => expect(trap()).toMatchSnapshot()).toThrow("trap");
    after(() => expect(trap()).toMatchInlineSnapshot(), "trap");
  });
});

// Jest fails the test at its end where Vitest throws, and Jest has no such matcher and no such option.
describe("only in Vitest", () => {
  test("properties that do not match", () => {
    after(() => expect({ a: "1" }).toMatchSnapshot({ a: number() }), /[Pp]roperties/);
  });
  test("properties that do not match, inline", () => {
    after(() => expect({ a: "1" }).toMatchInlineSnapshot({ a: number() }), /[Pp]roperties/);
  });
  test("properties that cannot be merged, inline", () => {
    after(() => expect(unmergeable()).toMatchInlineSnapshot({ a: number() }), "unmergeable");
  });
  test("a getter that throws, inline", () => {
    after(() => expect(unprintable()).toMatchInlineSnapshot(), "unprintable");
  });
  test("a snapshot that is taken while an inline one prints", () => {
    const value = {
      get inner() {
        expect("inner").toMatchSnapshot();
        return 1;
      },
    };
    expect(value).toMatchInlineSnapshot(`
      {
        "inner": 1,
      }
    `);
  });
  test("toMatchFileSnapshot()", async () => {
    let message;
    try {
      await expect(trap()).toMatchFileSnapshot("./__snapshots__/numbers.never-written.txt");
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe("trap");
    expect("after").toMatchSnapshot();
  });
  // Vitest asks `existsSync()` for the file. It is false for these paths too, so the matcher goes on as for a new file.
  test.each([
    ["a path under a file", "./numbers.fixture.ts/never-written.txt"],
    ["a name that is too long", `./${Buffer.alloc(300, "n")}.txt`],
  ])("toMatchFileSnapshot() with %s", async (_, path) => {
    let message;
    try {
      await expect(trap()).toMatchFileSnapshot(path);
    } catch (error) {
      message = error.message;
    }
    expect(message).toBe("trap");
    expect("after").toMatchSnapshot();
  });
  let attempts = 0;
  test("a test that runs again", { retry: 1 }, () => {
    after(() => expect(trap()).toMatchSnapshot(), "trap");
    if (attempts++ === 0) throw new Error("again");
  });
});
