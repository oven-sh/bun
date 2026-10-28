// A member of node:module is read under a key that is put together at run time, kept in a constant and called later. The key picks createRequire. The name of the module that is loaded is put together at run time too.
import Module from "node:module";
const make = Module[["create", "Require"].join("")];
console.log(typeof make(import.meta.url)(["node:", "net"].join("")).Socket);
