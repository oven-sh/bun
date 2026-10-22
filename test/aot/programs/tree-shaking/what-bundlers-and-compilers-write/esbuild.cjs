var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() { return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res; };
var __commonJS = (cb, mod) => function __require() { return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };

var require_old = __commonJS({
  "src/old.js"(exports, module) {
    function helper() { return "helper of old.js"; }
    module.exports = { run: function () { return helper(); } };
  },
});
var new_exports = {};
__export(new_exports, { run: () => run });
function run() { return prefix + "new.js"; }
var prefix;
var init_new = __esm({ "src/new.js"() { prefix = "initialized "; } });

module.exports = function () {
  init_new();
  return require_old().run() + ", " + new_exports.run();
};
