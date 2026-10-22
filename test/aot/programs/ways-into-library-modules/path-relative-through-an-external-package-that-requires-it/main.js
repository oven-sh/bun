// One name of node:path is imported and used; another, relative, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { join } from "node:path";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["rela", "tive"].join("");
const name = ["node:", "path"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b", "/a/c")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
