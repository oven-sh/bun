// One name of node:crypto is imported and used; another, createHash, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { randomUUID } from "node:crypto";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["creat", "eHash"].join("");
const name = ["node:", "crypto"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("sha1").update("a").digest("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
