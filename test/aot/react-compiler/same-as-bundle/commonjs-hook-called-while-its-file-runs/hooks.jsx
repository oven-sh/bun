// A CommonJS file hands out nothing before its body begins, and what the compiler's output needs stands at the head of the body.
exports.useList = useList;
const { early } = require("./caller.js");

function useList() {
  "use memo";
  return ["kept"];
}

exports.toldEarly = early;
