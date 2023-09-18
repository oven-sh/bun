test("yargs/yargs works", () => {
  const yargs = require("yargs/yargs");
  expect(yargs.default).toBeFunction();
});
