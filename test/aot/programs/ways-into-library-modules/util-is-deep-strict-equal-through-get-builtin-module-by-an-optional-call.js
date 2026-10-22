// One name of node:util is imported and used; another, isDeepStrictEqual, is found through process.getBuiltinModule, called by an optional chain under a name that is put together at run time, and is used too.
import { format } from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["isDeepSt", "rictEqual"].join("");
const name = ["node:", "util"].join("");
const whole = process?.getBuiltinModule?.(name);
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
