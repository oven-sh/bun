// This behavior is required for Next.js to work
const eql = require("assert").deepStrictEqual;
const Module = require("module");

const old = Module.prototype.require;
Module.prototype.require = function (str) {
  if (str === "hook") return "winner";
  return {
    wrap: old.call(this, str),
  };
};

// this context has the new require
const result = require("./modulePrototypeOverwrite-fixture.cjs");
eql(result, { wrap: "winner" });

console.log("--pass--");
