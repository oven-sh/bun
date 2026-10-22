// One name of node:assert is imported and used; another, AssertionError, is found through process.getBuiltinModule under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["Asserti", "onError"].join("");
const whole = process.getBuiltinModule("node:assert");
const F = whole[key];
try {
  console.log("the other member:", String(new F({ message: "m" }).code));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
