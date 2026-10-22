// One name of node:buffer is imported and used; another, Buffer, is found through require, bound, in a CommonJS file under a name that is put together at run time, and is used too.
const { kMaxLength } = require("node:buffer");
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
const whole = require.bind(null)(name);
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
