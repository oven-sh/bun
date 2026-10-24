// Behind `module.exports = X`, `exports` and the top-level `this` still name the object the module was born with.
const literal = require("./literal.cjs");
const rebound = require("./rebound.cjs");
const value = require("./value.cjs");
console.log(Object.keys(literal).join(), literal.a, literal.b, literal.c, literal.seen());
console.log(Object.keys(rebound).join(), rebound.a, rebound.b);
console.log(typeof value, value.b, value.c, value());
