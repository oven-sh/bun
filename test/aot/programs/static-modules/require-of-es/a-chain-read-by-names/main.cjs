// A chain of ES modules, each of which requires the one below at its top and reads its exports by name: there is nothing between them but calls and variables.
// STATISTIC: ModulesWithoutState >= 4
"use strict";
const a = require("./m3.mjs");
console.log(a.f(2), a.f(1));
