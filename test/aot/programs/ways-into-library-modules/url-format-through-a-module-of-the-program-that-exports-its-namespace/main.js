// One name of node:url is imported and used; another, format, is found through a module of the program that exports its namespace under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
import { whole } from "./all.js";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["for", "mat"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F({ protocol: "http", host: "host", pathname: "/p" })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
