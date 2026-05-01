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
var hmr = new FastHMR(1943563621, "multiple-var.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT = true;
  if (globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT)
    ({ foo } = { foo: false });
  var foo;
  function test() {
    console.assert(foo === false, "foo should be false");
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

//# sourceMappingURL=http://localhost:8080/multiple-var.js.map
