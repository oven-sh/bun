import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

async function check(name: string, text: string) {
  using dir = tempDir("fmt-tree-kinds", { [name]: text });
  const { stdout, stderr, exitCode } = await run([bunExe(), "fmt", "--debug-check", name], String(dir));
  return { stdout: stdout.trim(), stderr, exitCode };
}

// The trees are compared only when formatting changes the text, so no text here is formatted.
test.concurrent.each([
  ["with(a){b}", "a.cjs"],
  ["'use strict';a", "a.js"],
  ["function f(){'use strict';'b'}", "a.js"],
  ['("use strict")', "a.js"],
  ["'a\\\r\nb';c", "a.js"],
  ["x=`a`", "a.js"],
  ["x=f`a${b}c`", "a.js"],
  ["x=/a b/ig", "a.js"],
  ["x=/* @__PURE__ */f()", "a.js"],
  ["x=/* @__PURE__ */(f())", "a.js"],
  ["x=<a>  b   c &amp; d </a>", "a.jsx"],
  ["x=<a>`b`</a>", "a.jsx"],
  [`x=<a b='c'>{" "}d</a>`, "a.jsx"],
  ['import a from "a" with {type:"json"}', "a.js"],
  ['export * from "a" with {type:"json"}', "a.js"],
  ['export {a} from "a" with {type:"json"}', "a.js"],
  ["a?.b.c;(a?.b).c", "a.js"],
  ["class A{#a;m(){return this.#a}}", "a.js"],
])("the check accepts %s", async (text, name) => {
  expect(await check(name, text)).toEqual({ stdout: name, stderr: "", exitCode: 0 });
});

test.concurrent("the check rejects (a<b>)()", async () => {
  const { stderr, exitCode } = await check("a.ts", "(a<b>)();\n");
  expect(stderr).toContain("formatting would change what the code does");
  expect(exitCode).toBe(2);
});
