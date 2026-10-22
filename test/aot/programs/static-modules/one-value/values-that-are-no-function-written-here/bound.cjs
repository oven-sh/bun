module.exports = function () {
  return this.value;
}.bind({ value: "bound" });
module.exports.member = 2;
