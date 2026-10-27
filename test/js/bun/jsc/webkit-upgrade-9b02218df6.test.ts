import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Coverage for oven-sh/WebKit#645. Each case pins behavior that differs between the previous JSC and this one, or
// (the last) behavior of this JSC that nothing here checked.

test("a SyntaxError from JavaScriptCore's parser with no JS frame on the stack has the parser's line and sourceURL", async () => {
  // The transpiler passes a regular expression literal through, so this file's error is JavaScriptCore's, raised when
  // the module loader parses the module: there is no JS frame at that point. addErrorInfo() stored the parser's
  // position in the ErrorInstance and relied on materialization to publish it, which does nothing for an empty stack:
  // `line` and `sourceURL` were undefined.
  using dir = tempDir("webkit-syntaxerror-location", {
    "bad-regex.mjs": "export const a = 1;\nexport const b = 2;\nexport const re = /(?<n>.)(?<n>.)/;\n",
  });
  const path = join(String(dir), "bad-regex.mjs");

  let error: any;
  try {
    await import(path);
  } catch (e) {
    error = e;
  }

  expect(error).toBeInstanceOf(SyntaxError);
  expect(error.message).toBe("Invalid regular expression: duplicate group specifier name");
  expect(error.line).toBe(3);
  expect(error.sourceURL).toBe(path);
});

test("errors thrown inside JavaScriptCore's own builtins say the same thing in every build", () => {
  // A private builtin emits expression info only when assertions are on, and with the info the message also got the
  // builtin's source text: a debug or ASAN build said "undefined is not a function (near '...value of wrapper...')"
  // and "null is not an object (evaluating 'iterable')" where a release build says what is below.
  const messageOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e: any) {
      return e.message;
    }
    return "did not throw";
  };

  expect(messageOf(() => Array.from({ [Symbol.iterator]: () => ({}) } as any))).toBe("undefined is not a function");
  expect(messageOf(() => Object.fromEntries(null as any))).toBe("null is not an object");
});

test("wasm calls an imported JS function with the JIT off", async () => {
  // operationWasmToJSExitMarshalArguments indexed the frame with `i / sizeof(V)` for a negative `i`: unsigned
  // division, then pointer arithmetic that overflows. Under ASAN on x86_64 the compiler folded the check before that
  // load into a read of an unmapped shadow address, and the call faulted.
  const source = `
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,                               // type 0: (i32) -> i32
      0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x00, 0x00,             // import env.f : type 0
      0x03, 0x02, 0x01, 0x00,                                                       // func 1 : type 0
      0x07, 0x05, 0x01, 0x01, 0x67, 0x00, 0x01,                                     // export "g" = func 1
      0x0a, 0x0b, 0x01, 0x09, 0x00, 0x20, 0x00, 0x10, 0x00, 0x41, 0x01, 0x6a, 0x0b, // g(x) = f(x) + 1
    ]);
    const { g } = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { f: x => x * 2 } }).exports;
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += g(i);
    console.log(sum);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, BUN_JSC_useJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("1000000\n");
  expect(exitCode).toBe(0);
});

test("an array that contains itself joins the way V8's does", () => {
  // Upstream JavaScriptCore no longer guards join() against an array that contains itself and throws "RangeError:
  // Maximum call stack size exceeded". Here, as in V8, the inner occurrence joins as "". npm packages depend on it.
  const a: any[] = [1, 2];
  a.push(a);
  expect(a.join()).toBe("1,2,");
  expect(String(a)).toBe("1,2,");
  expect([a, 3].join("-")).toBe("1,2,-3");
});
