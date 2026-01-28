test.each(Array.from({ length: 10 }, () => 0))("pass", () => {});
// now, console.log. it should show the filename
test("console.log", () => {
  console.warn("Hello, world!");
});
// more tests
test.each(Array.from({ length: 10 }, () => 0))("pass", () => {});
// console.log again. it should add a newline but not show the filename again.
test("console.log again", () => {
  console.warn("Hello, world!");
});
