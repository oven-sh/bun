// One name of node:querystring is imported and used; another, parse, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { escape } from "node:querystring";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "querystring"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("a=1&b=2").b));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
