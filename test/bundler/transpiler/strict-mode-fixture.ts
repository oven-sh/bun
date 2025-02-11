"use strict";

function checkThis() {
  if (this !== undefined) {
    throw new Error("this is not undefined");
  }
}

checkThis();

module.exports = {
  FORCE_COMMON_JS: true,
};
