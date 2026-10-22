// A CommonJS file requires an ES module written in TypeScript and reads it in every way: a member of the call, a pattern, a variable read by name and by a computed name, the default, and a require inside a function.
console.log(require("./lib.ts").memberOfCall());

const { inPattern, renamed: other } = require("./lib.ts");
console.log(inPattern(), other());

const lib = require("./lib.ts");
console.log(lib.byName(), lib["by" + "Computed"](), lib.default());

function late() {
  return require("./late.ts").lateMember();
}
console.log(late());

const { Klass } = require("./lib.ts");
console.log(new Klass().method());
console.log(Object.keys(require("./keys.ts")).map(key => require("./keys.ts")[key]()).join());
