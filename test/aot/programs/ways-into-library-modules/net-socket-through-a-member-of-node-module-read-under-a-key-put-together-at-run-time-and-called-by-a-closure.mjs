// A member of node:module is read under a key that is put together at run time and kept in a constant. A function declared beside it calls the constant. The key picks createRequire. The name of the module that is loaded is put together at run time too.
import Module from "node:module";
const make = Module[["create", "Require"].join("")];
function load(name) {
  return make(import.meta.url)(name);
}
console.log(typeof load(["node:", "net"].join("")).Socket);
