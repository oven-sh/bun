// https://github.com/oven-sh/bun/issues/31806
//
// The function-level "use strict" must survive when this module is loaded via require() — this is
// exactly how Bluebird's js/release/es5.js detects ES5 support.

const isES5 = (function () {
  "use strict";
  return this === undefined;
})();

module.exports = function main() {
  if (!isES5) {
    throw new Error("required CommonJS module lost function-level 'use strict'");
  }
};
