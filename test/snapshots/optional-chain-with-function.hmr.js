import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
var hmr = new FastHMR(2145684817, "optional-chain-with-function.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  function test() {
    try {
      const ratings = ["123"];
      var bar = undefined?.map((value) => false);
      bar = bar?.multipleSecondaryValues?.map((value) => false);
      bar = bar?.bar?.multipleSecondaryValues?.map((value) => false);
      bar = {}?.bar?.multipleSecondaryValues?.map((value) => false);
    } catch (e) {
      throw e;
    }
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

//# sourceMappingURL=http://localhost:8080/optional-chain-with-function.js.map
