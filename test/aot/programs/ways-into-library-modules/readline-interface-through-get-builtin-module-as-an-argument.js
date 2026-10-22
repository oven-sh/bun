// One name of node:readline is imported and used; another, Interface, is found through process.getBuiltinModule, handed to a function of the program under a name that is put together at run time, and is used too.
import { clearLine } from "node:readline";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["Inte", "rface"].join("");
const name = ["node:", "readline"].join("");
const whole = (load => load(name))(process.getBuiltinModule);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F.prototype.question));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
