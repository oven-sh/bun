// One name of node:path is imported and used; another, relative, is found through the entries of a namespace import under a name that is put together at run time, and is used too.
import { join } from "node:path";
import * as space from "node:path";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["rela", "tive"].join("");
const whole = Object.fromEntries(Object.entries(space));
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b", "/a/c")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
