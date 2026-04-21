exports.isES5 = (function () {
  "use strict";
  return this === undefined;
})();

exports.typeofThis = (function () {
  "use strict";
  return typeof this;
}).call("hello");

exports.mode = (function () {
  "use strict";
  // Unique sentinel so an earlier test can't poison the result by
  // leaking a reachable global named `undeclared`.
  delete globalThis.__issue29533_sentinel__;
  try {
    __issue29533_sentinel__ = 1;
    delete globalThis.__issue29533_sentinel__;
    return "sloppy";
  } catch (e) {
    return "strict";
  }
})();
