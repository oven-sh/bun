// A member of node:module is read under a key that is put together at run time and called on the spot. The key picks createRequire. The name of the module that is loaded is put together at run time too.
import Module from "node:module";
console.log(typeof Module[["create", "Require"].join("")](import.meta.url)(["node:", "net"].join("")).Socket);
