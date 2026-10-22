// One name of node:zlib is imported and used; another, createGzip, is found through Module.prototype.require under a name that is put together at run time, and is used too.
import { gzipSync } from "node:zlib";
import Module from "node:module";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["creat", "eGzip"].join("");
const name = ["node:", "zlib"].join("");
const whole = Module.prototype.require.call(new Module("x"), name);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F().write));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
