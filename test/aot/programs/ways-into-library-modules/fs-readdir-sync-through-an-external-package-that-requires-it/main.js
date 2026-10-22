// One name of node:fs is imported and used; another, readdirSync, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { existsSync } from "node:fs";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const name = ["node:", "fs"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(Array.isArray(F("/"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
