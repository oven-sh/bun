import {
__require
} from "http://localhost:8080/bun:wrap";
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
import * as $a4de9925 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/index.js";
var InexactRoot = __require($a4de9925);
import * as $725c641 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/dir/file.js";
var InexactFile = __require($725c641);
import * as $fbe61cb7 from "http://localhost:8080/package-json-exports/node_modules/inexact/browser/foo.js";
var ExactFile = __require($fbe61cb7);
import * as $6a256e60 from "http://localhost:8080/package-json-exports/node_modules/js-only-exports/browser/js-file.js";
var JSFileExtensionOnly = __require($6a256e60);
var hmr = new FastHMR(879772149, "package-json-exports/index.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  async function test() {
    console.assert(InexactRoot.target === "browser");
    console.assert(InexactFile.target === "browser");
    console.assert(ExactFile.target === "browser");
    console.assert(JSFileExtensionOnly.isJS === true);
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

//# sourceMappingURL=http://localhost:8080/package-json-exports/index.js.map
