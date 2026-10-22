// One name of node:stream is imported and used; another, PassThrough, is found through process.getBuiltinModule, stored in an object of the program under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["PassT", "hrough"].join("");
const name = ["node:", "stream"].join("");
const whole = { load: process.getBuiltinModule }.load(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().writable));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
