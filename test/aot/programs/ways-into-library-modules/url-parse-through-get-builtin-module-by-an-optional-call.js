// One name of node:url is imported and used; another, parse, is found through process.getBuiltinModule, called by an optional chain under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "url"].join("");
const whole = process?.getBuiltinModule?.(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("http://host/path?x=1").pathname));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
