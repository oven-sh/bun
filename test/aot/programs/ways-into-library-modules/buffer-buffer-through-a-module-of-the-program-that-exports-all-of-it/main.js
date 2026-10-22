// One name of node:buffer is imported and used; another, Buffer, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
