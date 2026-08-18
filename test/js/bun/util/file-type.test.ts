import { describe, expect, test } from "bun:test";
describe("util file tests", () => {
  test("custom set mime-type respected (#6507)", () => {
    const file = Bun.file("test", {
      type: "text/markdown",
    });
    expect(file.type).toBe("text/markdown");

    const custom_type = Bun.file("test", {
      type: "custom/mimetype",
    });
    expect(custom_type.type).toBe("custom/mimetype");
  });

  test("mime-type is text/css;charset=utf-8", () => {
    const file = Bun.file("test.css");
    expect(file.type).toBe("text/css;charset=utf-8");
  });

  // The extension table (EXTENSIONS in src/http_types/MimeType.rs) has ~1200
  // entries, so Bun looks it up through the sorted-key tables that
  // comptime_string_map! emits for large maps. Its extensions are 1 to 13
  // characters long; no entry is 12 characters long, and "cryptonote" and
  // "disposition-n" are the only entries of their lengths. Lookups fold ASCII
  // case. An unknown extension gives application/octet-stream.
  describe("mime-type by extension", () => {
    const typeOf = (ext: string) => Bun.file("test." + ext).type;

    test.each([
      ["c", "text/x-c"],
      ["ai", "application/postscript"],
      ["png", "image/png"],
      ["htm", "text/html;charset=utf-8"],
      ["html", "text/html;charset=utf-8"],
      ["woff2", "font/woff2"],
      ["coffee", "text/coffeescript"],
      ["geojson", "application/geo+json"],
      ["appcache", "text/cache-manifest"],
      ["emotionml", "application/emotionml+xml"],
      ["cryptonote", "application/vnd.rig.cryptonote"],
      ["webmanifest", "application/manifest+json"],
      ["disposition-n", "message/disposition-notification"],
    ])("%s", (ext, type) => {
      expect(typeOf(ext)).toBe(type);
      expect(typeOf(ext.toUpperCase())).toBe(type);
    });

    // Misses one character away from an entry, in every bucket shape: a full
    // bucket (3 characters), a single-entry bucket (10), the empty 12-character
    // bucket, and a length past the longest entry.
    test.each(["htn", "pnf", "coffe", "coffees", "geojsom", "cryptonotf", "disposition-", "disposition-nx"])(
      "%s is unknown",
      ext => {
        expect(typeOf(ext)).toBe("application/octet-stream");
        expect(typeOf(ext.toUpperCase())).toBe("application/octet-stream");
      },
    );
  });
});
