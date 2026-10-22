function make() {
  return function made() {
    return "made";
  };
}
module.exports = make();
module.exports.member = 3;
