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
var hmr = new FastHMR(2720826654, "void-shouldnt-delete-call-expressions.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var was_called = false;
  function thisShouldBeCalled() {
    was_called = true;
  }
  thisShouldBeCalled();
  function test() {
    if (!was_called)
      throw new Error("Expected thisShouldBeCalled to be called");
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

//# sourceMappingURL=http://localhost:8080/void-shouldnt-delete-call-expressions.js.map
