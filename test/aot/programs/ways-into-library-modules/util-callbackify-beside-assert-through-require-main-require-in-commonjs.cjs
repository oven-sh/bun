// One name of node:util is imported and used, and so is node:assert, which reads node:util by names of its own; another, callbackify, is found through require.main.require in a CommonJS file under a name that is put together at run time, and is used too.
const { format } = require("node:util");
const { strictEqual } = require("node:assert");
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
console.log("the other library module:", String(strictEqual(1, 1)));
const key = ["callb", "ackify"].join("");
const name = ["node:", "util"].join("");
const whole = require.main.require(name);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F(async () => 1)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
