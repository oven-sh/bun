// One name of node:zlib is imported and used; another, gunzipSync, is found through the default import under a name that is put together at run time, and is used too.
import { gzipSync } from "node:zlib";
import whole from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(gzipSync("a").length > 0));
const key = ["gunzi", "pSync"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F(gzipSync("text")).toString()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
