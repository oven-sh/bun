// One value of other kinds, each with a member stored behind it: an arrow, a bound function, what a call returns, an array, a string (the store does nothing), null, a Map.
const arrow = require("./arrow.cjs"),
  bound = require("./bound.cjs"),
  made = require("./made.cjs"),
  list = require("./list.cjs"),
  text = require("./text.cjs"),
  map = require("./map.cjs");
console.log(arrow(), arrow.member);
console.log(bound(), bound.member);
console.log(made(), made.member);
console.log(list.length, list.member);
console.log(text, text.member);
console.log(require("./nothing.cjs"));
console.log(map.get("three"), map.member);
