// One name of node:fs is imported and used; another, statSync, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { existsSync } = require("node:fs");
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["stat", "Sync"].join("");
const name = ["node:", "fs"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F("/").isDirectory()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
