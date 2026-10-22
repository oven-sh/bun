// One name of node:assert is imported and used; another, deepStrictEqual, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { ok } from "node:assert";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F([1], [1])));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
