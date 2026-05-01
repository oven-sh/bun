import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $a77976b9 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($a77976b9);
var jsx = require(JSX).jsxDEV;
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($a66742df);
const Context = React.createContext({});
const ContextProvider = ({ children }) => {
  const [cb, setCB] = React.useState(function() {
  });
  const foo = true;
  return jsx(Context.Provider, {
    value: cb,
    children: children(foo)
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
export function test() {
  const foo = jsx(TestComponent, {});
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/react-context-value-func.tsx.map
