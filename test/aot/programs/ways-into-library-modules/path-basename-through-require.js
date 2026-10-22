// One name of node:path is imported and used; another, basename, is found through require of the module's name under a name that is put together at run time, and is used too.
import { join } from "node:path";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["base", "name"].join("");
const whole = require("node:path");
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b.txt")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
