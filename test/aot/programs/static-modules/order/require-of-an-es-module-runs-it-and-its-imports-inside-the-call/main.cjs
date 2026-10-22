// require() of an ES module runs its imports and then its body inside the call.
// STATISTIC: ModulesWithoutState >= 2
console.log(1);
const m = require("./m.mjs");
console.log(m.x);
