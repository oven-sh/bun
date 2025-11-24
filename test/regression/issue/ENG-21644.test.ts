import { expect, test } from "bun:test";

// ENG-21644: JSC Butterfly null pointer dereference
// When Array.prototype.splice calls valueOf on an object whose valueOf
// recursively modifies and deletes properties, the butterfly becomes null.
// This is a JavaScriptCore bug at Butterfly.h:182.
// Related to WebKit bug https://bugs.webkit.org/show_bug.cgi?id=303015

test("splice with valueOf that recursively deletes properties should not crash", () => {
  // This test documents a JSC bug - it currently crashes bun-debug
  // The test is expected to throw (stack overflow) but should NOT segfault
  const Cls = class {
    valueOf(): number {
      (this as any).h = this;
      delete (this as any).h;
      return this.valueOf();
    }
  };
  const obj = new Cls();

  expect(() => {
    [807983515].splice(obj as unknown as number);
  }).toThrow(); // Stack overflow, but not crash
});
