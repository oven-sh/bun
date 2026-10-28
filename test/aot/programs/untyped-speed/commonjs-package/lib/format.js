"use strict";
var pattern = /%[sdj%]/g;

module.exports.format = function format(template) {
  var args = arguments;
  var at = 1;
  return String(template).replace(pattern, function (token) {
    if (token === "%%") return "%";
    if (at >= args.length) return token;
    switch (token) {
      case "%s":
        return String(args[at++]);
      case "%d":
        return Number(args[at++]);
      default:
        return JSON.stringify(args[at++]);
    }
  });
};
