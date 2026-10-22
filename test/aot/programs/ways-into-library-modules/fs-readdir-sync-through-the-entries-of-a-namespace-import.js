// One name of node:fs is imported and used; another, readdirSync, is found through the entries of a namespace import under a name that is put together at run time, and is used too.
import { existsSync } from "node:fs";
import * as space from "node:fs";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const whole = Object.fromEntries(Object.entries(space));
const F = whole[key];
try {
  console.log("the other member:", String(Array.isArray(F("/"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
