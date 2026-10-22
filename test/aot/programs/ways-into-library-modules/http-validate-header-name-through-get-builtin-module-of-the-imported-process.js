// One name of node:http is imported and used; another, validateHeaderName, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { STATUS_CODES } from "node:http";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["validateH", "eaderName"].join("");
const name = ["node:", "http"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("x")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
