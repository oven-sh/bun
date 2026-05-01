import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);
import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
var hmr = new HMR(3305050967, "ts-fallback-rewrite-works.ts"), exports = hmr.exports;
(hmr._load = function() {
  function test() {
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

//# sourceMappingURL=http://localhost:8080/ts-fallback-rewrite-works.js.map
