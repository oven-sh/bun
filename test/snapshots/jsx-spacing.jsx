import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $1407d117 from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($1407d117);
var jsx = require(JSX).jsxDEV;
import * as $72f3f54c from "http://localhost:8080/node_modules/react-dom/server.browser.js";
var ReactDOM = require($72f3f54c);
const ReturnDescriptionAsString = ({ description }) => description;
export function test() {
  const _bun = ReactDOM.renderToString(jsx(ReturnDescriptionAsString, {
    description: `line1
line2 trailing space 

line4 no trailing space 'single quote' \\t\\f\\v\\uF000 \`template string\`

line6 no trailing space
line7 trailing newline that \${terminates} the string literal
`
  }, undefined, false, undefined, this));
  const el = document.createElement("textarea");
  el.innerHTML = _bun;
  const bun = el.value;
  const esbuild = `line1
line2 trailing space 

line4 no trailing space 'single quote' \\t\\f\\v\\uF000 \`template string\`

line6 no trailing space
line7 trailing newline that \${terminates} the string literal
`;
  const tsc = `line1
line2 trailing space 

line4 no trailing space 'single quote' \\t\\f\\v\\uF000 \`template string\`

line6 no trailing space
line7 trailing newline that \${terminates} the string literal
`;
  console.assert(bun === esbuild && bun === tsc, `strings did not match: ${JSON.stringify({
    received: bun,
    expected: esbuild
  }, null, 2)}`);
  testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/jsx-spacing.jsx.map
