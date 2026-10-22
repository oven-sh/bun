// One name of node:assert is imported and used; another, deepStrictEqual, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { ok } = require("node:assert");
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const name = ["node:", "assert"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
