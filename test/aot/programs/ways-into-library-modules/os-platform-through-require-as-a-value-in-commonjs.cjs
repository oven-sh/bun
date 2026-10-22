// One name of node:os is imported and used; another, platform, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { EOL } = require("node:os");
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["plat", "form"].join("");
const name = ["node:", "os"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(typeof F()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
