test("console.log first. it should not add a newline but should show the filename", () => {
  console.warn("Hello, world!");
});
// more dots
test.skip.each(Array.from({ length: 10 }, () => 0))("pass", () => {});
// failing test. it should add a newline but not show the filename again.
test.failing("failing test", () => {});
test.each(Array.from({ length: 10 }, () => 0))("pass", () => {});
