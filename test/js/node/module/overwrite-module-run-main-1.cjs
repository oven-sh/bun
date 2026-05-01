const Module = require("module");
const old = Module.runMain;
Module.runMain = (...args) => {
  process.stdout.write("pa");
  return old(...args);
};
