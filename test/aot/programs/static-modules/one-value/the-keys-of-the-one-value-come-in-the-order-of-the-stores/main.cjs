// The names behind the one value are listed in the order in which they were created, whatever they are called.
const Kind = require("./class.cjs"), make = require("./function.cjs"), seen = require("./seen-early.cjs");
console.log(Object.keys(Kind).join(), Kind.zeta, Kind.alpha, Kind.middle, Kind.beta);
console.log(Object.keys(make).join(), make.zeta, make.alpha, make.middle, make.beta);
console.log(seen.log, Object.keys(seen).join(), seen.version);
