Object.defineProperty(exports, "a", {
  value: 1,
  enumerable: false,
});
exports.b = 2;
let fn = function () {
  return 3;
};
// Node doesn't support non-enumerable getters/setters
Object.defineProperty(exports, "c", {
  get: fn,
  enumerable: false,
});
