// One name of node:querystring is imported and used; another, parse, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { escape } = require("node:querystring");
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "querystring"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F("a=1&b=2").b));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
