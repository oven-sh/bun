// One name of node:buffer is imported and used; another, Buffer, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { kMaxLength } from "node:buffer";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
