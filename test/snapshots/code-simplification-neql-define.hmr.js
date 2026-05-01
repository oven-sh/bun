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
var hmr = new FastHMR(373889696, "code-simplification-neql-define.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var testFailed = false;
  const invariant = () => {
    testFailed = true;
  };
  var $$m = (arg) => {
    var module = { exports: {} }, exports = module.exports;
    return arg(module, exports);
  };
  var $f332019d = $$m({
    "relay-runtime/lib/network/RelayQueryResponseCache.js": (module, exports) => {
      var RelayQueryResponseCache = function() {
        var foo = function RelayQueryResponseCache(_ref) {
          var size = _ref.size, ttl = _ref.ttl;
          !(size > 0) && invariant(false, "RelayQueryResponseCache: Expected the max cache size to be > 0, got `%s`.", size);
          !(ttl > 0) && invariant(false, "RelayQueryResponseCache: Expected the max ttl to be > 0, got `%s`.", ttl);
        };
        foo({ size: 100, ttl: 3600 });
      };
      RelayQueryResponseCache();
    }
  }["relay-runtime/lib/network/RelayQueryResponseCache.js"]);
  function test() {
    var foo = () => result;
    if (testFailed)
      throw new Error("invariant should not be called");
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    $f332019d: () => $f332019d,
    test: () => test
  });
})();
var $$hmr_$f332019d = hmr.exports.$f332019d, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_$f332019d = exports.$f332019d;
  $$hmr_test = exports.test;
};

export {
  $$hmr_$f332019d as $f332019d,
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:8080/code-simplification-neql-define.js.map
