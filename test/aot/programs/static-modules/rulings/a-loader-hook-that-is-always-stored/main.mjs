// A store to `Module.prototype.require`. Under `bun run` every later require() goes through the function. In an executable the store succeeds too, and a require() with a constant name
// is the module that the build has found: it asks nobody. The expected output is written down.
import Module from "node:module";
const original = Module.prototype.require;
Module.prototype.require = function (id) {
  console.log("hook", id);
  return original.apply(this, arguments);
};
console.log(require("./a.cjs").x);
