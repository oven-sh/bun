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
var hmr = new FastHMR(483885974, "forbid-in-is-correct.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var foo = () => {
    var D = (i, r) => () => (r || i((r = { exports: {} }).exports, r), r.exports);
    return D;
  };
  function test() {
    foo();
    testDone(import.meta.url);
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

//# sourceMappingURL=http://localhost:8080/forbid-in-is-correct.js.map
