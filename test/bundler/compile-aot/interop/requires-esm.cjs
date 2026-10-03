const esm = require("./esm.ts");
exports.read = function () {
  return esm.live + ":" + esm.fixed;
};
exports.advance = function () {
  return esm.advance();
};
