// One name of node:stream is imported and used, and so is node:zlib, which reads node:stream by names of its own; another, isReadable, is found through the entries of a namespace import under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import { createGzip } from "node:zlib";
import * as space from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
console.log("the other library module:", String(typeof createGzip().pipe));
const key = ["isRea", "dable"].join("");
const whole = Object.fromEntries(Object.entries(space));
const F = whole[key];
try {
  console.log("the other member:", String(F(null)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
