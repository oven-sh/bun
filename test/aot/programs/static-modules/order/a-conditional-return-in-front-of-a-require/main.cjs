// `if (..) return;` at the top of a CommonJS file, in front of a require: where the return is taken, the require does not run.
globalThis.skip = true;
require("./first.cjs");
console.log("the first is loaded");
globalThis.skip = false;
require("./second.cjs");
