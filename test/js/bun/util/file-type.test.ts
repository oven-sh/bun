import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";

describe("util file tests", () => {
  test("custom set mime-type respected (#6507)", () => {
    const file = Bun.file("test", {
      type: "text/markdown",
    });
    // Known `text/*` values are normalized to carry the UTF-8 charset,
    // matching how `text/plain` and `text/css` already behave.
    expect(file.type).toBe("text/markdown;charset=utf-8");

    const custom_type = Bun.file("test", {
      type: "custom/mimetype",
    });
    expect(custom_type.type).toBe("custom/mimetype");
  });

  test("mime-type is text/css;charset=utf-8", () => {
    const file = Bun.file("test.css");
    expect(file.type).toBe("text/css;charset=utf-8");
  });

  test("every text/* extension-derived type carries ;charset=utf-8", () => {
    const cases: Record<string, string> = {
      // the five that already carried a charset:
      "a.txt": "text/plain;charset=utf-8",
      "a.html": "text/html;charset=utf-8",
      "a.css": "text/css;charset=utf-8",
      "a.js": "text/javascript;charset=utf-8",
      "a.json": "application/json;charset=utf-8",
      // text/* subtypes that previously lacked a charset:
      "a.md": "text/markdown;charset=utf-8",
      "a.markdown": "text/markdown;charset=utf-8",
      "a.csv": "text/csv;charset=utf-8",
      "a.tsv": "text/tab-separated-values;charset=utf-8",
      "a.ics": "text/calendar;charset=utf-8",
      "a.yaml": "text/yaml;charset=utf-8",
      "a.yml": "text/yaml;charset=utf-8",
      "a.vcf": "text/x-vcard;charset=utf-8",
      "a.vtt": "text/vtt;charset=utf-8",
      "a.c": "text/x-c;charset=utf-8",
      "a.java": "text/x-java-source;charset=utf-8",
      "a.appcache": "text/cache-manifest;charset=utf-8",
      "a.rtx": "text/richtext;charset=utf-8",
      // non-text/* types stay as-is:
      "a.wasm": "application/wasm",
      "a.svg": "image/svg+xml",
      "a.png": "image/png",
      "a.pdf": "application/pdf",
    };
    const actual = Object.fromEntries(Object.keys(cases).map(name => [name, Bun.file(name).type]));
    expect(actual).toEqual(cases);
  });

  test("Bun.file().slice() inherits a text/* charset-promoted type", () => {
    using dir = tempDir("slice-type", { "a.md": "hello", "a.txt": "hello", "a.png": "x" });
    expect({
      md: Bun.file(join(String(dir), "a.md")).slice(0, 3).type,
      txt: Bun.file(join(String(dir), "a.txt")).slice(0, 3).type,
      png: Bun.file(join(String(dir), "a.png")).slice(0, 3).type,
    }).toEqual({
      md: "text/markdown;charset=utf-8",
      txt: "text/plain;charset=utf-8",
      png: "image/png",
    });
  });
});
