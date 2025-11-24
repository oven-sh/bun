import { expect, test } from "bun:test";

// ENG-21590: Butterfly null pointer dereference when using super.property assignment
// after deleting the same property via this.property in a recursive method.
// This is a JavaScriptCore bug where super property assignment doesn't handle
// the case where the butterfly has been invalidated by a delete operation.

test("super property assignment after delete should not crash", () => {
  const obj = {
    p() {
      try {
        this.p();
      } catch (e) {}
      delete this.g;
      super.g = this;
      return this;
    },
  };

  // This should not crash - it may throw an error but should not segfault
  expect(() => {
    obj.p();
    obj.p();
  }).not.toThrow();
});

test("minimal repro: super assignment after delete", () => {
  const obj = {
    g: 1,
    method() {
      delete this.g;
      super.g = 42;
    },
  };

  // Should not crash
  expect(() => obj.method()).not.toThrow();
});
