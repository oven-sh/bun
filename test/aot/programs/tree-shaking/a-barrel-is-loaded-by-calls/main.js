// Six pure packages with the same barrel of three files. Each is loaded by a call: require read by a name, by a pattern, kept in a constant and read by names, kept and read by a computed name; import() awaited and read by a name and by a pattern.
console.log(require("by-require-name").a());
const { b } = require("by-require-pattern");
console.log(b());
const kept = require("by-require-constant");
console.log(kept.a(), kept.c());
const whole = require("by-require-computed");
console.log(whole["a" + ""]());
console.log((await import("by-import-name")).b());
const { c } = await import("by-import-pattern");
console.log(c());
