// One name of node:net is imported and used; another, isIPv6, is found through a CommonJS file of the program whose exports object it is under a name that is put together at run time, and is used too.
import { isIP } from "node:net";
import whole from "./all.cjs";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["isI", "Pv6"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F("::1")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
