// One name of node:stream is imported and used; another, PassThrough, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { finished } from "node:stream";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["PassT", "hrough"].join("");
const name = ["node:", "stream"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().writable));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
