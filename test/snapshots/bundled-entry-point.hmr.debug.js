import {
__require as require_ab102cbd93061951
} from "http://localhost:8080/bun:wrap";
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
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var hmr = new FastHMR(173057717, "bundled-entry-point.js", FastRefresh), exports = hmr.exports;
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

//# sourceMappingURL=http://localhost:8080/bundled-entry-point.js.map
