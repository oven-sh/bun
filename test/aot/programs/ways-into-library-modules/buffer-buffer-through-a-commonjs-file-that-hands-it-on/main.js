// One name of node:buffer is imported and used; another, Buffer, is found through a CommonJS file of the program whose exports object it is under a name that is put together at run time, and is used too.
import { kMaxLength } from "node:buffer";
import whole from "./all.cjs";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F.from("a").toString("hex")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
