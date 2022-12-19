import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $db639b27 from "http://localhost:8080/node_modules/@emotion/react/jsx-dev-runtime/dist/emotion-react-jsx-dev-runtime.browser.esm.js";
var JSX = require($db639b27);
var jsx = require(JSX).jsxDEV;
import * as $12d4369 from "http://localhost:8080/node_modules/react-dom/index.js";
var ReactDOM = require($12d4369);
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
