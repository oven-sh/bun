// yargs 17 maps "./yargs" to a CommonJS file with no extension, and this test covers that resolution.
// yargs 18 ships only ESM: with it the test passes without that resolution, so the directory stays on 17.
test("yargs/yargs works", () => {
  const yargs = require("yargs/yargs");
  expect(yargs).toBeFunction();
});
