// A statement in front of a require sees the world as it was before the module ran, even a statement that could be removed if nobody used it. An argument in front of a require in one call runs first.
const before = typeof flag;
require("./sets-flag.cjs");
console.log(before);
console.log(0);
require("./a.cjs");
console.log(1);
require("./b.cjs");
function bar() {
  console.log("bar");
}
function foo() {}
foo(bar(), require("./x.cjs"));
