"use strict";
exports.add = function add(a, b) { return a + b; };
exports.callsAdd = function callsAdd(a, b) { return exports.add(a, b); };
exports.label = "cjs";
