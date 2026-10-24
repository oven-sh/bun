exports.first = function (n) {
  return n - 1;
};

exports.second = function (n) {
  return { n };
};

Object.defineProperty(exports, "hidden", {
  value: function (n) {
    return "hidden " + n;
  },
});
