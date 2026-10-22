// One name of node:assert is imported and used; another, deepStrictEqual, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { ok } from "node:assert";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const name = ["node:", "assert"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
