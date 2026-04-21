"use strict";
exports.typeofThis = (function () {
  return typeof this;
}).call("hello");
