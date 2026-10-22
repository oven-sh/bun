import { expect, test } from "bun:test";
import { sliceSourceCode } from "../../../src/codegen/builtin-parser";

// process.binding is a public property that a program can replace, and a builtin module can load after the program
// did that. The builtins read a binding through a private accessor (src/js/README.md). The preprocessor that every
// builtin under src/js is built through (bundle-modules.ts, bundle-functions.ts) rejects the public one, so that
// Process_functionBinding can take every caller for user code when it emits DEP0111.
const preprocess = (code: string) => sliceSourceCode("{" + code + "}", true, specifier => specifier).result;

test.each([
  ["a call", `const { UV_EINVAL } = process.binding("uv");`],
  ["a call over two lines", `const uv = process\n  .binding("uv");`],
  ["an optional chain", `const uv = process?.binding("uv");`],
  ["a read through globalThis", `const uv = globalThis.process.binding("uv");`],
  ["a template literal expression", "const message = `${process.binding('uv').UV_EOF}`;"],
])("a builtin that reads process.binding does not build: %s", (_, code) => {
  expect(() => preprocess(code)).toThrow("process.binding is a public property that a program can replace");
});

test.each([
  ["a comment", `// process.binding("uv")\nconst a = 1;`],
  ["a string", `const text = "process.binding('uv')";`],
  ["another property of process", `const nextTick = process.nextTick;`],
  ["the private accessor", `const constants = $processBindingConstants.zlib;`],
])("a builtin that does not read it builds: %s", (_, code) => {
  expect(() => preprocess(code)).not.toThrow();
});
