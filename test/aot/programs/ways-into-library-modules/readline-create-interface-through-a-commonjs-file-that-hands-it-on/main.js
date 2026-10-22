// One name of node:readline is imported and used; another, createInterface, is found through a CommonJS file of the program whose exports object it is under a name that is put together at run time, and is used too.
import { clearLine } from "node:readline";
import whole from "./all.cjs";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["createI", "nterface"].join("");
const F = whole[key];
try {
  console.log("the other member:", String((lines => (lines.close(), lines.closed))(F({ input: new (await import("node:stream")).PassThrough() }))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
