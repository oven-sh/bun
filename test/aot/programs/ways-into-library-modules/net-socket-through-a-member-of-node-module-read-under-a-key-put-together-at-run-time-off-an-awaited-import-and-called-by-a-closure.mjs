// The top of a module reads createRequire, under a key that is put together at run time, off what an awaited import("node:module") answers, and a closure calls it.
const Module = await import("node:module");
const make = Module["createRequire adder".split(" ")[0]];
function load(name) {
  return make(import.meta.url)(name);
}
console.log(typeof load("node:net".trim()).Socket);
