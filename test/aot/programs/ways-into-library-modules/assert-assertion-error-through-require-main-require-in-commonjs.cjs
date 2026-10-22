// One name of node:assert is imported and used; another, AssertionError, is found through require.main.require in a CommonJS file under a name that is put together at run time, and is used too.
const { ok } = require("node:assert");
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["Asserti", "onError"].join("");
const name = ["node:", "assert"].join("");
const whole = require.main.require(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F({ message: "m" }).code));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
