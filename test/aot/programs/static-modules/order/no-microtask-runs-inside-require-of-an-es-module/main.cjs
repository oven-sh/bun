// No job of the program runs inside require() of an ES module.
Promise.resolve().then(() => console.log("earlier"));
require("./m.mjs");
console.log("after");
