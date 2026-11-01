"use strict";
exports.loads = (exports.loads || 0) + 1;
exports.isPlain = function (value) { if (typeof value !== "object" || value === null) return false; const proto = Object.getPrototypeOf(value); return proto === null || proto === Object.prototype; };
