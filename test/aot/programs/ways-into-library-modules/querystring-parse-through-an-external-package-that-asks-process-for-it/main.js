// One name of node:querystring is imported and used; another, parse, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { escape } from "node:querystring";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "querystring"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("a=1&b=2").b));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
