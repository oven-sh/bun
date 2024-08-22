//#FILE: test-timers-to-primitive.js
//#SHA1: 87671c76fb38458f9d4f68aa747b2d95076f6bb4
//-----------------
"use strict";

test("Timeout and Interval primitives", () => {
  const timeouts = [setTimeout(() => {}, 1), setInterval(() => {}, 1)];

  timeouts.forEach(timeout => {
    expect(Number.isNaN(+timeout)).toBe(false);
    expect(+timeout).toBe(timeout[Symbol.toPrimitive]());
    expect(`${timeout}`).toBe(timeout[Symbol.toPrimitive]().toString());
    expect(Object.keys({ [timeout]: timeout })).toEqual([`${timeout}`]);
    clearTimeout(+timeout);
  });
});

test("clearTimeout works with number id", () => {
  const timeout = setTimeout(() => {}, 1);
  const id = +timeout;
  expect(() => clearTimeout(id)).not.toThrow();
});

test("clearTimeout works with string id", () => {
  const timeout = setTimeout(() => {}, 1);
  const id = `${timeout}`;
  expect(() => clearTimeout(id)).not.toThrow();
});

//<#END_FILE: test-timers-to-primitive.js
