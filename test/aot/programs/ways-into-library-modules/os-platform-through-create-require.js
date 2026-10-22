// One name of node:os is imported and used; another, platform, is found through a function made by createRequire under a name that is put together at run time, and is used too.
import { EOL } from "node:os";
import { createRequire } from "node:module";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["plat", "form"].join("");
const name = ["node:", "os"].join("");
const whole = createRequire(import.meta.url)(name);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
