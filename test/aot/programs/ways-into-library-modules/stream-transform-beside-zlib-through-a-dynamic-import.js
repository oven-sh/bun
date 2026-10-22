// One name of node:stream is imported and used, and so is node:zlib, which reads node:stream by names of its own; another, Transform, is found through import() of the module's name under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import { createGzip } from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
console.log("the other library module:", String(typeof createGzip().pipe));
const key = ["Tran", "sform"].join("");
const whole = await import("node:stream");
const F = whole[key];
try {
  console.log("the other member:", String(new F({ transform(chunk, encoding, done) { done(); } }).writable));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
