// `require("./lib.mjs").start()` and `lib.start()` run start with `this` = the object that require returned, and start calls other exports through it. The same through an optional call, a tagged template and a member in brackets.
console.log(require("./direct.mjs").start());
const lib = require("./held.mjs");
console.log(lib.start());
console.log(lib.optional?.());
console.log(lib.tag`x`);
console.log(lib["bracketed"]());
