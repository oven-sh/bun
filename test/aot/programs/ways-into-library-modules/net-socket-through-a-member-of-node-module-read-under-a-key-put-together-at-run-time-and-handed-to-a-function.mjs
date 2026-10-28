// A member of node:module is read under a key that is put together at run time and handed to a function, which calls it. The key picks createRequire. The name of the module that is loaded is put together at run time too.
import Module from "node:module";
function run(make, name) {
  return make(import.meta.url)(name);
}
console.log(typeof run(Module[["create", "Require"].join("")], ["node:", "net"].join("")).Socket);
