// One name of node:fs is imported and used; another, readdirSync, is found through process.getBuiltinModule of a name that is put together at run time under a name that is put together at run time, and is used too.
import { existsSync } from "node:fs";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const name = ["node:", "fs"].join("");
const whole = process.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(Array.isArray(F("/"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
