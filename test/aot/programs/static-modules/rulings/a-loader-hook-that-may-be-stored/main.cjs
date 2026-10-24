// A store to `Module.prototype.require` from sloppy code. Under `bun run` every later require() goes through the function. In an executable the store succeeds too,
// and a require() with a constant name is the module that the build has found: it asks nobody. The expected output is written down.
const Module = require("node:module");
const original = Module.prototype.require;
if (process.argv.length < 99) {
  try {
    Module.prototype.require = function (id) {
      console.log("hook", id);
      return original.apply(this, arguments);
    };
    console.log("nothing thrown");
  } catch {
    console.log("thrown");
  }
}
console.log(require("./a.cjs").x);
