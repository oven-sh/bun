var __webpack_modules__ = {
  10: function (module, exports, __webpack_require__) {
    var other = __webpack_require__(20);
    module.exports = function () { return "module 10, " + other.name() + ", " + other.default(); };
  },
  20: function (module, __webpack_exports__, __webpack_require__) {
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, { default: function () { return __WEBPACK_DEFAULT_EXPORT__; }, name: function () { return name; } });
    function name() { return "module 20"; }
    function __WEBPACK_DEFAULT_EXPORT__() { return "its default"; }
  },
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cached = __webpack_module_cache__[moduleId];
  if (cached !== undefined) return cached.exports;
  var module = (__webpack_module_cache__[moduleId] = { exports: {} });
  __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
  return module.exports;
}
__webpack_require__.d = function (exports, definition) {
  for (var key in definition) if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
};
__webpack_require__.o = function (object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
__webpack_require__.r = function (exports) { Object.defineProperty(exports, "__esModule", { value: true }); };
module.exports = __webpack_require__(10);
