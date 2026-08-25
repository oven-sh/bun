import { describe, expect, test } from "bun:test";

// Coverage for the WebKit f390a25a sync (oven-sh/WebKit#517): under the u and
// v flags, an identity escape of a non-ASCII character must be a SyntaxError.
// Yarr only validated ASCII escapes, so /\Ç/u compiled and matched with the
// Annex B meaning. Fixes oven-sh/bun#40441.

describe.concurrent("WebKit f390a25a upgrade", () => {
  test("non-ASCII identity escapes throw under the u and v flags", () => {
    expect(() => new RegExp("\\Ç", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\Ç", "v")).toThrow(SyntaxError);
    expect(() => new RegExp("\\é", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\字", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\𝒳", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\𝒳", "v")).toThrow(SyntaxError);
    expect(() => new RegExp("[\\Ç]", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("[\\Ç]", "v")).toThrow(SyntaxError);
    expect(() => new RegExp("[\\q{\\Ç}]", "v")).toThrow(SyntaxError);
  });

  test("ASCII identity escapes keep their behavior", () => {
    // Still invalid under u: not a SyntaxCharacter or '/'.
    expect(() => new RegExp("\\q", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\\u0000", "u")).toThrow(SyntaxError);
    // Still valid.
    expect(new RegExp("\\$", "u").test("$")).toBe(true);
    expect(new RegExp("\\/", "u").test("/")).toBe(true);
    expect(new RegExp("[\\-]", "u").test("-")).toBe(true);
    expect(new RegExp("[\\&]", "v").test("&")).toBe(true);
  });

  test("non-unicode patterns and escaped code points are unchanged", () => {
    expect(new RegExp("\\Ç").test("Ç")).toBe(true);
    expect(new RegExp("Ç", "u").test("Ç")).toBe(true);
    expect(new RegExp("\\u00C7", "u").test("Ç")).toBe(true);
  });
});
