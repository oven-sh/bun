// One name of node:fs is imported and used; another, statSync, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { existsSync } from "node:fs";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["stat", "Sync"].join("");
const name = ["node:", "fs"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("/").isDirectory()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
