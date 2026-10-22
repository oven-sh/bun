// One name of node:path is imported and used; another, relative, is found through a module of the program that exports its namespace under a name that is put together at run time, and is used too.
import { join } from "node:path";
import { whole } from "./all.js";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["rela", "tive"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b", "/a/c")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
