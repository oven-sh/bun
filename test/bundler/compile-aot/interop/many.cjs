for (let i = 0; i < 120; i++) exports["name" + i] = i;
exports.change = function (i, value) {
  exports["name" + i] = value;
};
