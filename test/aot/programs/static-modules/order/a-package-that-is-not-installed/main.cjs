// A require of a package that is not installed, under a `try` at the top, and a require behind it.
let optional;
try {
  optional = require("a-package-that-is-not-installed");
} catch {
  console.log("not installed");
}
require("./behind.cjs");
