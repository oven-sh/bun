// A member of the namespace object of node:module is read under a key that is put together at run time and called on the spot. The key picks createRequire.
import * as Module from "node:module";
console.log(typeof Module[["create", "Require"].join("")](import.meta.url)(["node:", "net"].join("")).Socket);
