// `require` in a TypeScript file that is an ES module itself, import.meta.require, and `import x = require()`.
import viaImportEquals = require("./d");

const { a } = require("./a");
console.log(a());
console.log(import.meta.require("./b").b());
console.log(viaImportEquals.d());
const whole = require("./e");
console.log(whole["e" + ""]());
