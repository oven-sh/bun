// A store to an export of a required ES module, and a store of a new name, throw in strict code.
"use strict";
const m = require("./m.mjs"),
  attempt = store => {
    try {
      store();
      return "stored";
    } catch (error) {
      return error.constructor.name;
    }
  };
console.log(
  attempt(() => {
    m.a = 2;
  }),
  attempt(() => {
    m.extra = 1;
  }),
);
