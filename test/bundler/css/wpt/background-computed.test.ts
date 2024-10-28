import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

const runTest = (property: string, input: string, expected: string) => {
  const testTitle = `${property}: ${input}`;
  itBundled(testTitle, {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
h1 {
    ${property}: ${input}
}
      `,
    },
    outfile: "out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
h1 {
    ${property}: ${expected};
}
`);
    },
  });
};

describe("background-computed", () => {
  runTest("background-attachment", "local", "local");
  runTest("background-attachment", "scroll, fixed", "scroll, fixed");
  runTest("background-attachment", "local, fixed, scroll", "local, fixed, scroll");
  runTest("background-attachment", "local, fixed, scroll, fixed", "local, fixed, scroll, fixed");
  runTest("background-clip", "border-box", "border-box");
  runTest("background-clip", "content-box, border-box", "content-box, border-box");
  runTest("background-clip", "border-box, padding-box, content-box", "border-box, padding-box, content-box");
  runTest(
    "background-clip",
    "content-box, border-box, padding-box, content-box",
    "content-box, border-box, padding-box, content-box",
  );
  runTest("background-clip", "content-box, border-box, padding-box", "content-box, border-box, padding-box");
  runTest("background-clip", "content-box, border-box, border-area", "content-box, border-box, border-area");
  runTest("background-color", "rgb(255, 0, 0)", "red");
  runTest("background-origin", "border-box", "border-box");
  runTest("background-origin", "content-box, border-box", "content-box, border-box");
  runTest("background-origin", "border-box, padding-box, content-box", "border-box, padding-box, content-box");
  runTest(
    "background-origin",
    "content-box, border-box, padding-box, content-box",
    "content-box, border-box, padding-box, content-box",
  );
  runTest("background-position", "50% 6px", "50% 6px");
  runTest("background-position", "12px 13px, 50% 6px", "12px 13px, 50% 6px");
  runTest("background-position", "12px 13px, 50% 6px, 30px -10px", "12px 13px, 50% 6px, 30px -10px");
  runTest(
    "background-position",
    "12px 13px, 50% 6px, 30px -10px, -7px 8px",
    "12px 13px, 50% 6px, 30px -10px, -7px 8px",
  );
  runTest("background-position-x", "0.5em", ".5em");
  runTest("background-position-x", "-20%, 10px", "-20%, 10px");
  runTest("background-position-x", "center, left, right", "center, left, right");
  runTest("background-position-x", "calc(10px - 0.5em), -20%, right, 15%", "calc(10px - .5em), -20%, right, 15%");
  runTest("background-position-y", "0.5em", ".5em");
});
