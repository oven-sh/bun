import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $1407d117 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($1407d117);
import * as $45b81229 from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($45b81229);
var jsx = require(JSX).jsxDEV, jsxEl = require(JSXClassic).createElement;
var { default: React} = require($45b81229);
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
  }, undefined, false, undefined, this)));
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/spread_with_key.tsx.map
