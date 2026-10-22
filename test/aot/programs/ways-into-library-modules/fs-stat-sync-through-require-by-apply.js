// One name of node:fs is imported and used; another, statSync, is found through require, called by apply under a name that is put together at run time, and is used too.
import { existsSync } from "node:fs";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["stat", "Sync"].join("");
const name = ["node:", "fs"].join("");
const whole = require.apply(null, [name]);
const F = whole[key];
try {
  console.log("the other member:", String(F("/").isDirectory()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
