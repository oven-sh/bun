// One name of node:util is imported and used; another, inspect, is found through module.require in a CommonJS file under a name that is put together at run time, and is used too.
const { format } = require("node:util");
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["ins", "pect"].join("");
const name = ["node:", "util"].join("");
const whole = module.require(name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
