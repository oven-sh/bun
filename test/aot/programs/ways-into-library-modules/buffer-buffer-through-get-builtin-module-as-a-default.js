// One name of node:buffer is imported and used; another, Buffer, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
