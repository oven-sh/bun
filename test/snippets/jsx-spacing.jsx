import * as ReactDOM from "react-dom/server";

const ReturnDescriptionAsString = ({ description }) => description;

export function test() {
  const _bun = ReactDOM.renderToString(
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
  const el = document.createElement("textarea");
  el.innerHTML = _bun;
  const bun = el.value;

  const esbuild =
    "line1\nline2 trailing space \n\nline4 no trailing space 'single quote' \\t\\f\\v\\uF000 `template string`\n\nline6 no trailing space\nline7 trailing newline that ${terminates} the string literal\n";

  const tsc =
    "line1\nline2 trailing space \n\nline4 no trailing space 'single quote' \\t\\f\\v\\uF000 `template string`\n\nline6 no trailing space\nline7 trailing newline that ${terminates} the string literal\n";

  console.assert(
    bun === esbuild && bun === tsc,
    `strings did not match: ${JSON.stringify(
      {
        received: bun,
        expected: esbuild,
      },
      null,
      2,
    )}`,
  );

  testDone(import.meta.url);
}
