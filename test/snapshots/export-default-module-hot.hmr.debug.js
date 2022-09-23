import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(true);
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
var hmr = new FastHMR(2073254346, "export-default-module-hot.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var export_default_module_hot_default = typeof module !== "undefined" && module.id;
  function test() {
    testDone(import.meta.url);
  }
  hmr.exportAll({
    default: () => export_default_module_hot_default,
    test: () => test
  });
})();
var $$hmr_default = hmr.exports.default, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_default = exports.default;
  $$hmr_test = exports.test;
};

export {
  $$hmr_default as default,
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:8080/export-default-module-hot.js.map
