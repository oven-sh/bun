import { describe, expect, it } from "bun:test";

describe("decodeHTMLEntity", () => {
  it("decodes named entities", () => {
    expect(Bun.decodeHTMLEntity("&amp;")).toBe("&");
    expect(Bun.decodeHTMLEntity("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(Bun.decodeHTMLEntity("&lt;div&gt;")).toBe("<div>");
  });

  it("returns input when entity unknown", () => {
    expect(Bun.decodeHTMLEntity("&notanentity;")).toBe("&notanentity;");
  });
});
