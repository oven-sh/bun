"use strict";
const api = { add(a, b) { return a + b; }, callsAdd(a, b) { return api.add(a, b); } };
module.exports = api;
