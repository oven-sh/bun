// A require() of a constant path follows the type that its options write out. Where they may name another, the build says so with TS100177.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const cases: Record<string, { text: string; warns: boolean }> = {
  "options in a variable": { text: `const options = { type: "text" };\nrequire("./part.cjs", options);`, warns: true },
  "a type in a property": {
    text: `const held = { kind: process.argv[2] };\nrequire("./part.cjs", { type: held.kind });`,
    warns: true,
  },
  "a type in a parameter": {
    text: `function load(type) {\n  return require("./part.cjs", { type });\n}\nload(process.argv[2]);`,
    warns: true,
  },
  "options with a spread": { text: `require("./part.cjs", { ...process.env });`, warns: true },
  "a type that is written out": { text: `require("./part.cjs", { type: "text" });`, warns: false },
  "a type in a constant": { text: `const kind = "text";\nrequire("./part.cjs", { type: kind });`, warns: true },
  "options without a type": { text: `require("./part.cjs", {});`, warns: false },
  "a name behind the receiver of call()": { text: `require.call(null, "./part.cjs");`, warns: false },
  "no options": { text: `require("./part.cjs");`, warns: false },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { text, warns } = cases[name];
  using sources = tempDir("aot-a-type-in-options-of-a-require", {
    "part.cjs": "exports.a = 1;\n",
    "main.cjs": `${text}\n`,
  });
  using outside = tempDir("aot-a-type-in-options-of-a-require-outside", {});
  const executable = join(String(outside), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  expect((built.stdout + built.stderr).includes("TS100177")).toBe(warns);
});
