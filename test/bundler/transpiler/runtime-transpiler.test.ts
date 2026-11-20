import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

test("use strict causes CommonJS", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), require.resolve("./use-strict-fixture.js")],
    env: bunEnv,
  });
  expect(stdout.toString()).toBe("function\n");
  expect(exitCode).toBe(0);
});

test("non-ascii regexp literals", () => {
  var str = "🔴11 54 / 10,000";
  expect(str.replace(/[🔵🔴,]+/g, "")).toBe("11 54 / 10000");
});

test("ascii regex with escapes", () => {
  expect(/^[-#!$@£%^&*()_+|~=`{}\[\]:";'<>?,.\/ ]$/).toBeInstanceOf(RegExp);
});

describe("// @bun", () => {
  beforeEach(() => {
    delete require.cache[require.resolve("./async-transpiler-entry")];
    delete require.cache[require.resolve("./async-transpiler-imported")];
  });

  test("async transpiler", async () => {
    const { default: value, hbs } = await import("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("require()", async () => {
    const { default: value, hbs } = require("./async-transpiler-entry");
    expect(value).toBe(42);
    expect(hbs).toBeString();
  });

  test("synchronous", async () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./async-transpiler-imported")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });
    expect(stdout.toString()).toBe("Hello world!\n");
    expect(exitCode).toBe(0);
  });
});

describe("json imports", () => {
  test("require(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      ...other
    } = require("./runtime-transpiler-json-fixture.json");
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    expect(other).toEqual({});

    // This tests that importing and requiring when already in the cache keeps the state the same
    {
      const {
        name,
        description,
        players,
        version,
        creator,
        default: defaultExport,
        // @ts-ignore
      } = await import("./runtime-transpiler-json-fixture.json");
      const obj = {
        "name": "Spiral 4v4 NS",
        "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
        "version": "1.0",
        "creator": "Grand Homie",
        "players": [8, 8],
        default: { a: 1 },
      };
      expect({
        name,
        description,
        players,
        version,
        creator,
        default: { a: 1 },
      }).toEqual(obj);
      // They should be strictly equal
      expect(defaultExport.players).toBe(players);
      expect(defaultExport).toEqual(obj);
    }

    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
  });

  test("import(*.json)", async () => {
    const {
      name,
      description,
      players,
      version,
      creator,
      default: defaultExport,
      // @ts-ignore
    } = await import("./runtime-transpiler-json-fixture.json");
    delete require.cache[require.resolve("./runtime-transpiler-json-fixture.json")];
    const obj = {
      "name": "Spiral 4v4 NS",
      "description": "4v4 unshared map. 4 spawns in a spiral. Preferred to play with 4v4 NS.",
      "version": "1.0",
      "creator": "Grand Homie",
      "players": [8, 8],
      default: { a: 1 },
    };
    expect({
      name,
      description,
      players,
      version,
      creator,
      default: { a: 1 },
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.players).toBe(players);
    expect(defaultExport).toEqual(obj);
  });

  test("should support comments in tsconfig.json", async () => {
    // @ts-ignore
    const { buildOptions, default: defaultExport } = await import("./tsconfig.with-commas.json");
    delete require.cache[require.resolve("./tsconfig.with-commas.json")];
    const obj = {
      "buildOptions": {
        "outDir": "dist",
        "baseUrl": ".",
        "paths": {
          "src/*": ["src/*"],
        },
      },
    };
    expect({
      buildOptions,
    }).toEqual(obj);
    // They should be strictly equal
    expect(defaultExport.buildOptions).toBe(buildOptions);
    expect(defaultExport).toEqual(obj);
  });

  test("should handle non-boecjts in tsconfig.json", async () => {
    // @ts-ignore
    const { default: num } = await import("./tsconfig.is-just-a-number.json");
    delete require.cache[require.resolve("./tsconfig.is-just-a-number.json")];
    expect(num).toBe(1);
  });

  test("should handle duplicate keys", async () => {
    // @ts-ignore
    expect((await import("./runtime-transpiler-fixture-duplicate-keys.json")).a).toBe("4");
  });
});

describe("with statement", () => {
  test("works", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), require.resolve("./with-statement-works.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });

    expect(exitCode).toBe(0);
  });
});

test("math.pow", () => {
  function foo1(foo) {
    return 10 ** (foo / 20);
  }

  function foo2(foo) {
    return foo ** -0.5;
  }

  expect(foo1(-1) + "").toEqual("0.8912509381337456");
  expect(10 ** (-1 / 20) + "").toEqual("0.8912509381337456");
  expect(foo2(20.4) + "").toEqual("0.22140372138502384");
  expect(20.4 ** -0.5 + "").toEqual("0.22140372138502384");
});

describe("unterminated string literals in large files", () => {
  test("reports an unterminated string literal at the end of a large JavaScript file", async () => {
    using dir = tempDir("transpiler-long-unterminated-js", {
      "index.js": `var s = "${Buffer.alloc(1 << 20, "a").toString()}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });

  test("reports an unterminated string literal at the end of a large JSON file", async () => {
    using dir = tempDir("transpiler-long-unterminated-json", {
      "tsconfig.big.json": `{"name": "${Buffer.alloc(1 << 20, "a").toString()}`,
      "index.js": `require("./tsconfig.big.json");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("Unterminated string literal");
    expect(exitCode).toBe(1);
  });
});

// 2 GiB through the printer takes over 30 seconds on a debug or ASAN build.
test.skipIf(isDebug || isASAN)(
  "printing more than 2 GiB of modules in one process keeps the space after a keyword",
  async () => {
    using dir = tempDir("transpiler-printer-position", {
      "big.cjs": `module.exports = "${Buffer.alloc(1 << 20, "a").toString()}";`,
      "probe.cjs": `module.exports = function named() { return typeof named; };`,
      "index.cjs": `
        const big = require.resolve("./big.cjs");
        for (let i = 0; i < 2100; i++) {
          delete require.cache[big];
          module.children.length = 0;
          require(big);
          if (i % 50 === 0) Bun.gc(true);
        }
        console.log(require("./probe.cjs")());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  },
);

// The runtime hands JSC a regex literal as it is written, so a program reads from one what it reads in Node.
describe.concurrent("a regex literal with non-ASCII or control characters", () => {
  // A file and not -e: an argument cannot hold a NUL.
  async function run(source: string) {
    using dir = tempDir("transpiler-regex-literal", { "index.js": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const printed = (value: unknown) => ({ stdout: JSON.stringify(value) + "\n", stderr: "", exitCode: 0 });

  // The text of a module is 8-bit while every character in it is at most U+00FF (ÿ), and UTF-16 otherwise.
  test.each([
    ["characters at most U+00FF", ["/café/", "/¶+/g", "/ÿ/i"]],
    ["characters above U+00FF", ["/日本語/", "/a🐰b/u", "/a\uFEFFb/", "/ÿĀÿ/"]],
  ])("source, toString(), inspect() and the text of a function are as written: %s", async (_, literals) => {
    const result = await run(`
      const { inspect } = require("node:util");
      const makers = [${literals.map(literal => `() => ${literal}`).join(", ")}];
      console.log(JSON.stringify(makers.map(make => {
        const re = make();
        return [re.source, re.toString(), inspect(re), make.toString()];
      })));
    `);
    const pattern = (literal: string) => literal.slice(1, literal.lastIndexOf("/"));
    expect(result).toEqual(printed(literals.map(literal => [pattern(literal), literal, literal, `() => ${literal}`])));
  });

  // Characters at the edges of what a print or a reader could take apart: controls, the ends of Latin-1, the
  // neighbours of the line separators and of the surrogates, and the last code point. "â\x80¨" is U+2028 to a reader
  // that takes one byte for each of its characters as UTF-8.
  test.each([
    [8, ["\x01", "\t", "\v", "\x1F", "\x7F", "\x80", "\x85", "\xA0", "ÿ", "â\x80¨"]],
    [16, ["Ā", "\u2027", "\u202A", "\uD7FF", "\uE000", "\uFFFD", "\uFFFF", "𐀀", "\u{10FFFF}"]],
  ] as const)("a module of %d-bit text has each of its literals as written", async (width, characters) => {
    const texts = characters.flatMap(character => [character, `a${character}b`, character + character]);
    const literals = texts.flatMap(text => ["", "u", "v", "i"].map(flags => ({ text, flags })));
    const lines = [
      `const { jscDescribe } = require("bun:jsc");`,
      `const literals = [`,
      ...literals.map(({ text, flags }) => `  /${text}/${flags},`),
      `];`,
      `const line = Number(new Error().stack.split("\\n")[1].match(/:(\\d+):\\d+\\)?$/)[1]);`,
      `function here() {}`,
      `const width = jscDescribe(here.toString()).includes("8Bit:(1)") ? 8 : 16;`,
      `console.log(JSON.stringify([width, line, literals.map(re => [re.source, re.flags, re.test(re.source)])]));`,
    ];
    // No character of a literal ends a line, so the Error is made on the line that it is written on.
    const line = lines.findIndex(text => text.includes("new Error()")) + 1;
    expect(await run(lines.join("\n"))).toEqual(
      printed([width, line, literals.map(({ text, flags }) => [text, flags, true])]),
    );
  });

  // parsel-js does this: https://github.com/oven-sh/bun/issues/8207, https://github.com/oven-sh/bun/issues/13853
  test("source.replace() finds a group that is written with a pilcrow", async () => {
    const result = await run(`
      const re = /::(?<name>[-\\w\\P{ASCII}]+)(?:\\((?<argument>¶*)\\))?/gu;
      console.log(JSON.stringify(re.source.replace("(?<argument>¶*)", "(?<argument>.*)")));
    `);
    expect(result).toEqual(printed("::(?<name>[-\\w\\P{ASCII}]+)(?:\\((?<argument>.*)\\))?"));
  });

  // https://github.com/oven-sh/bun/issues/33930
  test("a raw NUL, TAB, unit separator and DEL are one character each in source", async () => {
    const result = await run(`
      const units = re => Array.from(re.source, character => character.charCodeAt(0));
      const nul = /\x00HFMASK(\\d+)\x00/g;
      console.log(JSON.stringify([units(nul), nul.test("\\0HFMASK42\\0"), units(/\t\x1F\x7F/)]));
    `);
    expect(result).toEqual(printed([[0, 72, 70, 77, 65, 83, 75, 40, 92, 100, 43, 41, 0], true, [9, 31, 127]]));
  });

  test("a backslash escapes the character that is written after it", async () => {
    const result = await run(`
      console.log(JSON.stringify([
        /a\\éb/.test("aéb"),
        ["–", "—", "3"].map(text => /[\\–\\—]/.test(text)),
        /a\\\tb/.test("a\\tb"),
      ]));
    `);
    expect(result).toEqual(printed([true, [true, true, false], true]));
  });

  test("a class range ends in an escaped character", async () => {
    const result = await run(`
      console.log(JSON.stringify(["b", "é", "ê", "\\\\"].map(text => /^[a-\\é]$/.test(text))));
    `);
    expect(result).toEqual(printed([true, true, false, false]));
  });

  test("a literal that is evaluated twice gives two objects", async () => {
    const result = await run(`
      const make = () => /é/g;
      const first = make();
      first.test("é");
      const second = make();
      console.log(JSON.stringify([first === second, first.lastIndex, second.lastIndex, second.source]));
    `);
    expect(result).toEqual(printed([false, 1, 0, "é"]));
  });

  // JSC takes no raw NUL in a class under the v flag (oven-sh/WebKit#595), so that NUL alone is printed as an escape.
  test("a raw NUL in a class under the v flag matches a NUL", async () => {
    const result = await run(`
      const re = /^[\x00é]$/v;
      console.log(JSON.stringify([["\\0", "é", "u", "0"].map(text => re.test(text)), re.source]));
    `);
    expect(result).toEqual(printed([[true, true, false, false], "^[\\u0000é]$"]));
  });

  // Each literal is printed wrong by another misreading of that rule: of the backslashes before a NUL, of a NUL after
  // the first, of a "v" that is not a flag.
  test("only a raw NUL that no backslash escapes is printed as an escape, and only under the v flag", async () => {
    const result = await run(`
      const units = re => Array.from(re.source, character => character.charCodeAt(0));
      console.log(JSON.stringify([/[\\\\\x00]/v, /[\x00-\x00]/v, /v\x00/].map(units)));
    `);
    const escape = [92, 117, 48, 48, 48, 48];
    expect(result).toEqual(
      printed([
        [91, 92, 92, ...escape, 93],
        [91, ...escape, 45, ...escape, 93],
        [118, 0],
      ]),
    );
  });

  test.each([
    // JSC reads a backslash and é as é under the u flag, where V8 has an early error for the backslash
    // (https://github.com/oven-sh/bun/issues/40441). JSC then refuses the range, which runs from é down to a.
    ["a class range from é down to a", "/[\\é-a]/u"],
    // Printed as the escape above, this NUL would be a backslash and the text "u0000", so it stays as written.
    ["a backslash before a raw NUL under the v flag", "/\\\x00/v"],
  ])("an invalid literal that is never evaluated is an early SyntaxError: %s", async (_, literal) => {
    const result = await run(`
      console.log("ran");
      function never() {
        return ${literal};
      }
    `);
    expect(result).toEqual({
      stdout: "",
      stderr: expect.stringContaining("SyntaxError: Invalid regular expression: "),
      exitCode: 1,
    });
  });
});

// One case for each in-process reader of what the runtime's printer wrote. A reader that takes the text in the other
// width hands JSC another pattern, or a module that does not parse.
describe.concurrent("a regex literal with non-ASCII text, wherever its module is loaded", () => {
  const print = "process.stdout.write(JSON.stringify(values));\n";
  // The transpiler cache takes a source of 4 KiB or more.
  const padding = `// ${Buffer.alloc(4 * 1024, "x").toString()}\n`;

  /** Modules that give `values`: what a literal of `text` is, and the width of the text that JSC has of the module. */
  function probe(text: string, width: 8 | 16) {
    const esm = [
      `import { jscDescribe } from "bun:jsc";`,
      `const re = /${text}/u;`,
      // The text of a function is a piece of its module's, in the same width.
      `function here() {}`,
      `const width = jscDescribe(here.toString()).includes("8Bit:(1)") ? 8 : 16;`,
      `const values = [re.source, String(re), re.test(${JSON.stringify(`un ${text}!`)}), width];`,
      ``,
    ].join("\n");
    const cjs = esm.replace(`import { jscDescribe } from "bun:jsc";`, `const { jscDescribe } = require("bun:jsc");`);
    const typed = esm.replace("const re =", "const re: RegExp =");
    return {
      values: [text, `/${text}/u`, true, width],
      esm,
      cjs,
      files: {
        "entry.mjs": esm + print,
        "required.cjs": cjs + "module.exports = values;\n",
        "require.cjs": `const values = require("./required.cjs");\n` + print,
        "imported.ts": typed + "export default values;\n",
        "import.mjs": `import values from "./imported.ts";\n` + print,
        "worker.mjs": esm + "postMessage(values);\n",
        "start-worker.mjs": [
          `const worker = new Worker(new URL("./worker.mjs", import.meta.url));`,
          `worker.onerror = event => {`,
          `  console.error(event.message);`,
          `  process.exit(1);`,
          `};`,
          `worker.onmessage = ({ data: values }) => {`,
          `  ${print.trim()}`,
          `  worker.terminate();`,
          `};`,
          ``,
        ].join("\n"),
        "hot.cjs": cjs + `values.push(require("./required.cjs"));\n` + print + "process.exit(0);\n",
        "data-url.mjs": [
          `const source = ${JSON.stringify(esm + "export default values;\n")};`,
          `const { default: values } = await import("data:text/javascript," + encodeURIComponent(source));`,
          print,
        ].join("\n"),
        "entry.test.ts": [
          typed + `import imported from "./imported.ts";`,
          `import { test } from "bun:test";`,
          `test("prints what its literal and the one that it imports are", () => {`,
          `  console.log(JSON.stringify([values, imported]));`,
          `});`,
          ``,
        ].join("\n"),
        "plugin.cjs": [
          cjs + `const message = JSON.stringify([...values, typeof $Bun_defer]);`,
          `const create = context => ({ Program: node => context.report({ node, message }) });`,
          `module.exports = { rules: { show: { create } } };`,
          ``,
        ].join("\n"),
        "eslint.config.mjs": [
          `import demo from "./plugin.cjs";`,
          `export default [{ plugins: { demo }, rules: { "demo/show": "error" } }];`,
          ``,
        ].join("\n"),
        "linted.js": "linted;\n",
        "padded.ts": padding + typed + "export default values;\n",
        "padded.cjs": padding + cjs + "module.exports = values;\n",
        "cached.mjs": [
          `import imported from "./padded.ts";`,
          `import required from "./padded.cjs";`,
          `const values = [imported, required];`,
          print,
        ].join("\n"),
      },
    };
  }
  type Probe = ReturnType<typeof probe>;

  // "ÿ" is U+00FF, the last character that fits in a byte. Beside wider characters, its byte also stands for each of
  // them until a print ends.
  const latin1 = probe("café-©-ÿ", 8);
  const wide = probe("café-ÿ-中文-🐰", 16);
  const otherWide = probe("ÿ-日本語", 16);
  const ascii = probe("cafe-c-y", 8);

  async function runIn(cwd: string, args: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const printed = (values: unknown) => ({ stdout: JSON.stringify(values), stderr: "", exitCode: 0 });

  describe.each([
    ["Latin-1 text, which leaves the text of its module 8-bit", latin1],
    ["CJK and astral text, which makes the text of its module UTF-16", wide],
  ])("%s", (_, { files, values }) => {
    // The entry point and what require() loads are printed on the thread of their VM, and what the entry point imports
    // on a thread of the transpiler. --hot keeps the text of what its VM prints for as long as the VM lives.
    test.each([
      ["the entry point", ["entry.mjs"], values],
      ["a module that require() loads", ["require.cjs"], values],
      ["a TypeScript module that is imported", ["import.mjs"], values],
      ["the entry point of a Worker", ["start-worker.mjs"], values],
      ["a module that is imported from a data: URL", ["data-url.mjs"], values],
      ["the entry point and a module that it requires, under --hot", ["--hot", "hot.cjs"], [...values, values]],
    ])("is as written in %s", async (_, args, expected) => {
      using dir = tempDir("regex-reader", files);
      expect(await runIn(String(dir), args)).toEqual(printed(expected));
    });

    // Without a source map to make, the end of the print is the one place that widens the text.
    test.each(["entry.mjs", "require.cjs", "import.mjs"])("is as written by %s with source maps off", async entry => {
      using dir = tempDir("regex-reader-no-source-map", files);
      const env = { BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS: "1" };
      expect(await runIn(String(dir), [entry], env)).toEqual(printed(values));
    });

    test("is as written in a test file and a module that it imports, under bun test", async () => {
      using dir = tempDir("regex-reader-test", files);
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["test", "./entry.test.ts"]);
      expect(stderr).toContain(" 1 pass");
      expect(stdout.split(/\r?\n/).filter(line => line.startsWith("["))).toEqual([JSON.stringify([values, values])]);
      expect(exitCode).toBe(0);
    });

    // Other threads read the modules of a plugin ahead and share them as 8-bit text, and an engine loads a module
    // whose text is UTF-16 itself. `$Bun_defer` is a function where modules are loaded so.
    test(
      "is as written in a plugin of bun lint, whose modules are read ahead",
      async () => {
        using dir = tempDir("regex-reader-lint", files);
        const lint = ["lint", "--threads", "2", "-f", "json", "linted.js"];
        const { stdout, stderr, exitCode } = await runIn(String(dir), lint);
        // The rule of the plugin reports one error.
        expect(exitCode, stderr).toBe(1);
        expect(JSON.parse(stdout)[0].messages.map((it: { message: string }) => JSON.parse(it.message))).toEqual([
          [...values, "function"],
        ]);
      },
      // Each engine of bun lint is a VM, which takes seconds to start in a debug build.
      isDebug || isASAN ? 60_000 : undefined,
    );
  });

  // require() prints every module of a VM with one printer, and each thread of the transpiler keeps one for the
  // modules that it is given.
  test.each([
    ["require()", "one-after-another.cjs"],
    ["import()", "one-after-another.mjs"],
  ])("is as written in modules of both widths that %s loads one after another", async (_, entry) => {
    const order = [wide, wide, latin1, latin1, otherWide, otherWide, ascii, ascii, latin1, latin1];
    const entryThat = (loads: string) =>
      `const values = [];\nfor (let at = 0; at < ${order.length}; at++) values.push(${loads});\n` + print;
    using dir = tempDir("regex-reader-printer", {
      ...Object.fromEntries(
        order.flatMap(({ cjs, esm }, at) => [
          [`${at}.cjs`, cjs + "module.exports = values;\n"],
          [`${at}.mjs`, esm + "export default values;\n"],
        ]),
      ),
      "one-after-another.cjs": entryThat(`require("./" + at + ".cjs")`),
      "one-after-another.mjs": entryThat(`(await import("./" + at + ".mjs")).default`),
    });
    expect(await runIn(String(dir), [entry])).toEqual(printed(order.map(({ values }) => values)));
  });

  // --hot keeps the text of each version of a module, in the width that the version is printed in.
  test.each([
    ["Latin-1 text and then CJK and astral text", latin1, wide],
    ["CJK and astral text and then Latin-1 text", wide, latin1],
  ])("is as written in a module that --hot loads again: %s", async (_, first, second) => {
    const line = "console.log(JSON.stringify(values));\n";
    using dir = tempDir("regex-reader-hot", { "main.cjs": first.cjs + line });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "main.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });
    const decoder = new TextDecoder();
    let stdout = "";
    for await (const chunk of proc.stdout) {
      // The first load has printed its line: the file is saved with the other literal, and with an exit.
      if (!stdout) await Bun.write(join(String(dir), "main.cjs"), second.cjs + line + "process.exit(0);\n");
      stdout += decoder.decode(chunk, { stream: true });
    }
    expect(stdout).toBe(JSON.stringify(first.values) + "\n" + JSON.stringify(second.values) + "\n");
    expect(await proc.exited).toBe(0);
  });

  // In Latin-1, "é" is the byte that begins a sequence of three in UTF-8, and "ô" one of four. Counted as UTF-8, this
  // text would have fewer columns than it has, and "ô" would take the end of its line with it.
  const accented = Buffer.alloc(2 * 24, "é").toString() + "ô";
  describe.each([
    ["Latin-1", accented],
    ["CJK and astral", "中文🐰" + accented],
  ])("an error that is made after a literal of %s text has its line and column", (_, text) => {
    const lines = [
      `const made = [/${text}/, new Error("on the line of the literal")];`,
      `const re = /${text}/;`,
      `const after = new Error("on the line after the literal");`,
      `const at = error => error.stack.split("\\n")[1].match(/:(\\d+:\\d+)\\)?$/)[1];`,
      `const values = [re.source, at(made[1]), at(after)];`,
      ``,
    ];
    // A column of a stack trace is counted from 1, in UTF-16 code units.
    const expected = [text, `1:${lines[0].indexOf("Error(") + 1}`, `3:${lines[2].indexOf("Error(") + 1}`];

    test.each([
      ["in the entry point", "entry.mjs"],
      ["in a module that is imported", "import.mjs"],
    ])("%s", async (_, entry) => {
      using dir = tempDir("regex-reader-positions", {
        "entry.mjs": lines.join("\n") + print,
        "imported.mjs": lines.join("\n") + "export default values;\n",
        "import.mjs": `import values from "./imported.mjs";\n` + print,
      });
      expect(await runIn(String(dir), [entry])).toEqual(printed(expected));
    });
  });

  // NODE_COMPILE_CACHE keeps bytecode by a hash of the text that a module is printed as, and JSC takes the bytecode
  // for the same text in the same width. Each case starts three programs two or three times over, and a first run
  // makes bytecode as it exits, so these run one at a time.
  describe.serial("has bytecode that the next run takes, under NODE_COMPILE_CACHE", () => {
    test.each([
      ["each run prints the modules", ["compile", "compile"]],
      ["the second run takes the modules from the transpiler cache", ["both", "both"]],
      ["the bytecode is made of modules from the transpiler cache", ["transpiler", "both", "both"]],
    ] as const)("%s", async (_, runs) => {
      /** How many modules the last run has bytecode for, and for how many of them JSC takes it. */
      async function lastRun({ files, values }: Probe) {
        using dir = tempDir("regex-reader-compile-cache", files);
        const cache = join(String(dir), "transpiler-cache");
        const compile = { NODE_COMPILE_CACHE: join(String(dir), "compile-cache") };
        const transpiler = {
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
          // A debug build reads the cache only with this.
          BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
        };
        const envs = { compile, transpiler, both: { ...compile, ...transpiler } };
        const entries = () =>
          readdirSync(cache)
            .sort()
            .map(name => {
              const { ino, mtimeNs } = statSync(join(cache, name), { bigint: true });
              return { name, ino, mtimeNs };
            });
        let stored: ReturnType<typeof entries> | undefined;
        let log: string[] = [];
        for (const [at, run] of runs.entries()) {
          const isLast = at === runs.length - 1;
          const logging = isLast && { NODE_DEBUG_NATIVE: "COMPILE_CACHE", BUN_JSC_verboseDiskCache: "1" };
          const { stdout, stderr, exitCode } = await runIn(String(dir), ["cached.mjs"], { ...envs[run], ...logging });
          log = stderr.split(/\r?\n/);
          expect({ stdout, stderr: isLast ? "" : stderr, exitCode }).toEqual(printed([values, values]));
          if (run === "compile") continue;
          // A run writes an entry again that it cannot read, so the entries of the two padded modules stay as the
          // first run wrote them.
          stored ??= entries();
          expect(stored).toHaveLength(2);
          expect(entries()).toEqual(stored);
        }
        return {
          accepted: log.filter(line => line.startsWith("[compile cache] ") && line.includes(" was accepted")).length,
          hits: log.filter(line => line === "[Disk Cache] Cache hit for sourceCode").length,
        };
      }
      const [ofAscii, ...others] = await Promise.all([ascii, latin1, wide].map(lastRun));
      // The entry point and the two modules that it loads.
      expect(ofAscii.accepted).toBe(3);
      expect(ofAscii.hits).toBeGreaterThanOrEqual(3);
      expect(others).toEqual([ofAscii, ofAscii]);
    });
  });
});
