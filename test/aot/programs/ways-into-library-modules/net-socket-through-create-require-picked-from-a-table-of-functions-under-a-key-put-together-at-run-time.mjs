// A table holds createRequire beside a function of the program. A function reads the table under a key that is put together at run time, and what it returns is called. The name of the module that is loaded is put together at run time too.
import { createRequire } from "node:module";
const table = { createRequire, adder: a => b => a + b };
const pick = name => table[name];
console.log(typeof pick(["create", "Require"].join(""))(import.meta.url)(["node:", "net"].join("")).Socket);
console.log(pick(["add", "er"].join(""))(1)(2));
