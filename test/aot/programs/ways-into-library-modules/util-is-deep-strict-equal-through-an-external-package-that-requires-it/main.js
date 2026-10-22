// One name of node:util is imported and used; another, isDeepStrictEqual, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { format } from "node:util";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["isDeepSt", "rictEqual"].join("");
const name = ["node:", "util"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
