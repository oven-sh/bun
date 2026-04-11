import { expect, it } from "bun:test";
import emptyXml from "./xml-empty.xml";
import xmlFromCustomTypeAttribute from "./xml-fixture.xml.txt" with { type: "xml" };

const expectedXmlFixture = {
  config: {
    "@version": "1.0",
    name: "bun",
    features: {
      feature: [
        { "@enabled": "true", "#text": "fast" },
        { "@enabled": "true", "#text": "fun" },
      ],
    },
    count: "42",
  },
};

const expectedSmallFixture = {
  config: {
    "@version": "1.0",
    name: "bun",
  },
};

it("via dynamic import", async () => {
  const xml = (await import("./xml-fixture.xml")).default;
  expect(xml).toEqual(expectedXmlFixture);
});

it("via import type xml", async () => {
  expect(xmlFromCustomTypeAttribute).toEqual(expectedSmallFixture);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./xml-fixture.xml.txt")];
  const xml = (await import("./xml-fixture.xml.txt", { with: { type: "xml" } })).default;
  expect(xml).toEqual(expectedSmallFixture);
});

it("via require", () => {
  const xml = require("./xml-fixture.xml");
  expect(xml.default).toEqual(expectedXmlFixture);
  expect(xml.config).toEqual(expectedXmlFixture.config);
});

it("empty via import statement", () => {
  // Empty XML file should return an empty object
  expect(emptyXml).toEqual({});
});

it("named export matches root element", async () => {
  const mod = await import("./xml-fixture.xml");
  expect(mod.config).toEqual(expectedXmlFixture.config);
});
