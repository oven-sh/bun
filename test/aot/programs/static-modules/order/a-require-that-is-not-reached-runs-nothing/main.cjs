// A require in a branch that is not taken and one in a function that is not called run nothing.
if (process.argv.length > 99) require("./a.cjs");
function later() {
  return require("./a.cjs");
}
globalThis.later = later;
console.log("end");
