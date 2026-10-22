// One name of node:url is imported and used; another, parse, is found through a function made by createRequire, bound under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "url"].join("");
const whole = createRequire(import.meta.url).bind(null)(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("http://host/path?x=1").pathname));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
