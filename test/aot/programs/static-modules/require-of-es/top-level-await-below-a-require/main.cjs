// require() of an ES module with top-level await throws a TypeError.
try {
  require("./m.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
