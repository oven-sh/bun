import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(true);
import {
__require as require
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
var this_package_should_not_exist_f335_0 = (() => ({}));
var this_package_should_not_exist_f335_1 = (() => ({}));
var hmr = new FastHMR(3165260286, "caught-require.js", FastRefresh), exports = hmr.exports;
await (hmr._load = async function() {
  try {
    require((() => { throw (new Error(`Cannot require module "this-package-should-not-exist"`)); } )());
  } catch (exception) {
  }
  try {
    await import("this-package-should-not-exist");
  } catch (exception) {
  }
  import("this-package-should-not-exist").then(() => {
  }, () => {
  });
  async function test() {
    try {
      require((() => { throw (new Error(`Cannot require module "this-package-should-not-exist"`)); } )());
    } catch (exception) {
    }
    try {
      await import("this-package-should-not-exist");
    } catch (exception) {
    }
    import("this-package-should-not-exist").then(() => {
    }, () => {
    });
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

//# sourceMappingURL=http://localhost:8080/caught-require.js.map
