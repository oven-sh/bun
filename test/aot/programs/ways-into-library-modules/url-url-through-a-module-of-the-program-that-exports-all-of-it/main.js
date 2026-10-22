// One name of node:url is imported and used; another, Url, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["U", "rl"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(new F().parse("http://host/path").host));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
