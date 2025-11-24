import { expect, test } from "bun:test";

// ENG-21712: JSC Butterfly null pointer dereference
// Repeatedly redefining a setter property many times, then using the object
// as a prototype causes the butterfly to become null.
// This is a JavaScriptCore bug at Butterfly.h:182.
// Related to WebKit bug https://bugs.webkit.org/show_bug.cgi?id=303015

test("repeated setter redefinition then prototype usage should not crash", () => {
  // This test documents a JSC bug - it currently crashes bun-debug
  function f0() {
    return { set h(_a: unknown) {} };
  }
  const v4 = f0();

  // Redefine the setter 82 times
  for (let i = 0; i < 82; i++) {
    Object.defineProperty(v4, "h", { set: f0 });
  }

  // Using the modified object as prototype triggers the crash
  expect(() => {
    const _v7 = { __proto__: v4, f: 230.21753043202466 };
  }).not.toThrow();
});
