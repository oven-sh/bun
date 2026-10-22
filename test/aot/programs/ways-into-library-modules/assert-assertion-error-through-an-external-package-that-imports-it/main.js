// One name of node:assert is imported and used; another, AssertionError, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { ok } from "node:assert";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["Asserti", "onError"].join("");
const name = ["node:", "assert"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F({ message: "m" }).code));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
