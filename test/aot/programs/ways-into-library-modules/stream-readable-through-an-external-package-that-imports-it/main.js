// One name of node:stream is imported and used; another, Readable, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { finished } from "node:stream";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["Read", "able"].join("");
const name = ["node:", "stream"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String((await F.from(["a", "b"]).toArray()).join()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
