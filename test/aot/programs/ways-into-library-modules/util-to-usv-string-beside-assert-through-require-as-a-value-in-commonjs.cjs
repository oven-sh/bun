// One name of node:util is imported and used, and so is node:assert, which reads node:util by names of its own; another, toUSVString, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { format } = require("node:util");
const { strictEqual } = require("node:assert");
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
console.log("the other library module:", String(strictEqual(1, 1)));
const key = ["toUSV", "String"].join("");
const name = ["node:", "util"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F("a")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
