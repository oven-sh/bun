import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// A function of a sloppy CommonJS file that starts with "use strict" is strict mode code, as in Node. `bun run` drops the directive. Each row prints what the function with the
// directive answers and then what its neighbor without one answers.
const store = (target: string) => `try { ${target} = 1; } catch (e) { return e.name; } return "silent";`;
const pair = (before: string, body: string) =>
  `${before}\nfunction f() { "use strict"; ${body} }\nfunction g() { ${body} }\nconsole.log(f(), g());\n`;

const rows: [name: string, file: string, source: string, answer: string][] = [
  ["this of a plain call", "a.cjs", pair("", "return typeof this;"), "undefined object"],
  [
    "this of a call with a number",
    "a.cjs",
    `function f() { "use strict"; return typeof this; }\nfunction g() { return typeof this; }\nconsole.log(f.call(5), g.call(5), f.call(null), g.call(null));\n`,
    "number object object object",
  ],
  ["a frozen object", "a.cjs", pair("const o = Object.freeze({ z: 0 });", store("o.z")), "TypeError silent"],
  [
    "a getter without a setter",
    "a.cjs",
    pair("const o = { get p() { return 1; } };", store("o.p")),
    "TypeError silent",
  ],
  [
    "an object that takes no more",
    "a.cjs",
    pair("const o = Object.preventExtensions({});", store("o.n")),
    "TypeError silent",
  ],
  ["a property of a string", "a.cjs", pair("", store(`"s".x`)), "TypeError silent"],
  [
    "the length of a frozen array",
    "a.cjs",
    pair("const l = Object.freeze([1]);", store("l.length")),
    "TypeError silent",
  ],
  [
    "a name nobody declares",
    "a.cjs",
    `function f() { "use strict"; ${store("leakedOne")} }\nfunction g() { ${store("leakedTwo")} }\nconsole.log(f(), g(), typeof leakedOne, typeof leakedTwo);\n`,
    "ReferenceError silent undefined number",
  ],
  [
    "the function's own name",
    "a.cjs",
    `const f = function k() { "use strict"; ${store("k")} };\nconst g = function k() { ${store("k")} };\nconsole.log(f(), g());\n`,
    "TypeError silent",
  ],
  [
    "delete of a fixed property",
    "a.cjs",
    pair("const o = Object.freeze({ z: 0 });", "try { return delete o.z; } catch (e) { return e.name; }"),
    "TypeError false",
  ],
  [
    "arguments and parameters",
    "a.cjs",
    `function f(a) { "use strict"; arguments[0] = 2; return a; }\nfunction g(a) { arguments[0] = 2; return a; }\nconsole.log(f(1), g(1));\n`,
    "1 2",
  ],
  [
    "arguments.callee",
    "a.cjs",
    pair("", "try { return typeof arguments.callee; } catch (e) { return e.name; }"),
    "TypeError function",
  ],
  ["a var of eval", "a.cjs", pair("", `eval("var leaked = 1"); return typeof leaked;`), "undefined number"],
  ["a function in a block", "a.cjs", pair("", "{ function inner() {} } return typeof inner;"), "undefined function"],
  [
    "an arrow inside",
    "a.cjs",
    pair("const o = Object.freeze({ z: 0 });", `return (() => { ${store("o.z")} })();`),
    "TypeError silent",
  ],
  [
    "an arrow's own directive",
    "a.cjs",
    `const o = Object.freeze({ z: 0 });\nconst f = () => { "use strict"; ${store("o.z")} };\nconst g = () => { ${store("o.z")} };\nconsole.log(f(), g());\n`,
    "TypeError silent",
  ],
  [
    "a method",
    "a.cjs",
    `const o = Object.freeze({ z: 0 });\nconst h = { f() { "use strict"; ${store("o.z")} }, g() { ${store("o.z")} } };\nconsole.log(h.f(), h.g());\n`,
    "TypeError silent",
  ],
  [
    "a getter",
    "a.cjs",
    `const h = { get f() { "use strict"; return typeof this; }, get g() { return typeof this; } };\nconst get = name => Object.getOwnPropertyDescriptor(h, name).get;\nconsole.log(get("f").call(5), get("g").call(5));\n`,
    "number object",
  ],
  [
    "generators and async functions",
    "a.cjs",
    `function* a() { "use strict"; yield typeof this; }\nasync function b() { "use strict"; return typeof this; }\nfunction* c() { yield typeof this; }\nasync function d() { return typeof this; }\n(async () => console.log(a().next().value, await b(), c().next().value, await d()))();\n`,
    "undefined undefined object object",
  ],
  [
    "functions inside the function at the head of a package",
    "a.cjs",
    `(function () {\n  "use strict";\n  function inner() { return typeof this; }\n  console.log(typeof this, inner());\n})();\n(function () {\n  function inner() { return typeof this; }\n  console.log(typeof this, inner());\n})();\n`,
    "undefined undefined\nobject object",
  ],
  [
    "a callback",
    "a.cjs",
    `const seen = [];\n[1].forEach(function () { "use strict"; seen.push(typeof this); }, "s");\n[1].forEach(function () { seen.push(typeof this); }, "s");\nconsole.log(seen.join(" "));\n`,
    "string object",
  ],
  [
    "behind another directive",
    "a.cjs",
    `function f() { "use asm"; "use strict"; return typeof this; }\nfunction g() { "use\\x20strict"; return typeof this; }\nfunction h() { ("use strict"); return typeof this; }\nconsole.log(f(), g(), h());\n`,
    "undefined object object",
  ],
  [
    "a .js file that is CommonJS",
    "a.js",
    pair("module.exports = 1;\nconst o = Object.freeze({ z: 0 });", store("o.z")),
    "TypeError silent",
  ],
  [
    "a .cts file",
    "a.cts",
    `const o = Object.freeze({ z: 0 }) as { z: number };\nfunction f(): string { "use strict"; try { o.z = 1; } catch (e) { return (e as Error).name; } return "silent"; }\nfunction g(): string { try { o.z = 1; } catch (e) { return (e as Error).name; } return "silent"; }\nconsole.log(f(), g());\n`,
    "TypeError silent",
  ],
];

describe.concurrent('a function\'s own "use strict"', () => {
  test.each(rows)("%s, in an executable", async (_, file, source, answer) => {
    using dir = tempDir("aot-strict-functions", { [file]: source });
    const executable = join(String(dir), isWindows ? "a.exe" : "a");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", file, "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
    const { stdout, exitCode } = await run([executable], String(dir), bunEnv);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: answer, exitCode: 0 });
  });

  test.each(rows)("%s, in a test run", async (_, file, source, answer) => {
    const name = file.replace(".", ".test.");
    using dir = tempDir("aot-strict-functions", { [name]: `${source}require("bun:test").test("ran", () => {});\n` });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "./" + name], String(dir), bunEnv);
    expect({ output: stdout + stderr, exitCode }).toEqual({
      output: expect.stringContaining(answer + "\n"),
      exitCode: 0,
    });
  });

  test.each([
    ["a default parameter", `function f(a = 1) { "use strict"; return a; }`],
    ["two parameters of one name", `function f(a, a) { "use strict"; return a; }`],
    ["with", `function f(o) { "use strict"; with (o) { return x; } }`],
    ["delete of a name", `function f() { "use strict"; var x = 1; return delete x; }`],
    ["a store to eval", `function f() { "use strict"; eval = 1; }`],
    ["a reserved word", `function f() { "use strict"; var let = 1; return let; }`],
  ])("%s is refused behind the directive", async (_, source) => {
    using dir = tempDir("aot-strict-functions", { "a.cjs": `${source}\nconsole.log(typeof f);\n` });
    const executable = join(String(dir), isWindows ? "a.exe" : "a");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "a.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.stringContaining("error"),
      exitCode: 1,
    });
  });
});
