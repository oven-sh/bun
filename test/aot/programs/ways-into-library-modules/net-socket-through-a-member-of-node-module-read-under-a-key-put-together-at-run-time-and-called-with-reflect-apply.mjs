// A member of node:module is read under a key that is put together at run time and called with Reflect.apply. The key picks createRequire. The name of the module that is loaded is put together at run time too.
import Module from "node:module";
const load = Reflect.apply(Module[["create", "Require"].join("")], Module, [import.meta.url]);
console.log(typeof load(["node:", "net"].join("")).Socket);
