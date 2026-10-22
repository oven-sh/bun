// One name of node:util is imported and used, and so is node:assert, which reads node:util by names of its own; another, parseArgs, is found through process.getBuiltinModule, taken by a destructuring pattern under a name that is put together at run time, and is used too.
import { format } from "node:util";
import { strictEqual } from "node:assert";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
console.log("the other library module:", String(strictEqual(1, 1)));
const key = ["pars", "eArgs"].join("");
const name = ["node:", "util"].join("");
const { getBuiltinModule } = process;
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } }).values.a));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
