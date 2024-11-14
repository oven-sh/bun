//#FILE: test-util-inspect-getters-accessing-this.js
//#SHA1: 92c41c06f838da46cbbfcd7f695a19784af3f581
//-----------------
"use strict";

const { inspect } = require("util");

// This test ensures that util.inspect logs getters
// which access this.

test("util.inspect logs getters accessing this", () => {
  class X {
    constructor() {
      this._y = 123;
    }

    get y() {
      return this._y;
    }
  }

  const result = inspect(new X(), {
    getters: true,
    showHidden: true,
  });

  expect(result).toBe("X { _y: 123, [y]: [Getter: 123] }");
});

// Regression test for https://github.com/nodejs/node/issues/37054
test("util.inspect handles circular references in getters", () => {
  class A {
    constructor(B) {
      this.B = B;
    }
    get b() {
      return this.B;
    }
  }

  class B {
    constructor() {
      this.A = new A(this);
    }
    get a() {
      return this.A;
    }
  }

  const result = inspect(new B(), {
    depth: 1,
    getters: true,
    showHidden: true,
  });

  expect(result).toBe(
    "<ref *1> B {\n" +
      "  A: A { B: [Circular *1], [b]: [Getter] [Circular *1] },\n" +
      "  [a]: [Getter] A { B: [Circular *1], [b]: [Getter] [Circular *1] }\n" +
      "}",
  );
});

//<#END_FILE: test-util-inspect-getters-accessing-this.js
