// One name of node:stream is imported and used, and so is node:zlib, which reads node:stream by names of its own; another, getDefaultHighWaterMark, is found through require, bound, in a CommonJS file under a name that is put together at run time, and is used too.
const { finished } = require("node:stream");
const { createGzip } = require("node:zlib");
const seen = [];
console.log("the name that is imported:", String(typeof finished));
console.log("the other library module:", String(typeof createGzip().pipe));
const key = ["getDefaultH", "ighWaterMark"].join("");
const name = ["node:", "stream"].join("");
const whole = require.bind(null)(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(false)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
