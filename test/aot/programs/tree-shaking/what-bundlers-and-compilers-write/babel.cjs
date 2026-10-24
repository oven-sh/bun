"use strict";
function _getRequireWildcardCache(nodeInterop) {
  if (typeof WeakMap !== "function") return null;
  var cache = new WeakMap();
  return (_getRequireWildcardCache = function () { return cache; })(nodeInterop);
}
function _interopRequireWildcard(obj, nodeInterop) {
  if (!nodeInterop && obj && obj.__esModule) return obj;
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return { default: obj };
  var cache = _getRequireWildcardCache(nodeInterop);
  if (cache && cache.has(obj)) return cache.get(obj);
  var newObj = {};
  var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
  for (var key in obj) {
    if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
      var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
      if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key, desc);
      else newObj[key] = obj[key];
    }
  }
  newObj.default = obj;
  if (cache) cache.set(obj, newObj);
  return newObj;
}
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
var wildcard = _interopRequireWildcard(require("./typescript-source.cjs"));
var _default = _interopRequireDefault(require("./umd.cjs"));
module.exports = function () { return (0, wildcard.viaImportStar)() + ", " + _default.default.greet(); };
