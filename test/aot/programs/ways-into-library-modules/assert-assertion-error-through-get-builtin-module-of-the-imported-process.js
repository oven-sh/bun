// One name of node:assert is imported and used; another, AssertionError, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["Asserti", "onError"].join("");
const name = ["node:", "assert"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F({ message: "m" }).code));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
