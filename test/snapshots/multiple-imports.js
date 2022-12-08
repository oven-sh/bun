import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $a77976b9 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($a77976b9);
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var JSXClassic = require($a66742df);
var jsx = require(JSX).jsxDEV, JSXFrag = require(JSXClassic).Fragment;
var { default: React} = require($a66742df);
var { default: React2} = require($a66742df);
const bacon = React;
const bacon2 = jsx(JSXFrag, {
  children: "hello"
});
export function test() {
  console.assert(bacon === React);
  console.assert(bacon === React2);
  console.assert(typeof bacon2 !== "undefined");
  console.assert(React.isValidElement(bacon2));
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/multiple-imports.js.map
