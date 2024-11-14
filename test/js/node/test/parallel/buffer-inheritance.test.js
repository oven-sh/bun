//#FILE: test-buffer-inheritance.js
//#SHA1: 01cba7d2cb76cb1d00fa91b3666dc58333b66e1b
//-----------------
"use strict";

test("Buffer inheritance", () => {
  function T(n) {
    const ui8 = new Uint8Array(n);
    Object.setPrototypeOf(ui8, T.prototype);
    return ui8;
  }
  Object.setPrototypeOf(T.prototype, Buffer.prototype);
  Object.setPrototypeOf(T, Buffer);

  T.prototype.sum = function sum() {
    let cntr = 0;
    for (let i = 0; i < this.length; i++) cntr += this[i];
    return cntr;
  };

  const vals = [new T(4), T(4)];

  vals.forEach(function (t) {
    expect(t.constructor).toBe(T);
    expect(Object.getPrototypeOf(t)).toBe(T.prototype);
    expect(Object.getPrototypeOf(Object.getPrototypeOf(t))).toBe(Buffer.prototype);

    t.fill(5);
    let cntr = 0;
    for (let i = 0; i < t.length; i++) cntr += t[i];
    expect(cntr).toBe(t.length * 5);

    // Check this does not throw
    expect(() => t.toString()).not.toThrow();
  });
});

//<#END_FILE: test-buffer-inheritance.js
