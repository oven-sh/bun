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
var jsx = require(JSX).jsxDEV;
import * as $45b81229 from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($45b81229);
var hmr = new FastHMR(2913325904, "react-context-value-func.tsx", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  const Context = React.createContext({});
  const ContextProvider = ({ children }) => {
    const [cb, setCB] = React.useState(function() {
    });
    const foo = true;
    return jsx(Context.Provider, {
      value: cb,
      children: children(foo)
    }, undefined, false, undefined, this);
  };
  const ContextValue = ({}) => jsx(Context.Consumer, {
    children: (foo) => {
      if (foo)
        return jsx("div", {
          children: "Worked!"
        }, undefined, false, undefined, this);
      throw `Value "${foo}"" should be true`;
    }
  }, undefined, false, undefined, this);
  const TestComponent = () => jsx(ContextProvider, {
    children: jsx(ContextValue, {}, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
  function test() {
    const foo = jsx(TestComponent, {}, undefined, false, undefined, this);
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

//# sourceMappingURL=http://localhost:8080/react-context-value-func.tsx.map
