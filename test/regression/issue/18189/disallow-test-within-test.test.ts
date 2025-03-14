test("test within test is disallowed", () => {
  expect(() => test("test within test", () => {})).toThrow(
    "test() cannot be called within a test. Use 'describe' to nest tests.",
  );
  expect(() => describe("test within test", () => {})).toThrow(
    "describe() cannot be called within a test. Use 'describe' to nest tests.",
  );
  expect(() => it("test within test", () => {})).toThrow(
    "test() cannot be called within a test. Use 'describe' to nest tests.",
  );
  expect(() => test.only("test within test", () => {})).toThrow(
    "test.only() cannot be called within a test. Use 'describe' to nest tests.",
  );
  expect(() => test.skip("test within test", () => {})).toThrow(
    "test.skip() cannot be called within a test. Use 'describe' to nest tests.",
  );
});
