// One name of node:querystring is imported and used; another, stringify, is found through require, called by call, in a CommonJS file under a name that is put together at run time, and is used too.
const { escape } = require("node:querystring");
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join("");
const name = ["node:", "querystring"].join("");
const whole = require.call(null, name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
