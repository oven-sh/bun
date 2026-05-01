const { test, expect } = require("bun:test");

test.each([[]])("%p", array => {
  expect(array.length).toBe(0);
});
