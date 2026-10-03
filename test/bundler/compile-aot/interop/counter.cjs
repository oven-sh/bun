exports.value = 0;
exports.label = "counter";
exports.bump = function () {
  return ++exports.value;
};
exports.set = function (name, value) {
  exports[name] = value;
};
exports.remove = function (name) {
  delete exports[name];
};
exports.define = function (name, descriptor) {
  Object.defineProperty(exports, name, descriptor);
};
exports.later = undefined;
