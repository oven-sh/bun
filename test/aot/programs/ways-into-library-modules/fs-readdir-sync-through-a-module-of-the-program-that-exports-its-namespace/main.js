// One name of node:fs is imported and used; another, readdirSync, is found through a module of the program that exports its namespace under a name that is put together at run time, and is used too.
import { existsSync } from "node:fs";
import { whole } from "./all.js";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(Array.isArray(F("/"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
