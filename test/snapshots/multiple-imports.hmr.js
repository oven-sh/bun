import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);
import {
__require as require
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import * as $1407d117 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($1407d117);
import * as $45b81229 from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($45b81229);
var jsx = require(JSX).jsxDEV, JSXFrag = require(JSXClassic).Fragment;
var { default: React} = require($45b81229);
var { default: React2} = require($45b81229);
var hmr = new FastHMR(2063938930, "multiple-imports.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  const bacon = React;
  const bacon2 = jsx(JSXFrag, {
    children: "hello"
  }, undefined, false, undefined, this);
  function test() {
    console.assert(bacon === React);
    console.assert(bacon === React2);
    console.assert(typeof bacon2 !== "undefined");
    console.assert(React.isValidElement(bacon2));
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

//# sourceMappingURL=http://localhost:8080/multiple-imports.js.map
