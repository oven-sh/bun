"use strict";
exports.hash = function hash(value) {
  value = ((value >>> 16) ^ value) * 0x45d9f3b;
  value = ((value >>> 16) ^ value) * 0x45d9f3b;
  return ((value >>> 16) ^ value) >>> 0;
};

exports.isObject = function (value) {
  return value !== null && typeof value === "object";
};

exports.defaults = function (target, source) {
  Object.keys(source).forEach(function (key) {
    if (target[key] === undefined) target[key] = source[key];
  });
  return target;
};
