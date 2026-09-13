import { expect, it } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import empty from "./xml-empty.xml";
import fixture, * as namespace from "./xml-fixture.xml";
import xmlFromCustomTypeAttribute from "./xml-fixture.xml.txt" with { type: "xml" };

const expectedFixture = {
  config: {
    "@framework": "next",
    bundle: {
      package: [
        { "@name": "@emotion/react", "@enabled": "true" },
        { "@name": "lodash", "@enabled": "false" },
      ],
    },
    dev: { "@port": "3000", "#text": "watch ", b: "on" },
    empty: "",
  },
};

it("via import statement", () => {
  expect(fixture).toEqual(expectedFixture);
});

it("the root element is also a named export", () => {
  expect(namespace.config).toEqual(expectedFixture.config);
  expect(namespace.default).toEqual(expectedFixture);
});

it("via dynamic import", async () => {
  const xml = (await import("./xml-fixture.xml")).default;
  expect(xml).toEqual(expectedFixture);
});

it("via require", () => {
  // Already in the module registry from the import above, so this is the
  // namespace object: the root element is reachable either way.
  expect(require("./xml-fixture.xml").config).toEqual(expectedFixture.config);
});

it("via import type xml", () => {
  expect(xmlFromCustomTypeAttribute).toEqual({ note: { "@importance": "high", "#text": "remember" } });
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./xml-fixture.xml.txt")];
  const xml = (await import("./xml-fixture.xml.txt", { with: { type: "xml" } })).default;
  expect(xml).toEqual({ note: { "@importance": "high", "#text": "remember" } });
});

it("an empty file is an empty object, like the other data loaders", () => {
  expect(empty).toEqual({});
});

it("files in the encodings XML requires are decoded before parsing", async () => {
  const expected = { doc: { "@lang": "français", "#text": "café 日本" } };
  expect((await import("./xml-utf16le-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-utf16be-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-utf8-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-latin1.xml")).default).toEqual({ doc: { "@lang": "français", "#text": "café" } });
});

it("a malformed file is a build error with the parser's message and location", async () => {
  let error;
  try {
    await import("./xml-malformed.xml");
  } catch (e) {
    error = e;
  }
  expect(error?.name).toBe("BuildMessage");
  expect(error.message).toBe("Expected closing tag </port> but found </bad>");
  expect(error.position).toMatchObject({ line: 3, column: 13, lineText: "  <port>8080</bad>" });
});

it("a document nested too deeply to parse is a build error, not a crash or a missing module", async () => {
  // Deep enough to overflow any native stack, whatever the frame size.
  const depth = 2_000_000;
  using dir = tempDir("xml-deep", {
    "deep.xml": Buffer.alloc(depth * 3, "<a>").toString() + Buffer.alloc(depth * 4, "</a>").toString(),
  });
  let error;
  try {
    await import(join(String(dir), "deep.xml"));
  } catch (e) {
    error = e;
  }
  expect(error?.name).toBe("BuildMessage");
  expect(error.message).toBe("Nesting is too deep");
});
