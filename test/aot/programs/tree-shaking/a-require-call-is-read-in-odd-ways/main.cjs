// The result of require() of an ES module is used on the spot, each time in another way than a plain `.name`.
console.log(require("./lib.mjs")["quoted"]());
console.log(require("./lib.mjs")?.optional());
console.log((require("./lib.mjs")).parenthesized());
console.log(new (require("./lib.mjs").Klass)().method());
console.log(require("./lib.mjs").inner.twoDeep());
console.log(require("./lib.mjs").inner["twoDeep" + "Computed"]());
console.log(require("./lib.mjs").default.held());
console.log(require("./lib.mjs").tag`x`);
console.log(typeof require("./lib.mjs").onlyTypeof);
with (require("./lib.mjs")) console.log(underWith());
console.log([require("./lib.mjs")].map(lib => lib.inCallback())[0]);
console.log((true ? require("./lib.mjs") : null).inCondition());
