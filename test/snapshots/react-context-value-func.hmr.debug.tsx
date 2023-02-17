import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
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
import * as $a77976b9 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($a77976b9);
var jsx = require(JSX).jsxDEV;
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($a66742df);
var hmr = new FastHMR(4175696745, "react-context-value-func.tsx", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  const Context = React.createContext({});
  const ContextProvider = ({ children }) => {
    const [cb, setCB] = React.useState(function() {
    });
    return jsx(Context.Provider, {
      value: cb,
      children: children(true)
    });
  };
  const ContextValue = ({}) => jsx(Context.Consumer, {
    children: (foo) => {
      if (foo)
        return jsx("div", {
          children: "Worked!"
        });
      throw `Value "${foo}"" should be true`;
    }
  });
  const TestComponent = () => jsx(ContextProvider, {
    children: jsx(ContextValue, {})
  });
  function test() {
    const foo = jsx(TestComponent, {});
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
