// One name of node:net is imported and used; another, isIPv6, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { isIP } from "node:net";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["isI", "Pv6"].join("");
const name = ["node:", "net"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(F("::1")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
