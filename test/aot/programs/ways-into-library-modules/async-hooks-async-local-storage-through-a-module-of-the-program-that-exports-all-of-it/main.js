// One name of node:async_hooks is imported and used; another, AsyncLocalStorage, is found through a module of the program that exports all of it again under a name that is put together at run time, and is used too.
import { executionAsyncId } from "node:async_hooks";
import * as whole from "./all.js";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncLoc", "alStorage"].join("");
const F = whole[key];
try {
  console.log("the other member:", String((storage => storage.run(5, () => storage.getStore()))(new F())));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
