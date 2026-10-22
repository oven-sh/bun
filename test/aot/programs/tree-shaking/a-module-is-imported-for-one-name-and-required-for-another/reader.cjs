exports.throughCommonJS = function () {
  const lib = require("./lib.ts");
  return lib["readBy" + "CommonJS"]();
};
