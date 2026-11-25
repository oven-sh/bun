import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// A file that begins with `// @bun` is handed to the engine as it stands, so `bun test` shows the text of its functions as written.
// A compiled test run went on laying what `bun test` prints for other files into it: a statement that only reads a name was `;`, and `this` of the file was `null` or `exports`.
// Executables: parallel/function-source-signature-formatting.
const project = casesOfOneRun("test-run-function-source-bun-pragma", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function showsAsPlain(title: string, expected: string[], file: string, marked: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      import * as marked from "./${file}";
      ${sayOf(name)}
      test("${name}", () => say((marked.default ?? marked).shown.map(String)));`,
    { [file]: marked },
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(JSON.parse(plain?.printed ?? "null")).toEqual(expected);
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

const texts = [
  "function  odd (a,b){return a+b}",
  "() => { const k = 1; k; return 2; }",
  "() => this",
  "a=>a",
  "function(){ if (false) { odd(); } return typeof undefined; }",
];

showsAsPlain(
  "a module",
  texts,
  "marked.js",
  `// @bun\n${texts[0]}\nexport const shown = [odd, ${texts.slice(1).join(", ")}];\n`,
);

showsAsPlain(
  "a module behind a first line for the shell",
  texts,
  "marked.js",
  `#!/usr/bin/env bun\n// @bun\n${texts[0]}\nexport const shown = [odd, ${texts.slice(1).join(", ")}];\n`,
);

showsAsPlain(
  "a CommonJS file in the wrapper that Bun writes round it",
  texts,
  "marked.cjs",
  `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${texts[0]}\nexports.shown = [odd, ${texts.slice(1).join(", ")}];\n})\n`,
);
