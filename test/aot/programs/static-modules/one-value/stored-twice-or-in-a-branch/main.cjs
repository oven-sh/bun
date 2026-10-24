// Forms that miss "stored exactly once, in order": two stores, a store in each arm of a branch, a store in a function that the body calls. Members go to the value that `module.exports` holds at that moment.
const twice = require("./twice.cjs");
console.log(twice(), twice.member, twice.other, twice.name);
const branch = require("./branch.cjs");
console.log(branch.name, branch.member);
const inFunction = require("./in-a-function.cjs");
console.log(inFunction(), inFunction.member);
