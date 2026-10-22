// One name of node:util is imported and used; another, promisify, is found through process.getBuiltinModule, called by an optional chain under a name that is put together at run time, and is used too.
import { format } from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["prom", "isify"].join("");
const name = ["node:", "util"].join("");
const whole = process?.getBuiltinModule?.(name);
const F = whole[key];
try {
  console.log("the other member:", String(await F(callback => callback(null, 5))()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
