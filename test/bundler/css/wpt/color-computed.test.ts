import { describe } from "bun:test";
import { itBundled } from "../../expectBundled";

const runTest = (input: string, expected: string) => {
  itBundled(input, {
    experimentalCss: true,
    files: {
      "/a.css": /* css */ `
h1 {
  color: ${input}
}
      `,
    },
    outfile: "out.css",

    onAfterBundle(api) {
      api.expectFile("/out.css").toEqualIgnoringWhitespace(`
/* a.css */
h1 {
    color: ${expected};
}
`);
    },
  });
};

describe("color-computed", () => {
  runTest("currentcolor", "currentColor");
  runTest("transparent", "#0000");
  runTest("red", "red");
  runTest("magenta", "#f0f");
  runTest("#234", "#234");
  runTest("#FEDCBA", "#fedcba");
  runTest("rgb(100%, 0%, 0%)", "red");
  runTest("rgba(2, 3, 4, 50%)", "#02030480");
  runTest("hsl(120, 100%, 50%)", "#0f0");
  runTest("hsla(120, 100%, 50%, 0.25)", "#00ff0040");
  runTest("rgb(-2, 3, 4)", "#000304");
  runTest("rgb(100, 200, 300)", "#64c8ff");
  runTest("rgb(20, 10, 0, -10)", "#140a0000");
  runTest("rgb(100%, 200%, 300%)", "#fff");
});
