// https://github.com/oven-sh/bun/issues/31806
//
// A function-level "use strict" directive must keep that function body in strict mode even when the
// enclosing module is CommonJS (which Bun compiles as a sloppy Program). This mirrors Bluebird's
// ES5 feature detection, which breaks when the directive is dropped.

const thisIsUndefined = (function () {
  "use strict";
  return this === undefined;
})();

if (!thisIsUndefined) {
  throw new Error("function-level 'use strict' not honored: expected `this` to be undefined");
}

function assignUndeclared() {
  "use strict";
  // Assigning to an undeclared binding must throw ReferenceError in strict mode.
  undeclaredGlobal31806 = 5;
}

let threwReferenceError = false;
try {
  assignUndeclared();
} catch (e) {
  threwReferenceError = e instanceof ReferenceError;
}

if (!threwReferenceError) {
  throw new Error("function-level 'use strict' not honored: undeclared assignment did not throw");
}

module.exports = {};
