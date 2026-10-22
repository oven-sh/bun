// One name of node:crypto is imported and used; another, createHash, is found through process.getBuiltinModule, stored in an object of the program under a name that is put together at run time, and is used too.
import { randomUUID } from "node:crypto";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["creat", "eHash"].join("");
const name = ["node:", "crypto"].join("");
const whole = { load: process.getBuiltinModule }.load(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("sha1").update("a").digest("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
