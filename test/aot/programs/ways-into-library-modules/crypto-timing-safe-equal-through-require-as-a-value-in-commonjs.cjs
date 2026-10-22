// One name of node:crypto is imported and used; another, timingSafeEqual, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { randomUUID } = require("node:crypto");
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["timingS", "afeEqual"].join("");
const name = ["node:", "crypto"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F(Buffer.from("a"), Buffer.from("a"))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
