import { expect, it } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
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

it("a literal followed by multi-byte white space, via import and require", async () => {
  // U+00A0, U+2028 and U+FEFF are JSON5 white space.
  const source = "{ enabled: true\u00A0, limit: -Infinity\u2028, name: null\uFEFF}";
  using dir = tempDir("json5-multi-byte-whitespace", { "imported.json5": source, "required.json5": source });
  const expected = { enabled: true, limit: -Infinity, name: null };

  expect((await import(join(String(dir), "imported.json5"))).default).toEqual(expected);
  expect(require(join(String(dir), "required.json5"))).toEqual(expected);
});
