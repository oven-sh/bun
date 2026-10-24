// A package whose package.json says "sideEffects": false. A require() always runs its target, whether or not the result is used.
require("./package/index.cjs");
console.log("end");
