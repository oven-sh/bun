// One name of node:querystring is imported and used; another, stringify, is found through a namespace import under a name that is put together at run time, and is used too.
import { escape } from "node:querystring";
import * as whole from "node:querystring";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F({ a: 1 })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
