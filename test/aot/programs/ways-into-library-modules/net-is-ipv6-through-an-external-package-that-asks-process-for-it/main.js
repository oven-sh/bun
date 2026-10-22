// One name of node:net is imported and used; another, isIPv6, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { isIP } from "node:net";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["isI", "Pv6"].join("");
const name = ["node:", "net"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("::1")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
