// One name of node:path is imported and used; another, basename, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { join } from "node:path";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["base", "name"].join("");
const name = ["node:", "path"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b.txt")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
