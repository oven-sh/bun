import { expect, it } from "bun:test";
import emptyJson5 from "./json5-empty.json5";
import json5FromCustomTypeAttribute from "./json5-fixture.json5.txt" with { type: "json5" };

const expectedJson5Fixture = {
  framework: "next",
  bundle: {
    packages: {
      "@emotion/react": true,
    },
  },
  array: [
    {
      entry_one: "one",
      entry_two: "two",
    },
    {
      entry_one: "three",
      nested: [
        {
          entry_one: "four",
        },
      ],
    },
  ],
  dev: {
    one: {
      two: {
        three: 4,
      },
    },
    foo: 123,
    "foo.bar": "baz",
  },
};

const expectedSmallFixture = {
  framework: "next",
  bundle: {
    packages: {
      "@emotion/react": true,
    },
  },
};

it("via dynamic import", async () => {
  const json5 = (await import("./json5-fixture.json5")).default;
  expect(json5).toEqual(expectedJson5Fixture);
});

it("via import type json5", () => {
  expect(json5FromCustomTypeAttribute).toEqual(expectedSmallFixture);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./json5-fixture.json5.txt")];
  const json5 = (await import("./json5-fixture.json5.txt", { with: { type: "json5" } })).default;
  expect(json5).toEqual(expectedSmallFixture);
});

it("null value via import statement", () => {
  expect(emptyJson5).toBe(null);
});
