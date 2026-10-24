// A require runs the module where the call stands, and only the first one does.
// STATISTIC: ModulesWithoutState >= 1
console.log(1);
const a = require("./a.cjs");
console.log(2);
require("./a.cjs");
console.log(a.x);
