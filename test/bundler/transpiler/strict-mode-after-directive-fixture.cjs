"use client";
"use strict";

function checkThis() {
  if (this !== undefined) {
    throw new Error("this is not undefined");
  }
}

checkThis();
console.log("strict");

module.exports = {
  FORCE_COMMON_JS: true,
};
