import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $a77976b9 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($a77976b9);
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($a66742df);
var jsx = require(JSX).jsxDEV, jsxEl = require(JSXClassic).createElement;
var { default: React} = require($a66742df);
export function SpreadWithTheKey({ className }) {
  const rest = {};
  return jsxEl("div", {
    className,
    ...rest,
    onClick: () => console.log("click"),
    key: "spread-with-the-key"
  }, "Rendered component containing warning");
}
export function test() {
  console.assert(React.isValidElement(jsx(SpreadWithTheKey, {
    className: "foo"
  })));
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/spread_with_key.tsx.map
