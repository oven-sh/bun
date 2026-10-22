// One name of node:stream is imported and used; another, Readable, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { finished } from "node:stream";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["Read", "able"].join("");
const F = whole[key];
try {
  console.log("the other member:", String((await F.from(["a", "b"]).toArray()).join()));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
