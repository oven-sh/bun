// One name of node:zlib is imported and used; another, createGzip, is found through require, called by call, in a CommonJS file under a name that is put together at run time, and is used too.
const { gzipSync } = require("node:zlib");
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["creat", "eGzip"].join("");
const name = ["node:", "zlib"].join("");
const whole = require.call(null, name);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F().write));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
