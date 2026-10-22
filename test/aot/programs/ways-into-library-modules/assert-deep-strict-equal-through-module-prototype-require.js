// One name of node:assert is imported and used; another, deepStrictEqual, is found through Module.prototype.require under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
import Module from "node:module";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const name = ["node:", "assert"].join("");
const whole = Module.prototype.require.call(new Module("x"), name);
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
