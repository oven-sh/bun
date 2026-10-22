// One name of node:crypto is imported and used; another, createHash, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { randomUUID } from "node:crypto";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["creat", "eHash"].join("");
const name = ["node:", "crypto"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("sha1").update("a").digest("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
