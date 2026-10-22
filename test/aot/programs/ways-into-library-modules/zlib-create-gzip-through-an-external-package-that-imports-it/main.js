// One name of node:zlib is imported and used; another, createGzip, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { gzipSync } from "node:zlib";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["creat", "eGzip"].join("");
const name = ["node:", "zlib"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F().write));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
