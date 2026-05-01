"use strict";
exports.__esModule = true;
exports.test = void 0;
var ReactDOM = require("react-dom/server");
var ReturnDescriptionAsString = function (_a) {
  var description = _a.description;
  return description;
};
function test() {
  var _bun = ReactDOM.renderToString(
    <ReturnDescriptionAsString
      description="line1
line2 trailing space 

line4 no trailing space 'single quote' \t\f\v\uF000 `template string`

line6 no trailing space
line7 trailing newline that ${terminates} the string literal
"
    ></ReturnDescriptionAsString>,
  );
  // convert HTML entities to unicode
  var el = document.createElement("textarea");
  el.innerHTML = _bun;
  var bun = el.value;
  var esbuild =
    "line1\nline2 trailing space \n\nline4 no trailing space 'single quote' \\t\\f\\v\\uF000 `template string`\n\nline6 no trailing space\nline7 trailing newline that ${terminates} the string literal\n";
  console.assert(
    bun === esbuild,
    "strings did not match: " +
      JSON.stringify(
        {
          received: bun,
          expected: esbuild,
        },
        null,
        2,
      ),
  );
  testDone(import.meta.url);
}
exports.test = test;
