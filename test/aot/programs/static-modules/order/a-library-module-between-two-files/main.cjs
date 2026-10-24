// A require of one of Bun's own modules between two requires of files: each stays where it stands.
console.log(1);
const a = require("./a.cjs");
const util = require("node:util");
const b = require("./b.cjs");
console.log(util.format("%s %s", a.name, b.name));
