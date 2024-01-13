// @known-failing-on-windows: 1 failing
test("yargs/yargs works", () => {
  const yargs = require("yargs/yargs");
  expect(yargs).toBeFunction();
});
