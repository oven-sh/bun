// One name of node:http is imported and used; another, validateHeaderName, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { STATUS_CODES } from "node:http";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["validateH", "eaderName"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F("x")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
