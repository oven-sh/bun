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
import pkg from "http://localhost:8080/utf8-package-json.json";
var hmr = new FastHMR(3383656110, "package-json-utf8.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    console.assert(!!pkg.author);
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    test: () => test
  });
})();
var $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_test = exports.test;
};

export {
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:8080/package-json-utf8.js.map
