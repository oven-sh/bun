// The suites that `node --test --test-only` reports with a directive are `marked skipped suite`, `nested skipped suite` and `nested todo suite`.
const { test, describe } = require("node:test");

test.only("marked", () => {});
describe.todo("todo suite", () => {
  test("a", () => {});
});
describe.only("marked skipped suite", { skip: true }, () => {
  test("b", () => {});
});
describe.only("marked suite", () => {
  test("c", () => {});
  describe.skip("nested skipped suite", () => {
    test("d", () => {});
  });
  describe.todo("nested todo suite", () => {
    test("e", () => {});
  });
});
describe("narrowed suite", () => {
  test.only("f", () => {});
  describe.skip("nested skipped suite in a narrowed suite", () => {
    test("g", () => {});
  });
});
