// One name of node:zlib is imported and used; another, createGzip, is found through a CommonJS file of the program whose exports object it is under a name that is put together at run time, and is used too.
import { gzipSync } from "node:zlib";
import whole from "./all.cjs";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["creat", "eGzip"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(typeof F().write));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
