// One name of node:crypto is imported and used; another, timingSafeEqual, is found through a namespace import under a name that is put together at run time, and is used too.
import { randomUUID } from "node:crypto";
import * as whole from "node:crypto";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["timingS", "afeEqual"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F(Buffer.from("a"), Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
