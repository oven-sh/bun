import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $5bf278c5 from "http://localhost:8080/node_modules/@emotion/react/jsx-dev-runtime/dist/emotion-react-jsx-dev-runtime.browser.cjs.js";
var JSX = require($5bf278c5);
var jsx = require(JSX).jsxDEV;
import * as $d2dc5006 from "http://localhost:8080/node_modules/react-dom/index.js";
var ReactDOM = require($d2dc5006);
export const Foo = () => jsx("div", {
  css: { content: '"it worked!"' }
}, undefined, false, undefined, this);
export function test() {
  const element = document.createElement("div");
  element.id = "custom-emotion-jsx";
  document.body.appendChild(element);
  ReactDOM.render(jsx(Foo, {}, undefined, false, undefined, this), element);
  const style = window.getComputedStyle(element.firstChild);
  if (!(style["content"] ?? "").includes("it worked!"))
    throw new Error('Expected "it worked!" but received: ' + style["content"]);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/custom-emotion-jsx/file.jsx.map
