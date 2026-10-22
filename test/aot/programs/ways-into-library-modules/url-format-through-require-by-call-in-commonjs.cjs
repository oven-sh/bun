// One name of node:url is imported and used; another, format, is found through require, called by call, in a CommonJS file under a name that is put together at run time, and is used too.
const { fileURLToPath } = require("node:url");
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["for", "mat"].join("");
const name = ["node:", "url"].join("");
const whole = require.call(null, name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ protocol: "http", host: "host", pathname: "/p" })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
