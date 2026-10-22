// One name of node:crypto is imported and used; another, timingSafeEqual, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { randomUUID } from "node:crypto";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["timingS", "afeEqual"].join("");
const name = ["node:", "crypto"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(F(Buffer.from("a"), Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
