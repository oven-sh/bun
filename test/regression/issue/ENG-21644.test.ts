import { expect, test } from "bun:test";

// ENG-21644: Butterfly null pointer dereference when Array.prototype.splice
// calls valueOf on an object whose valueOf recursively modifies and deletes
// properties, causing the butterfly to become null.
// This is a JavaScriptCore bug in Butterfly.h:182.

test("splice with valueOf that deletes properties should not crash", () => {
  const Cls = class {
    valueOf() {
      this.h = this;
      delete this.h;
      this.valueOf();
    }
  };
  const obj = new Cls();

  // This should throw (stack overflow) but not crash/segfault
  expect(() => {
    [807983515].splice(obj);
  }).toThrow();
});

test("minimal repro: splice with self-modifying valueOf", () => {
  let count = 0;
  const obj = {
    valueOf() {
      count++;
      if (count < 100) {
        this.prop = this;
        delete this.prop;
        return this.valueOf();
      }
      return 0;
    },
  };

  // Should not crash
  expect(() => {
    [1, 2, 3].splice(obj);
  }).not.toThrow();
});
