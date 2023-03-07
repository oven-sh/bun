test("Jest auto imports", () => {
  expect(true).toBe(true);
  expect(typeof describe).toBe("function");
  expect(typeof it).toBe("function");
  expect(typeof test).toBe("function");
  expect(typeof expect).toBe("function");
  expect(typeof beforeAll).toBe("function");
  expect(typeof beforeEach).toBe("function");
  expect(typeof afterAll).toBe("function");
  expect(typeof afterEach).toBe("function");
});

test("Jest's globals aren't available in every file", async () => {
  const jestGlobals = await import("./jest-doesnt-auto-import.js");

  expect(typeof jestGlobals.describe).toBe("undefined");
  expect(typeof jestGlobals.it).toBe("undefined");
  expect(typeof jestGlobals.test).toBe("undefined");
  expect(typeof jestGlobals.expect).toBe("undefined");
  expect(typeof jestGlobals.beforeAll).toBe("undefined");
  expect(typeof jestGlobals.beforeEach).toBe("undefined");
  expect(typeof jestGlobals.afterAll).toBe("undefined");
  expect(typeof jestGlobals.afterEach).toBe("undefined");
});
