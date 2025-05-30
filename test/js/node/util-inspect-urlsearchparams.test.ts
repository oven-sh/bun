import { describe, expect, it } from "bun:test";
import util from "util";

describe("util.inspect URLSearchParams", () => {
  it("should format URLSearchParams with key-value pairs", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp)).toBe("URLSearchParams { 'a' => 'a', 'b' => 'b', 'b' => 'c' }");
  });

  it("should format empty URLSearchParams", () => {
    const emptySp = new URLSearchParams();
    expect(util.inspect(emptySp)).toBe("URLSearchParams {}");
  });

  it("should respect depth option", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp, { depth: -1 })).toBe("[Object]");
  });

  it("should respect breakLength option for multiline formatting", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp, { breakLength: 1 })).toBe(
      "URLSearchParams {\n  'a' => 'a',\n  'b' => 'b',\n  'b' => 'c'\n}"
    );
  });

  it("should format URLSearchParams keys iterator", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp.keys())).toBe("URLSearchParams Iterator { 'a', 'b', 'b' }");
  });

  it("should format URLSearchParams values iterator", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp.values())).toBe("URLSearchParams Iterator { 'a', 'b', 'c' }");
  });

  it("should format URLSearchParams keys iterator with breakLength", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    expect(util.inspect(sp.keys(), { breakLength: 1 })).toBe(
      "URLSearchParams Iterator {\n  'a',\n  'b',\n  'b'\n}"
    );
  });

  it("should format URLSearchParams entries iterator", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    const iterator = sp.entries();
    expect(util.inspect(iterator)).toBe(
      "URLSearchParams Iterator { [ 'a', 'a' ], [ 'b', 'b' ], [ 'b', 'c' ] }"
    );
  });

  it("should format URLSearchParams entries iterator after consuming entries", () => {
    const sp = new URLSearchParams("?a=a&b=b&b=c");
    const iterator = sp.entries();
    iterator.next(); // consume first entry
    expect(util.inspect(iterator)).toBe(
      "URLSearchParams Iterator { [ 'b', 'b' ], [ 'b', 'c' ] }"
    );
    
    iterator.next(); // consume second entry
    iterator.next(); // consume third entry
    expect(util.inspect(iterator)).toBe("URLSearchParams Iterator {  }");
  });

  it("should throw error when custom inspect is called incorrectly", () => {
    const sp = new URLSearchParams("?a=a&b=b");
    expect(() => sp[util.inspect.custom].call()).toThrow({
      code: "ERR_INVALID_THIS"
    });
  });

  it("should handle URLSearchParams with special characters", () => {
    const sp = new URLSearchParams("?key%20with%20spaces=value%20with%20spaces&special=!@%23$%25");
    const result = util.inspect(sp);
    expect(result).toContain("URLSearchParams");
    expect(result).toContain("'key with spaces' => 'value with spaces'");
    expect(result).toContain("'special' => '!@#$%'");
  });

  it("should handle URLSearchParams with unicode characters", () => {
    const sp = new URLSearchParams("?emoji=😀&unicode=🌟");
    const result = util.inspect(sp);
    expect(result).toContain("URLSearchParams");
    expect(result).toContain("'emoji' => '😀'");
    expect(result).toContain("'unicode' => '🌟'");
  });

  it("should handle URLSearchParams with duplicate keys", () => {
    const sp = new URLSearchParams();
    sp.append("key", "value1");
    sp.append("key", "value2");
    sp.append("key", "value3");
    const result = util.inspect(sp);
    expect(result).toContain("URLSearchParams");
    expect(result).toContain("'key' => 'value1'");
    expect(result).toContain("'key' => 'value2'");
    expect(result).toContain("'key' => 'value3'");
  });
});