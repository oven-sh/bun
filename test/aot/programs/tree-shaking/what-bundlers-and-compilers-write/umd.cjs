(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Greeter = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function greet() { return "greeted by a UMD module"; }
  function version() { return "1.0"; }
  return { greet: greet, version: version };
});
