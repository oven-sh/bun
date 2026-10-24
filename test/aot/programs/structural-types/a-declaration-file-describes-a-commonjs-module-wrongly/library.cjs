exports.count = "7";
exports.twice = function (n) {
  return [n, n];
};
exports.settings = { depth: "deep" };
Object.defineProperty(exports, "lazy", {
  enumerable: true,
  get() {
    exports.reads = (exports.reads || 0) + 1;
    return exports.reads % 2 ? 1 : "one";
  },
});
exports.Dog = function Dog() {
  this.paws = 4;
};
exports.later = undefined;
exports.fill = function () {
  exports.later = "filled";
  exports.count = null;
};
