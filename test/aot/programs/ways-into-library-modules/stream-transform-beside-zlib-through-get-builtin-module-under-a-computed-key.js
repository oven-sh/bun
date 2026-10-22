// One name of node:stream is imported and used, and so is node:zlib, which reads node:stream by names of its own; another, Transform, is found through process.getBuiltinModule, found under a key that is put together at run time under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import { createGzip } from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
console.log("the other library module:", String(typeof createGzip().pipe));
const key = ["Tran", "sform"].join("");
const name = ["node:", "stream"].join("");
const loader = ["get", "Builtin", "Module"].join("");
const whole = process[loader](name);
const F = whole[key];
try {
  console.log("the other member:", String(new F({ transform(chunk, encoding, done) { done(); } }).writable));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
