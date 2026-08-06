// Entry point that require()s a CommonJS module whose strictness is detected via a
// function-level "use strict" IIFE. https://github.com/oven-sh/bun/issues/31806
const main = require("./function-use-strict-required-fixture.cjs");
main();
