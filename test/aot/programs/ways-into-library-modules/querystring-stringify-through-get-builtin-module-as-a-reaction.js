// One name of node:querystring is imported and used; another, stringify, is found through process.getBuiltinModule, handed to then under a name that is put together at run time, and is used too.
import { escape } from "node:querystring";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join("");
const name = ["node:", "querystring"].join("");
const whole = await Promise.resolve(name).then(process.getBuiltinModule);
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
