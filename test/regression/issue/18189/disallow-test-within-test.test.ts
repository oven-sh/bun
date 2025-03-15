import { seperateFileTest } from "./test_in_seperate_file.js";

describe("test within test is disallowed", () => {
  test("test within test", () => {
    expect(() => test("test within test", () => {})).toThrow(
      "test() cannot be called within a test. Use 'describe' to nest tests.",
    );
  });
  test("describe within test", () => {
    expect(() => describe("test within test", () => {})).toThrow(
      "describe() cannot be called within a test. Use 'describe' to nest tests.",
    );
  });
  test("it within test", () => {
    expect(() => it("test within test", () => {})).toThrow(
      "test() cannot be called within a test. Use 'describe' to nest tests.",
    );
  });
  test("test.only within test", () => {
    expect(() => test.only("test within test", () => {})).toThrow(
      "test.only() cannot be called within a test. Use 'describe' to nest tests.",
    );
  });
  test("test.skip within test", () => {
    expect(() => test.skip("test within test", () => {})).toThrow(
      "test.skip() cannot be called within a test. Use 'describe' to nest tests.",
    );
  });
  test("seperateFileTest within test", () => {
    expect(() => seperateFileTest()).toThrow("test() cannot be called within a test. Use 'describe' to nest tests.");
  });
});
