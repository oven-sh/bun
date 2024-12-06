import { $ } from "bun";
import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

import * as empty_text from "./15536/empty_text.html" with { type: "text" };
import * as partial_text from "./15536/partial_text.html" with { type: "text" };
import * as empty_script from "./15536/empty_script.js";
import * as empty_script_2 from "./15536/empty_script_2.js";

test("empty files from import", () => {
  expect(
    JSON.stringify({
      empty_text,
      partial_text,
      empty_script,
      empty_script_2,
    }),
  ).toMatchInlineSnapshot(
    `"{"empty_text":{"default":""},"partial_text":{"default":"\\n\\n\\n\\n\\n"},"empty_script":{},"empty_script_2":{}}"`,
  );
});

test("empty files from build (#15536)", async () => {
  const dir = tempDirWithFiles("15536", {
    "demo": {
      "a.js": 'import html from "./a.html";\nconsole.log(html);',
      "a.html": "",
    },
    "demo.js": `\
const { outputs } = await Bun.build({
    loader: {
        ".html": "text"
    },
    entrypoints: ["./demo/a.js"]
});

console.log(await outputs[0].text());`,
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "demo.js"],
    cwd: dir,
    env: { ...bunEnv },
    stdio: ["inherit", "pipe", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().replaceAll(/\[parsetask\] ParseTask\(.+?, runtime\) callback\n/g, ""))
    .toMatchInlineSnapshot(`
"// demo/a.html
var a_default = "";

// demo/a.js
console.log(a_default);

"
`);
});

test("empty js file", async () => {
  const dir = tempDirWithFiles("15536", {
    "demo": {
      "a.js": 'import value from "./empty.js";\nconsole.log(value);',
      "empty.js": "",
    },
    "demo.js": `\
const { logs } = await Bun.build({
    loader: {
        ".html": "text"
    },
    entrypoints: ["./demo/a.js"]
});

console.log(logs.join("\\n"));`,
  });
  const result = Bun.spawnSync({
    cmd: [bunExe(), "demo.js"],
    cwd: dir,
    env: { ...bunEnv },
    stdio: ["inherit", "pipe", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(
    result.stdout.toString().replaceAll(/\[parsetask\] ParseTask\(.+?, runtime\) callback\n/g, ""),
  ).toMatchInlineSnapshot(`
"BuildMessage: No matching export in "demo/empty.js" for import "default"
"
`);
});
