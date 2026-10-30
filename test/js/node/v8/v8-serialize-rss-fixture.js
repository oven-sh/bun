// Serializes a 1 MiB string 128 times and keeps no result. Prints how much
// the RSS grew, as {"deltaMiB": n}. argv[2] is "node:v8" or "bun:jsc".
const v8 = require("node:v8");
const jsc = require("bun:jsc");

const serialize = process.argv[2] === "node:v8" ? v8.serialize : jsc.serialize;
const value = Buffer.alloc(1 << 20, "a").toString();
for (let i = 0; i < 16; i++) serialize(value);
Bun.gc(true);
const before = process.memoryUsage.rss();
for (let i = 0; i < 128; i++) {
  serialize(value);
  if (i % 8 === 7) Bun.gc(true);
}
Bun.gc(true);
console.log(JSON.stringify({ deltaMiB: Math.round((process.memoryUsage.rss() - before) / 1048576) }));
