//#FILE: test-module-builtin.js
//#SHA1: 18114886f66eccc937942a815feca25d9b324a37
//-----------------
"use strict";

const { builtinModules } = require("module");

test("builtinModules includes modules in lib/ (even deprecated ones)", () => {
  expect(builtinModules).toContain("http");
  expect(builtinModules).toContain("sys");
});

test("builtinModules does not include internal modules", () => {
  const internalModules = builtinModules.filter(mod => mod.startsWith("internal/"));
  expect(internalModules).toHaveLength(0);
});

//<#END_FILE: test-module-builtin.js
