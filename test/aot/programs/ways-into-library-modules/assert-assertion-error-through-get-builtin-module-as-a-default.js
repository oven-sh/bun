// One name of node:assert is imported and used; another, AssertionError, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["Asserti", "onError"].join("");
const name = ["node:", "assert"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(new F({ message: "m" }).code));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
