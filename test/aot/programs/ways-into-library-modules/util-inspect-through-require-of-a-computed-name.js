// One name of node:util is imported and used; another, inspect, is found through require of a name that is put together at run time under a name that is put together at run time, and is used too.
import { format } from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["ins", "pect"].join("");
const name = ["node:", "util"].join("");
const whole = require(name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
