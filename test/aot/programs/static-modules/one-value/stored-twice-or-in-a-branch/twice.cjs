module.exports = function first() {
  return 1;
};
module.exports.member = "on first";
module.exports = function second() {
  return 2;
};
module.exports.other = "on second";
