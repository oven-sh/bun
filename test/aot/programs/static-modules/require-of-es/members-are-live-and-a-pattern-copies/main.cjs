// The members of a required ES module are live; a pattern copies.
const m = require("./m.mjs"),
  { n } = m;
m.inc();
console.log(m.n, n);
