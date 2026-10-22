// One name of node:stream is imported and used, and so is node:zlib, which reads node:stream by names of its own; another, getDefaultHighWaterMark, is found through process.getBuiltinModule under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import { createGzip } from "node:zlib";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
console.log("the other library module:", String(typeof createGzip().pipe));
const key = ["getDefaultH", "ighWaterMark"].join("");
const whole = process.getBuiltinModule("node:stream");
const F = whole[key];
try {
  console.log("the other member:", String(F(false)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
