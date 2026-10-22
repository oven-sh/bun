// One name of node:path is imported and used; another, basename, is found through process.getBuiltinModule, taken by a destructuring pattern under a name that is put together at run time, and is used too.
import { join } from "node:path";
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["base", "name"].join("");
const name = ["node:", "path"].join("");
const { getBuiltinModule } = process;
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b.txt")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
