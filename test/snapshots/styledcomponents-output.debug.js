import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $a77976b9 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($a77976b9);
var jsx = require(JSX).jsxDEV;
import * as $11bd281d from "http://localhost:8080/node_modules/styled-components/dist/styled-components.browser.esm.js";
var { default: styled} = require($11bd281d);
import * as $a66742df from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($a66742df);
import * as $12d4369 from "http://localhost:8080/node_modules/react-dom/index.js";
var { default: ReactDOM} = require($12d4369);
const ErrorScreenRoot = styled.div`
  font-family: "Muli", -apple-system, BlinkMacSystemFont, Helvetica, Arial,
    sans-serif;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: #fff;
  text-align: center;
  background-color: #0b2988;
  color: #fff;
  font-family: "Muli", -apple-system, BlinkMacSystemFont, Helvetica, Arial,
    sans-serif;
  line-height: 1.5em;

  & > p {
    margin-top: 10px;
  }

  & a {
    color: inherit;
  }
`;
export function test() {
  if (typeof window !== "undefined") {
    const reactEl = document.createElement("div");
    document.body.appendChild(reactEl);
    ReactDOM.render(jsx(ErrorScreenRoot, {
      id: "error-el",
      children: "The react child should have this text"
    }), reactEl);
    const style = document.querySelector("style[data-styled]");
    console.assert(style, "style tag should exist");
    console.assert(style.textContent.split("").every((a) => a.codePointAt(0) < 128), "style tag should not contain invalid unicode codepoints");
    console.assert(document.querySelector("#error-el").textContent === "The react child should have this text");
    ReactDOM.unmountComponentAtNode(reactEl);
    reactEl.remove();
    style.remove();
    return testDone(import.meta.url);
  }
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/styledcomponents-output.js.map
