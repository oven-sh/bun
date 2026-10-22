// One name of node:readline is imported and used; another, Interface, is found through a namespace import under a name that is put together at run time, and is used too.
import { clearLine } from "node:readline";
import * as whole from "node:readline";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["Inte", "rface"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(typeof F.prototype.question));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
