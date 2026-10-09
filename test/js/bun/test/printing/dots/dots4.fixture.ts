test.each(Array.from({ length: 5 }, () => 0))("pass", () => {});
// console.timeEnd prints on stderr, like console.warn. it should show the filename
test("console.timeEnd", () => {
  console.time("timer");
  console.timeEnd("timer");
});
// more tests
test.each(Array.from({ length: 5 }, () => 0))("pass", () => {});
// console.assert(false) prints on stderr too. it should add a newline but not show the filename again.
test("console.assert", () => {
  console.assert(false);
});
test.each(Array.from({ length: 5 }, () => 0))("pass", () => {});
// console.timeLog
test("console.timeLog", () => {
  console.time("timer");
  console.timeLog("timer", "value");
});
