// One name of node:events is imported and used; another, EventEmitter, is found through module.require in a CommonJS file under a name that is put together at run time, and is used too.
const { once } = require("node:events");
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["EventE", "mitter"].join("");
const name = ["node:", "events"].join("");
const whole = module.require(name);
const F = whole[key];
try {
  console.log("the other member:", String((emitter => (emitter.on("x", value => seen.push(value)), emitter.emit("x", 5), seen.join()))(new F())));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
