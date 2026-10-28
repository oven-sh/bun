// A function reads createRequire, under a key that is put together at run time, off a constant that the top of the module sets to what an awaited import("node:module") answers, and hands it on.
const Module = await import("node:module");
function pick(key) {
  return Module[key];
}
function call(make, name) {
  return make(import.meta.url)(name);
}
console.log(typeof call(pick("createRequire adder".split(" ")[0]), "node:net".trim()).Socket);
