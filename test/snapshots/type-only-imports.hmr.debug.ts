import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(true);
import {
__HMRModule as HMR
} from "http://localhost:8080/bun:wrap";
var hmr = new HMR(4067108788, "type-only-imports.ts"), exports = hmr.exports;
(hmr._load = function() {
  var baconator = true;
  var SilentSymbolCollisionsAreOkayInTypeScript = true;
  function test() {
    console.assert(SilentSymbolCollisionsAreOkayInTypeScript);
    console.assert(baconator);
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    baconator: () => baconator,
    SilentSymbolCollisionsAreOkayInTypeScript: () => SilentSymbolCollisionsAreOkayInTypeScript,
    test: () => test
  });
})();
var $$hmr_baconator = hmr.exports.baconator, $$hmr_SilentSymbolCollisionsAreOkayInTypeScript = hmr.exports.SilentSymbolCollisionsAreOkayInTypeScript, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_baconator = exports.baconator;
  $$hmr_SilentSymbolCollisionsAreOkayInTypeScript = exports.SilentSymbolCollisionsAreOkayInTypeScript;
  $$hmr_test = exports.test;
};

export {
  $$hmr_baconator as baconator,
  $$hmr_SilentSymbolCollisionsAreOkayInTypeScript as SilentSymbolCollisionsAreOkayInTypeScript,
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:8080/type-only-imports.ts.map
