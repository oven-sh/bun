// A require and an import() between statements of an ES module with top-level await keep their place.
console.log(1);
require("./r.cjs");
console.log(2);
await import("./r.cjs");
console.log(3);
