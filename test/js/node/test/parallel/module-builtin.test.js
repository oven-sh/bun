//#FILE: test-module-builtin.js
//#SHA1: 18114886f66eccc937942a815feca25d9b324a37
//-----------------
"use strict";

test("builtinModules", () => {
  const { builtinModules } = require("module");

  // Includes modules in lib/ (even deprecated ones)
  expect(builtinModules).toContain("http");
  expect(builtinModules).toContain("sys");

  // Does not include internal modules
  expect(builtinModules.filter(mod => mod.startsWith("internal/"))).toEqual([]);
});

//<#END_FILE: test-module-builtin.js
