// One name of node:stream is imported and used; another, PassThrough, is found through process.getBuiltinModule, handed to Array.prototype.map under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["PassT", "hrough"].join("");
const name = ["node:", "stream"].join("");
const whole = [name].map(process.getBuiltinModule)[0];
const F = whole[key];
try {
  console.log("the other member:", String(new F().writable));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
