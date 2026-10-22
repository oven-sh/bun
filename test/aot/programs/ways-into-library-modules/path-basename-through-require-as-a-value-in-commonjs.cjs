// One name of node:path is imported and used; another, basename, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { join } = require("node:path");
const seen = [];
console.log("the name that is imported:", String(join("a", "b")));
const key = ["base", "name"].join("");
const name = ["node:", "path"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F("/a/b.txt")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
