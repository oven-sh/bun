//#FILE: test-console-assign-undefined.js
//#SHA1: ccd5cd3087520e692e5123679c1753d168d310f0
//-----------------
"use strict";

// Patch global.console before importing modules that may modify the console
// object.

let originalConsole;

beforeAll(() => {
  originalConsole = global.console;
  global.console = 42;
});

afterAll(() => {
  // Reset the console
  global.console = originalConsole;
});

test("console can be assigned a non-object value", () => {
  // Originally the console had a getter. Test twice to verify it had no side
  // effect.
  expect(global.console).toBe(42);
  expect(global.console).toBe(42);

  expect(() => console.log("foo")).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  global.console = 1;
  expect(global.console).toBe(1);
  expect(console).toBe(1);
});

test("console can be reset and used", () => {
  global.console = originalConsole;
  const consoleSpy = jest.spyOn(console, "log");
  console.log("foo");
  expect(consoleSpy).toHaveBeenCalledWith("foo");
  consoleSpy.mockRestore();
});

//<#END_FILE: test-console-assign-undefined.js
