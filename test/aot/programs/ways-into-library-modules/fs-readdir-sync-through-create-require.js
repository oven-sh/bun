// One name of node:fs is imported and used; another, readdirSync, is found through a function made by createRequire under a name that is put together at run time, and is used too.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const name = ["node:", "fs"].join("");
const whole = createRequire(import.meta.url)(name);
const F = whole[key];
try {
  console.log("the other member:", String(Array.isArray(F("/"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
