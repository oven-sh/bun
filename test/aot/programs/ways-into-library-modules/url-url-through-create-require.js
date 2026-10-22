// One name of node:url is imported and used; another, Url, is found through a function made by createRequire under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["U", "rl"].join("");
const name = ["node:", "url"].join("");
const whole = createRequire(import.meta.url)(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().parse("http://host/path").host));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
