// One name of node:assert is imported and used; another, deepStrictEqual, is found through process.getBuiltinModule, found under a key that is put together at run time under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const name = ["node:", "assert"].join("");
const loader = ["get", "Builtin", "Module"].join("");
const whole = process[loader](name);
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
