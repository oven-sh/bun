// One name of node:querystring is imported and used; another, stringify, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { escape } from "node:querystring";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join("");
const name = ["node:", "querystring"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
