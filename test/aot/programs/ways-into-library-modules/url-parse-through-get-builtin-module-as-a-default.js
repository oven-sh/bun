// One name of node:url is imported and used; another, parse, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "url"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(F("http://host/path?x=1").pathname));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
