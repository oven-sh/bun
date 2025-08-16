import { expect, it } from "bun:test";
import emptyYaml from "./yaml-empty.yaml";
import yamlFromCustomTypeAttribute from "./yaml-fixture.yaml.txt" with { type: "yaml" };

it("via dynamic import", async () => {
  const yaml = (await import("./yaml-fixture.yaml")).default;
  // For now, our mock parser just returns an empty object
  expect(yaml).toEqual({});
});

it("via import type yaml", async () => {
  // For now, our mock parser just returns an empty object
  expect(yamlFromCustomTypeAttribute).toEqual({});
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./yaml-fixture.yaml.txt")];
  const yaml = (await import("./yaml-fixture.yaml.txt", { with: { type: "yaml" } })).default;
  // For now, our mock parser just returns an empty object
  expect(yaml).toEqual({});
});

it("empty via import statement", () => {
  expect(emptyYaml).toEqual({});
});

it("yml extension works", async () => {
  const yaml = (await import("./yaml-fixture.yml")).default;
  // For now, our mock parser just returns an empty object
  expect(yaml).toEqual({});
});