import { expect, it } from "bun:test";
import emptyYaml from "./yaml-empty.yaml";
import yamlFromCustomTypeAttribute from "./yaml-fixture.yaml.txt" with { type: "yaml" };

const expectedYamlFixture = {
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

const expectedYmlFixture = {
  framework: "next",
  bundle: {
    packages: {
      "@emotion/react": true,
    },
  },
};

it("via dynamic import", async () => {
  const yaml = (await import("./yaml-fixture.yaml")).default;
  expect(yaml).toEqual(expectedYamlFixture);
});

it("via import type yaml", async () => {
  expect(yamlFromCustomTypeAttribute).toEqual(expectedYmlFixture);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./yaml-fixture.yaml.txt")];
  const yaml = (await import("./yaml-fixture.yaml.txt", { with: { type: "yaml" } })).default;
  expect(yaml).toEqual(expectedYmlFixture);
});

it("empty via import statement", () => {
  // Empty YAML file with just a comment should return null
  expect(emptyYaml).toBe(null);
});

it("yml extension works", async () => {
  const yaml = (await import("./yaml-fixture.yml")).default;
  expect(yaml).toEqual(expectedYmlFixture);
});
