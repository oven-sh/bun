// One name of node:readline is imported and used; another, Interface, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { clearLine } = require("node:readline");
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["Inte", "rface"].join("");
const name = ["node:", "readline"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(typeof F.prototype.question));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
