// One name of node:crypto is imported and used; another, timingSafeEqual, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { randomUUID } from "node:crypto";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["timingS", "afeEqual"].join("");
const name = ["node:", "crypto"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(Buffer.from("a"), Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
