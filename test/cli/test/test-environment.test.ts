import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// Split in two because `bun test` scans a test file's whole text for these names, this file's included.
const VITEST = "@vitest" + "-environment";
const JEST = "@jest" + "-environment";

// Fakes that log how the runner uses the package. The real ones take seconds to load in a debug build.
const fakePackages = {
  "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
  "node_modules/happy-dom/index.js": `
    let count = 0;
    exports.Window = class Window {
      constructor({ console: _, ...options }) {
        const id = "happy-dom#" + ++count;
        console.log("open", id, JSON.stringify(options));
        this.environment = id;
        this.document = { body: { id }, defaultView: this };
        this.location = { href: options.url };
        this.matchMedia = undefined;
        this.happyDOM = {
          async abort() {
            await Promise.resolve();
            console.log("abort", id);
          },
        };
        this.close = () => console.log("close", id);
      }
    };
  `,
  "node_modules/jsdom/package.json": JSON.stringify({ name: "jsdom", main: "index.js" }),
  "node_modules/jsdom/index.js": `
    let count = 0;
    class EventTarget {
      addEventListener() {}
      removeEventListener() {}
    }
    class Window extends EventTarget {
      EventTarget = EventTarget;
      AbortController = class {};
      AbortSignal = class {};
      Blob = class {};
      FormData = class {};
    }
    exports.JSDOM = class JSDOM {
      constructor(html, options) {
        if (!options) throw new Error("With --isolate, Bun first opens a window for jsdom to keep");
        const id = "jsdom#" + ++count;
        console.log("open", id, JSON.stringify({ html, ...options }));
        this.window = new Window();
        this.window.environment = id;
        this.window.document = { body: { id }, defaultView: this.window };
        this.window.location = { href: options.url };
        this.window.close = () => console.log("close", id);
      }
    };
  `,
};

const logEnvironment = `
  import { test } from "bun:test";
  import { basename } from "node:path";
  test("environment", () => {
    console.log(basename(import.meta.path), typeof document === "undefined" ? "node" : environment, typeof location === "undefined" ? "" : location.href);
  });
`;

async function bunTest(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd,
    env: { ...bunEnv, NODE_PATH: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // slice(1) drops the "bun test v1.2.3" banner.
  return { stdout: stdout.split("\n").slice(1).filter(Boolean), stderr, exitCode };
}

function errorBetweenTests(...lines: string[]) {
  const rule = Buffer.alloc(31, "-").toString();
  return ["# Unhandled error between tests", rule, ...lines, rule, ""].join("\n");
}

function warnings(output: string) {
  return output.split("\n").filter(line => /^(?:warn|note): /.test(line));
}

function cannotSetUp(name: string, file: string) {
  return `Cannot set up the "${name}" test environment for "${file}"`;
}

function cannotFindPackage(name: string, file: string) {
  return [
    `warn: ${cannotSetUp(name, file)}: cannot find package "${name}"`,
    `note: to install it, run "bun add -d ${name}"`,
  ];
}

const throwingJSDOM = {
  "node_modules/jsdom/package.json": JSON.stringify({ name: "jsdom", main: "index.js" }),
  "node_modules/jsdom/index.js": `
    exports.JSDOM = class JSDOM {
      constructor() {
        throw new TypeError("no window today");
      }
    };
  `,
};

function summary(stderr: string) {
  return stderr.match(/^ *\d+ (?:pass|fail|error)s?$/gm)?.map(line => line.trim());
}

function verdicts(stderr: string) {
  return Object.fromEntries(
    Array.from(stderr.matchAll(/^\((pass|fail)\) (.+?)(?: \[[\d.]+ms\])?$/gm), ([, verdict, name]) => [name, verdict]),
  );
}

describe.concurrent("test environment", () => {
  test("environment comments are detected exactly where vitest and Jest detect theirs", async () => {
    // Expected values come from vitest 5.0.3's `detectCodeBlock` and jest-docblock 30's `extract` on the same text.
    const comments: Record<string, [text: string, environment: string]> = {
      "line": [`// ${VITEST} jsdom\n`, "jsdom#1"],
      "block": [`/** ${VITEST} happy-dom */\n`, "happy-dom#1"],
      "jest-docblock": [`/**\n * ${JEST} jsdom\n */\n`, "jsdom#1"],
      "jest-block": [`\n  /* ${JEST} jsdom */\n`, "jsdom#1"],
      "jest-line": [`// ${JEST} happy-dom\n`, "node"],
      "jest-second-docblock": [`/** first */\n/** ${JEST} jsdom */\n`, "node"],
      "jest-after-line": [`// first\n/** ${JEST} jsdom */\n`, "node"],
      "jest-after-code": [`import "node:fs";\n/** ${JEST} jsdom */\n`, "node"],
      "jest-string": [`const text = "/** ${JEST} jsdom */";\n`, "node"],
      "jest-after-shebang": [`#!/usr/bin/env bun\n/** ${JEST} jsdom */\n`, "node"],
      "jest-after-empty": [`/**/ /** ${JEST} jsdom */\n`, "node"],
      "jest-then-vitest": [`// ${JEST} jsdom\n// ${VITEST} happy-dom\n`, "happy-dom#1"],
      "string": [`const text = "${VITEST} happy-dom";\n`, "happy-dom#1"],
      "spaces": [`// ${VITEST} \t  happy-dom\n`, "happy-dom#1"],
      "next-line": [`/* ${VITEST}\nhappy-dom */\n`, "happy-dom#1"],
      "no-break-space": [`// ${VITEST}\u00a0happy-dom\n`, "happy-dom#1"],
      "first-wins": [`// ${VITEST} jsdom\n// ${VITEST} happy-dom\n`, "jsdom#1"],
      "crlf": [`// ${VITEST} jsdom\r\n`, "jsdom#1"],
      "closed": [`/* ${VITEST} jsdom*/\n`, "jsdom#1"],
      "trailing-hyphen": [`// ${VITEST} jsdom-\n`, "jsdom#1"],
      "only-hyphens": [`// ${VITEST} ---\n// ${VITEST} happy-dom\n`, "happy-dom#1"],
      "not-ascii-after": [`// ${VITEST} jsdomé\n`, "jsdom#1"],
      "prefixed": [`// x${VITEST} jsdom\n`, "jsdom#1"],
      "node": [`// ${VITEST} node\n`, "node"],
      "none": [``, "node"],
      "no-at": [`// ${VITEST.slice(1)} jsdom\n`, "node"],
      "plural": [`// ${VITEST}s jsdom\n`, "node"],
      "hyphenated": [`// ${VITEST}-jsdom\n`, "node"],
      "other-runner": [`// @bun-environment jsdom\n`, "node"],
      "uppercase": [`// ${VITEST.toUpperCase()} jsdom\n`, "node"],
      "path": [`// ${JEST} ./jsdom.js\n`, "node"],
    };
    const files = Object.fromEntries(
      Object.entries(comments).map(([name, [text]]) => [`${name}.test.js`, text + logEnvironment]),
    );
    files["at-the-end.test.js"] = `${logEnvironment}// ${VITEST} happy-dom`;
    files["only-the-name-at-the-end.test.js"] = `${logEnvironment}// ${VITEST}`;
    files["typescript.test.tsx"] = `// ${VITEST} happy-dom\n${logEnvironment}`;
    using dir = tempDir("test-environment", { ...fakePackages, ...files });

    const { stdout, stderr, exitCode } = await bunTest(String(dir));
    expect(
      Object.fromEntries(
        stdout.filter(line => !line.startsWith("open ")).map(line => line.split(" ").slice(0, 2) as [string, string]),
      ),
    ).toEqual({
      ...Object.fromEntries(
        Object.entries(comments).map(([name, [, environment]]) => [`${name}.test.js`, environment]),
      ),
      "at-the-end.test.js": "happy-dom#1",
      "only-the-name-at-the-end.test.js": "node",
      "typescript.test.tsx": "happy-dom#1",
    });
    expect(summary(stderr)).toEqual([`${Object.keys(files).length} pass`, "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("options are passed to the package", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "1.test.js": `// ${VITEST} happy-dom\n// ${VITEST}-options { "url": "https://example.com/a", "width": 100, "settings": { "x": 1 } }\n${logEnvironment}`,
      "2.test.js": `/**\n * ${JEST} jsdom\n * ${JEST}-options {"url": "https://example.com/b", "html": "<p>", "storageQuota": 5}\n */\n${logEnvironment}`,
      "3.test.js": `/* ${VITEST}-options {"url":"https://example.com/c"}*/\n/* ${VITEST} happy-dom */\n${logEnvironment}`,
      "4.test.js": `/* ${VITEST}-options {"url":"https://example.com/d"} */\r\n${logEnvironment}`,
      "5.test.js": `// ${VITEST}-options null\n${logEnvironment}`,
      "6.test.js": `// ${VITEST}-options {"url":"https://example.com/f"}\n// ${JEST}-options {"url":"https://example.com/g"}\n${logEnvironment}`,
      "7.test.js": `/* ${VITEST}-options */\n// ${VITEST}-options {"url":"https://example.com/h"}\n${logEnvironment}`,
      "8.test.js": `// ${JEST}-options {"url":"https://example.com/i"}\n${logEnvironment}`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--environment=jsdom");
    const jsdomDefaults = { pretendToBeVisual: true, runScripts: "dangerously" };
    const jsdomMoreDefaults = { includeNodeLocations: false, contentType: "text/html" };
    expect(
      stdout.map(line =>
        line.startsWith("open ") ? [line.split(" ")[1], JSON.parse(line.slice(line.indexOf("{")))] : line,
      ),
    ).toEqual([
      ["happy-dom#1", { url: "https://example.com/a", width: 100, settings: { x: 1, disableErrorCapturing: true } }],
      "1.test.js happy-dom#1 https://example.com/a",
      [
        "jsdom#1",
        { html: "<p>", ...jsdomDefaults, url: "https://example.com/b", ...jsdomMoreDefaults, storageQuota: 5 },
      ],
      "2.test.js jsdom#1 https://example.com/b",
      ["happy-dom#2", { url: "https://example.com/c", settings: { disableErrorCapturing: true } }],
      "3.test.js happy-dom#2 https://example.com/c",
      ["jsdom#2", { html: "<!DOCTYPE html>", ...jsdomDefaults, url: "https://example.com/d", ...jsdomMoreDefaults }],
      "4.test.js jsdom#2 https://example.com/d",
      ["jsdom#3", { html: "<!DOCTYPE html>", ...jsdomDefaults, url: "http://localhost:3000", ...jsdomMoreDefaults }],
      "5.test.js jsdom#3 http://localhost:3000",
      ["jsdom#4", { html: "<!DOCTYPE html>", ...jsdomDefaults, url: "https://example.com/f", ...jsdomMoreDefaults }],
      "6.test.js jsdom#4 https://example.com/f",
      ["jsdom#5", { html: "<!DOCTYPE html>", ...jsdomDefaults, url: "http://localhost:3000", ...jsdomMoreDefaults }],
      "7.test.js jsdom#5 http://localhost:3000",
      "8.test.js jsdom#5 http://localhost:3000",
    ]);
    expect(summary(stderr)).toEqual(["8 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  describe("project default", () => {
    const files = {
      ...fakePackages,
      "default.test.js": logEnvironment,
      "happy-dom.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      "jsdom.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
      "node.test.js": `// ${VITEST} node\n${logEnvironment}`,
    };
    const environments = (output: string[]) =>
      output.filter(line => /^\S+\.test\.js /.test(line)).map(line => line.split(" ").slice(0, 2).join(" "));
    const withDefault = (environment: string) => [
      `default.test.js ${environment}`,
      "happy-dom.test.js happy-dom#1",
      "jsdom.test.js jsdom#1",
      "node.test.js node",
    ];
    // With --isolate a process numbers its windows across files, and --parallel decides which process runs which file.
    const withoutNumbers = (lines: string[]) => lines.map(line => line.replace(/#\d+$/, ""));

    test.each([
      ["", [], "node"],
      [`environment = "jsdom"`, [], "jsdom#1"],
      [`environment = "happy-dom"`, [], "happy-dom#1"],
      [`environment = "node"`, [], "node"],
      ["", ["--environment=jsdom"], "jsdom#1"],
      ["", ["--environment", "happy-dom"], "happy-dom#1"],
      ["", ["--environment=node"], "node"],
      [`environment = "jsdom"`, ["--environment=happy-dom"], "happy-dom#1"],
      [`environment = "jsdom"`, ["--environment=node"], "node"],
    ] as const)("[test] %s, bun test %j", async (bunfig, args, expected) => {
      using dir = tempDir("test-environment", { ...files, "bunfig.toml": `[test]\n${bunfig}\n` });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...args);
      expect(environments(stdout).sort()).toEqual(withDefault(expected));
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    // --parallel prints its workers' stdout on stderr.
    test.each(["--isolate", "--parallel=2", "--parallel=2 --no-isolate"])("%s", async flags => {
      using dir = tempDir("test-environment", { ...files, "bunfig.toml": `[test]\nenvironment = "jsdom"\n` });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags.split(" "));
      expect(withoutNumbers(environments([...stdout, ...stderr.split("\n")]).sort())).toEqual(
        withoutNumbers(withDefault("jsdom")),
      );
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("--parallel passes --environment on to its workers", async () => {
      using dir = tempDir("test-environment", files);
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--parallel=2", "--environment=happy-dom");
      expect(stdout).toEqual([]);
      expect(withoutNumbers(environments(stderr.split("\n")).sort())).toEqual(withoutNumbers(withDefault("happy-dom")));
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each(["edge-runtime", "", "JSDOM"])("--environment=%s is rejected", async name => {
      using dir = tempDir("test-environment", files);
      const { stdout, stderr, exitCode } = await bunTest(String(dir), `--environment=${name}`);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: [],
        stderr: `error: --environment expects 'node', 'jsdom' or 'happy-dom', received "${name}"\n`,
        exitCode: 1,
      });
    });

    test.each([
      [`"edge-runtime"`, `expected "environment" to be "node", "jsdom" or "happy-dom" but received "edge-runtime"`],
      [`true`, `expected string but received boolean`],
    ])("environment = %s in bunfig.toml is rejected", async (value, message) => {
      using dir = tempDir("test-environment", { ...files, "bunfig.toml": `[test]\nenvironment = ${value}\n` });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).toContain(`error: ${message}`);
      expect(stdout).toEqual([]);
      expect(exitCode).toBe(1);
    });
  });

  test.each(["jsdom", "happy-dom"])("--isolate=modules loads %s once and opens a window for each file", async name => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "a.test.js": `// ${VITEST} ${name}\n${logEnvironment}`,
      "b.test.js": logEnvironment,
      "c.test.js": `// ${VITEST} ${name}\n${logEnvironment}`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate=modules");
    expect(stdout.map(line => line.replace(/ (?:\{|[a-z]+:).*/, "").trimEnd())).toEqual([
      `open ${name}#1`,
      `a.test.js ${name}#1`,
      ...(name === "happy-dom" ? [`abort ${name}#1`] : []),
      `close ${name}#1`,
      "b.test.js node",
      `open ${name}#2`,
      `c.test.js ${name}#2`,
      ...(name === "happy-dom" ? [`abort ${name}#2`] : []),
      `close ${name}#2`,
    ]);
    expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("the package is resolved from the test file", async () => {
    using dir = tempDir("test-environment", {
      "packages/a/node_modules/happy-dom/package.json": fakePackages["node_modules/happy-dom/package.json"],
      "packages/a/node_modules/happy-dom/index.js": fakePackages["node_modules/happy-dom/index.js"],
      "packages/a/a.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      "packages/b/b.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "./packages/a/a.test.js", "./packages/b/b.test.js");
    expect(warnings(stderr)).toEqual(cannotFindPackage("happy-dom", join(String(dir), "packages", "b", "b.test.js")));
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
      "a.test.js happy-dom#1 http://localhost:3000",
      "b.test.js node ",
    ]);
    expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  // Only a warning, because `bun test` ignored these comments for years and migrated suites still have them.
  describe("an environment comment that fails to set up only warns, and the file runs without one", () => {
    test.each(["jsdom", "happy-dom"])("%s is not installed", async name => {
      using dir = tempDir("test-environment", {
        "a.test.js": `// ${VITEST} ${name}\n${logEnvironment}`,
        "b.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "./a.test.js", "./b.test.js");
      expect(stderr).toContain(
        ["a.test.js:", ...cannotFindPackage(name, join(String(dir), "a.test.js")), ""].join("\n"),
      );
      expect(warnings(stderr)).toHaveLength(2);
      expect(stdout).toEqual(["a.test.js node ", "b.test.js node "]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each([
      "--isolate",
      "--parallel=2",
      "--parallel=2 --no-isolate",
      "--rerun-each=3",
      "--only-failures",
      "--dots",
      "--environment=node",
    ])("once for each file with %s", async flags => {
      const names = ["a.test.js", "b.test.js", "c.test.js"];
      using dir = tempDir("test-environment", {
        ...Object.fromEntries(names.map(name => [name, `/** ${JEST} jsdom */\n${logEnvironment}`])),
        "d.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags.split(" "));
      expect(warnings(stderr).sort()).toEqual(
        names.flatMap(name => cannotFindPackage("jsdom", join(String(dir), name))).sort(),
      );
      expect(warnings(stdout.join("\n"))).toEqual([]);
      expect(summary(stderr)).toEqual([flags === "--rerun-each=3" ? "12 pass" : "4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each(["edge-runtime", "prisma", "jsdom2"])("%s is not supported", async name => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "a.test.js": `// ${VITEST} ${name}\n${logEnvironment}`,
        "b.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--environment=happy-dom",
        "./a.test.js",
        "./b.test.js",
      );
      expect(stderr).toContain(
        [
          "a.test.js:",
          `warn: The "${name}" test environment requested by "${join(String(dir), "a.test.js")}" is not supported`,
          `note: the supported environments are "node", "jsdom" and "happy-dom"`,
          "",
        ].join("\n"),
      );
      expect(warnings(stderr)).toHaveLength(2);
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "a.test.js node ",
        "b.test.js happy-dom#1 http://localhost:3000",
      ]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("its options are not JSON", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "bad.test.js": `// ${VITEST} happy-dom\n// ${VITEST}-options { url: 1 }\n${logEnvironment}`,
        "good.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "./bad.test.js", "./good.test.js");
      expect(warnings(stderr)).toEqual([
        `warn: ${cannotSetUp("happy-dom", join(String(dir), "bad.test.js"))}: its options are not JSON: JSON Parse error: Expected '}'`,
      ]);
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "bad.test.js node ",
        "good.test.js happy-dom#1 http://localhost:3000",
      ]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("the package throws", async () => {
      using dir = tempDir("test-environment", {
        ...throwingJSDOM,
        "a.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(warnings(stderr)).toEqual([
        `warn: ${cannotSetUp("jsdom", join(String(dir), "a.test.js"))}: no window today`,
      ]);
      expect(stdout).toEqual(["a.test.js node "]);
      expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each([
      ["jsdom", "JSDOM"],
      ["happy-dom", "Window"],
    ])("%s does not export %s", async (name, missing) => {
      using dir = tempDir("test-environment", {
        [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: "index.js" }),
        [`node_modules/${name}/index.js`]: `exports.version = 1;`,
        "a.test.js": `// ${VITEST} ${name}\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(warnings(stderr)).toEqual([
        `warn: ${cannotSetUp(name, join(String(dir), "a.test.js"))}: the package does not export ${missing}`,
      ]);
      expect(stdout).toEqual(["a.test.js node "]);
      expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("a package that require() can't load warns the same way for every file", async () => {
      using dir = tempDir("test-environment", {
        "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.mjs" }),
        "node_modules/happy-dom/index.mjs": `await 0;\nexport class Window {}`,
        "1.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
        "2.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(warnings(stderr).map(line => line.slice(0, line.indexOf(" async module")))).toEqual(
        ["1.test.js", "2.test.js"].map(file => `warn: ${cannotSetUp("happy-dom", join(String(dir), file))}: require()`),
      );
      expect(stdout).toEqual(["1.test.js node ", "2.test.js node "]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("a preload that registers its own DOM still works under --isolate", async () => {
      using dir = tempDir("test-environment", {
        "preload.js": `globalThis.document = { body: {} }; globalThis.environment = "preloaded";`,
        "1.test.js": `/** ${JEST} jsdom */\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate", "--preload=./preload.js");
      expect(warnings(stderr)).toEqual(cannotFindPackage("jsdom", join(String(dir), "1.test.js")));
      expect(stdout).toEqual(["1.test.js preloaded ", "2.test.js preloaded "]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("a project environment that fails to set up fails the file but not the run", () => {
    test.each([
      ["jsdom", ["--environment=jsdom"], ""],
      ["happy-dom", ["--environment=happy-dom"], ""],
      ["jsdom", [], `environment = "jsdom"`],
      ["jsdom", ["--isolate"], `environment = "jsdom"`],
    ])("%s is not installed: bun test %j, [test] %s", async (name, flags, bunfig) => {
      using dir = tempDir("test-environment", {
        "bunfig.toml": `[test]\n${bunfig}\n`,
        "a.test.js": logEnvironment,
        "b.test.js": `// ${VITEST} node\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags, "./a.test.js", "./b.test.js");
      const [warning, note] = cannotFindPackage(name, join(String(dir), "a.test.js"));
      expect(stderr).toContain(errorBetweenTests(warning.replace("warn:", "error:"), note));
      expect(warnings(stderr)).toEqual([note]);
      expect(stdout).toEqual(["b.test.js node "]);
      expect(summary(stderr)).toEqual(["1 pass", "1 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    test("a file's options are not JSON", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "bad.test.js": `// ${VITEST}-options { url: 1 }\n${logEnvironment}`,
        "good.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--environment=happy-dom",
        "./bad.test.js",
        "./good.test.js",
      );
      expect(stderr).toContain(
        errorBetweenTests(
          `error: ${cannotSetUp("happy-dom", join(String(dir), "bad.test.js"))}: its options are not JSON: JSON Parse error: Expected '}'`,
        ),
      );
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "good.test.js happy-dom#1 http://localhost:3000",
      ]);
      expect(summary(stderr)).toEqual(["1 pass", "1 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    test("the package throws", async () => {
      using dir = tempDir("test-environment", {
        ...throwingJSDOM,
        "a.test.js": logEnvironment,
        "b.test.js": `// ${VITEST} node\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--environment=jsdom");
      expect(stderr).toContain("TypeError: no window today\n");
      expect(warnings(stderr)).toEqual([]);
      expect(stdout).toEqual(["b.test.js node "]);
      expect(summary(stderr)).toEqual(["1 pass", "1 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });
  });

  describe("without --isolate", () => {
    const describeGlobals = `
      JSON.stringify(
        Object.getOwnPropertyNames(globalThis).sort().map(key => {
          const { value, get, set, ...flags } = Object.getOwnPropertyDescriptor(globalThis, key);
          return [key, typeof value, typeof get, typeof set, flags];
        }),
      )
    `;

    test("every global is restored after a file", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        // Reading a lazy global's descriptor turns it into a plain property, so read them all before comparing.
        "0.test.js": `
          import { test } from "bun:test";
          const natives = { self, URL, Request, Blob, Event, addEventListener, Uint8Array, onerror: Object.getOwnPropertyDescriptor(globalThis, "onerror") };
          test("before", () => {
            globalThis.before = { globals: ${describeGlobals}, natives };
          });
        `,
        "1.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
        "2.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
        "3.test.js": `
          import { test, expect } from "bun:test";
          test("after", () => {
            const { globals, natives } = globalThis.before;
            delete globalThis.before;
            expect(JSON.parse(${describeGlobals})).toEqual(JSON.parse(globals).filter(([key]) => key !== "before"));
            expect({ self, URL, Request, Blob, Event, addEventListener, Uint8Array, onerror: Object.getOwnPropertyDescriptor(globalThis, "onerror") }).toEqual(natives);
            expect(URL).toBe(natives.URL);
            expect(self).toBe(globalThis);
            console.log("same");
          });
        `,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).not.toContain("error:");
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "1.test.js jsdom#1 http://localhost:3000",
        "2.test.js happy-dom#1 http://localhost:3000",
        "same",
      ]);
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each([
      [["jsdom", "node", "happy-dom", "node", "jsdom", "happy-dom"]],
      [["node", "happy-dom", "jsdom", "happy-dom", "node"]],
    ])("files of different environments: %j", async order => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        ...Object.fromEntries(order.map((name, i) => [`${i}.test.js`, `// ${VITEST} ${name}\n${logEnvironment}`])),
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...order.map((_, i) => `./${i}.test.js`));
      // Files of one environment share a window. See "a module that read the document when it was imported" for why.
      expect(
        stdout.filter(line => !line.startsWith("open ")).map(line => line.split(" ").slice(0, 2).join(" ")),
      ).toEqual(order.map((name, i) => `${i}.test.js ${name === "node" ? "node" : `${name}#1`}`));
      expect(stdout.filter(line => /^(?:abort|close) /.test(line))).toEqual([]);
      expect(summary(stderr)).toEqual([`${order.length} pass`, "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("a module that read the document when it was imported", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "screen.js": `export const body = document.body;`,
        ...Object.fromEntries(
          ["1", "3"].map(name => [
            `${name}.test.js`,
            `// ${VITEST} happy-dom
            import { test, expect } from "bun:test";
            import { body } from "./screen.js";
            test("is bound to this file's document", () => {
              expect(body).toBe(document.body);
            });`,
          ]),
        ),
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "./1.test.js", "./2.test.js", "./3.test.js");
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["2.test.js node "]);
      expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("window changes carry over only to later files of the same environment", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("defines", () => {
            Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: () => "defined" });
            window.scrollTo = () => "assigned";
            delete window.scrollBy;
          });`,
        "2.test.js": `
          import { test } from "bun:test";
          test("node", () => console.log("node", typeof matchMedia, typeof scrollTo, "scrollBy" in globalThis));`,
        "3.test.js": `// ${VITEST} jsdom
          import { test } from "bun:test";
          test("jsdom", () => console.log("jsdom", typeof matchMedia, typeof scrollTo, "scrollBy" in globalThis));`,
        "4.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => console.log("happy-dom", matchMedia(), scrollTo(), "scrollBy" in globalThis));`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "node undefined undefined false",
        "jsdom undefined undefined true",
        "happy-dom defined assigned false",
      ]);
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("a file that fails to load leaves nothing behind", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `// ${VITEST} happy-dom\nimport "./missing.js";\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "./1.test.js", "./2.test.js");
      expect(stderr).toContain("error: Cannot find module './missing.js'");
      expect(stdout.map(line => line.split(" ").slice(0, 2).join(" "))).toEqual(["open happy-dom#1", "2.test.js node"]);
      expect(summary(stderr)).toEqual(["1 pass", "1 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    test("a non-configurable global is left alone", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "preload.js": `Object.defineProperty(globalThis, "localStorage", { value: "preloaded" });`,
        "1.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => {
            console.log(environment, localStorage);
            Object.defineProperty(window, "scrollTo", { value: "stuck", configurable: false });
          });`,
        "2.test.js": `
          import { test } from "bun:test";
          test("node", () => console.log(typeof document, typeof environment, localStorage, scrollTo));`,
        "3.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => console.log(environment, localStorage, scrollTo));`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--preload=./preload.js");
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "happy-dom#1 preloaded",
        "undefined undefined preloaded stuck",
        "happy-dom#1 preloaded stuck",
      ]);
      expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("switching environments works even if a file leaves builtins patched", async () => {
      // Each file undoes the patches first thing, so only the runner's work between two files sees them.
      const patches = `
        import { afterAll } from "bun:test";
        process.undoPatches?.();
        afterAll(() => {
          const undo = [];
          const patch = (object, key, value) => {
            const original = Object.getOwnPropertyDescriptor(object, key);
            undo.push(() => (original ? Object.defineProperty(object, key, original) : delete object[key]));
            Object.defineProperty(object, key, { value, writable: true, configurable: true });
          };
          const { defineProperty, getOwnPropertyDescriptor } = Object;
          process.undoPatches = () => {
            Object.defineProperty = defineProperty;
            Object.getOwnPropertyDescriptor = getOwnPropertyDescriptor;
            for (let i = undo.length; i--; ) undo[i]();
          };
          const nothing = function* () {};
          const refuse = () => {
            throw new Error("patched");
          };
          for (const prototype of [Array.prototype, Map.prototype, Set.prototype]) patch(prototype, Symbol.iterator, nothing);
          for (const key of ["get", "set", "has", "delete", "forEach", "keys", "entries"]) patch(Map.prototype, key, refuse);
          for (const key of ["push", "concat", "forEach", "map"]) patch(Array.prototype, key, refuse);
          for (const key of ["get", "set", "value", "writable", "enumerable", "configurable"]) patch(Object.prototype, key, refuse);
          for (const key of ["defineProperty", "deleteProperty", "getOwnPropertyDescriptor", "ownKeys"]) patch(Reflect, key, refuse);
          for (const key of ["getOwnPropertyNames", "getOwnPropertySymbols", "keys", "getOwnPropertyDescriptor", "defineProperty"]) patch(Object, key, refuse);
          patch(globalThis, "Map", refuse);
          patch(globalThis, "Set", refuse);
          patch(globalThis, "Object", refuse);
        });
      `;
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `// ${VITEST} happy-dom\n${patches}${logEnvironment}`,
        "2.test.js": patches + logEnvironment,
        "3.test.js": `// ${VITEST} jsdom\n${patches}${logEnvironment}`,
        "4.test.js": `// ${VITEST} happy-dom\n${patches}${logEnvironment}`,
        "5.test.js": patches + logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).not.toContain("error:");
      expect(warnings(stderr)).toEqual([]);
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "1.test.js happy-dom#1 http://localhost:3000",
        "2.test.js node ",
        "3.test.js jsdom#1 http://localhost:3000",
        "4.test.js happy-dom#1 http://localhost:3000",
        "5.test.js node ",
      ]);
      expect(summary(stderr)).toEqual(["5 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("an environment that can't be fully set up is rolled back", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `
          import { test } from "bun:test";
          process.natives = { DOMException, EventTarget, Request };
          test("node", () => void Object.preventExtensions(globalThis));`,
        "2.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => {
            const { DOMException, EventTarget, Request } = globalThis;
            console.log(typeof document, Bun.deepEquals({ DOMException, EventTarget, Request }, process.natives, true));
          });`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(warnings(stderr)).toEqual([
        `warn: ${cannotSetUp("happy-dom", join(String(dir), "2.test.js"))}: cannot define "NamedNodeMap" on globalThis: Attempting to define property on object that is not extensible.`,
      ]);
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["undefined true"]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("fails if the environment can't be torn down", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => void Object.seal(globalThis));`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).toContain(
        `error: Cannot tear down the "happy-dom" test environment: globalThis.Request can no longer be redefined\n`,
      );
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["2.test.js happy-dom#1 http://localhost:3000"]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    // Deleting several hundred names and defining them again for each file makes JSC stop caching reads of globals.
    test("the names stay on globalThis between files of one environment", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "bunfig.toml": `[test]\nenvironment = "happy-dom"\n`,
        "1.test.js": `globalThis.definedByTheFirstFile = true;\n${logEnvironment}`,
        "2.test.js": `
          import { expect, test } from "bun:test";
          test("order", () => {
            const names = Object.getOwnPropertyNames(globalThis);
            expect(names).toContain("definedByTheFirstFile");
            expect(names.indexOf("document")).toBeLessThan(names.indexOf("definedByTheFirstFile"));
          });`,
        "3.test.js": `// ${VITEST} node\n${logEnvironment}`,
        "4.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "1.test.js happy-dom#1 http://localhost:3000",
        "3.test.js node ",
        "4.test.js happy-dom#1 http://localhost:3000",
      ]);
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("tears down the rest of the environment when one global can't be restored", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "1.test.js": `// ${VITEST} happy-dom
          import { test } from "bun:test";
          test("happy-dom", () => {
            delete globalThis.Request;
            Object.preventExtensions(globalThis);
          });`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).toContain(
        `error: Cannot tear down the "happy-dom" test environment: globalThis.Request can no longer be redefined\n`,
      );
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["2.test.js node "]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    test("a window closed by a file isn't reused for the next file", async () => {
      const closable = (name: "jsdom" | "happy-dom", window: string) => ({
        [`node_modules/${name}/index.js`]: `${fakePackages[`node_modules/${name}/index.js`]}
          const Original = exports.${window};
          exports.${window} = class extends Original {
            constructor(...args) {
              super(...args);
              const window = this.window ?? this;
              ${name === "jsdom" ? `window.close = () => delete window.document;` : `window.close = () => (window.closed = true);`}
            }
          };`,
      });
      const closes = `import { afterAll } from "bun:test";\nafterAll(() => window.close());\n`;
      using dir = tempDir("test-environment", {
        ...fakePackages,
        ...closable("jsdom", "JSDOM"),
        ...closable("happy-dom", "Window"),
        "1.test.js": `// ${VITEST} jsdom\n${closes}${logEnvironment}`,
        "2.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
        "3.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
        "4.test.js": `// ${VITEST} happy-dom\n${closes}${logEnvironment}`,
        "5.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(
        stdout.filter(line => !line.startsWith("open ")).map(line => line.split(" ").slice(0, 2).join(" ")),
      ).toEqual([
        "1.test.js jsdom#1",
        "2.test.js jsdom#2",
        "3.test.js jsdom#2",
        "4.test.js happy-dom#1",
        "5.test.js happy-dom#2",
      ]);
      expect(summary(stderr)).toEqual(["5 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("assigning to a global works even if the window's property is read-only", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "node_modules/happy-dom/index.js": `${fakePackages["node_modules/happy-dom/index.js"]}
          const { Window } = exports;
          exports.Window = class extends Window {
            constructor(...args) {
              super(...args);
              Object.defineProperty(this, "document", { value: this.document, writable: false });
            }
          };`,
        "a.test.js": `/** ${JEST} happy-dom */
          import { test } from "bun:test";
          globalThis.document = "mine";
          test("happy-dom", () => console.log(document, window.document));`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["mine mine"]);
      expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });
  });

  test("many comments on one line", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "a.test.js": `// ${Buffer.alloc(30 * 200_000, `${VITEST}-options 1 `).toString()}\n// ${VITEST} happy-dom\n${logEnvironment}`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir));
    expect(warnings(stderr)).toHaveLength(1);
    expect(stdout).toEqual(["a.test.js node "]);
    expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("--isolate: each file has its own window, closed after its afterAll hooks", async () => {
    const file = (name: string) => `// ${VITEST} ${name}
      import { afterAll } from "bun:test";
      afterAll(() => console.log("afterAll", environment));
      ${logEnvironment}`;
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "1.test.js": file("happy-dom"),
      "2.test.js": file("happy-dom"),
      "3.test.js": file("jsdom"),
      "4.test.js": logEnvironment,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
      "1.test.js happy-dom#1 http://localhost:3000",
      "afterAll happy-dom#1",
      "abort happy-dom#1",
      "close happy-dom#1",
      "2.test.js happy-dom#2 http://localhost:3000",
      "afterAll happy-dom#2",
      "abort happy-dom#2",
      "close happy-dom#2",
      "3.test.js jsdom#1 http://localhost:3000",
      "afterAll jsdom#1",
      "close jsdom#1",
      "4.test.js node ",
    ]);
    expect(stdout.filter(line => line.startsWith("open "))).toHaveLength(3);
    expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("--isolate: the package is evaluated once, outside the files' globals", async () => {
    const file = `
      import { expect, test } from "bun:test";
      test("environment", () => {
        expect(globalThis.leftByAnotherFile).toBeUndefined();
        globalThis.leftByAnotherFile = true;
        Array.prototype.leftByAnotherFile = true;
        console.log(environment, packageSees());
      });`;
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "node_modules/jsdom/index.js": `
        console.log("evaluated");
        ${fakePackages["node_modules/jsdom/index.js"]}
        const { JSDOM } = exports;
        exports.JSDOM = class extends JSDOM {
          constructor(...args) {
            super(...args);
            this.window.packageSees = () => [typeof leftByAnotherFile, typeof [].leftByAnotherFile, typeof document].join();
          }
        };`,
      "bunfig.toml": `[test]\nenvironment = "jsdom"\n`,
      "1.test.js": file,
      "2.test.js": file,
      "3.test.js": file,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stdout.filter(line => !/^(?:open|close) /.test(line))).toEqual([
      "evaluated",
      "jsdom#1 undefined,undefined,undefined",
      "jsdom#2 undefined,undefined,undefined",
      "jsdom#3 undefined,undefined,undefined",
    ]);
    expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("--isolate: the window that jsdom keeps is not a test file's", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "node_modules/jsdom/index.js": `
        ${fakePackages["node_modules/jsdom/index.js"]}
        const { JSDOM } = exports;
        let kept;
        exports.JSDOM = class extends JSDOM {
          constructor(html, options = { url: "about:blank" }) {
            super(html, options);
            this.window.document.documentElement = {};
            this.window.getComputedStyle = () => (kept ??= this.window).location.href;
          }
        };`,
      "1.test.js": `// ${VITEST} jsdom
        import { test } from "bun:test";
        test("environment", () => console.log(location.href, getComputedStyle(document.documentElement)));`,
    });
    for (const [flags, kept] of [
      [["--isolate"], "about:blank"],
      [[], "http://localhost:3000"],
    ] as const) {
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags);
      expect(stdout.filter(line => !/^(?:open|close) /.test(line))).toEqual([`http://localhost:3000 ${kept}`]);
      expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    }
  });

  test("--isolate: a file that leaves fake timers on does not keep its window from closing", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      // The real happy-dom's abort() also waits on a timer from the setTimeout it captured at load.
      "node_modules/happy-dom/index.js": `${fakePackages["node_modules/happy-dom/index.js"]}
        const { setTimeout } = globalThis;
        const { Window } = exports;
        exports.Window = class extends Window {
          constructor(...args) {
            super(...args);
            this.happyDOM.abort = () => new Promise(resolve => setTimeout(resolve, 1));
          }
        };`,
      "1.test.js": `// ${VITEST} happy-dom
        import { test, jest } from "bun:test";
        test("fake timers", () => {
          jest.useFakeTimers();
        });`,
      "2.test.js": logEnvironment,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["close happy-dom#1", "2.test.js node "]);
    expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test.each([[[]], [["--isolate"]]])("--rerun-each keeps the window %j", async flags => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "screen.js": `export const body = document.body;`,
      "a.test.js": `// ${VITEST} happy-dom
        import { test, expect } from "bun:test";
        import { body } from "./screen.js";
        test("is bound to this file's document", () => {
          expect(body).toBe(document.body);
        });`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--rerun-each=3", ...flags);
    expect(stdout.map(line => line.split(" ").slice(0, 2).join(" "))).toEqual([
      "open happy-dom#1",
      ...(flags.length ? ["abort happy-dom#1", "close happy-dom#1"] : []),
    ]);
    expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("a window that fails to close is reported as an error", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "node_modules/jsdom/index.js": `${fakePackages["node_modules/jsdom/index.js"]}
        const { JSDOM } = exports;
        exports.JSDOM = class extends JSDOM {
          constructor(...args) {
            super(...args);
            this.window.close = () => { throw new Error("cannot close jsdom"); };
          }
        };`,
      "node_modules/happy-dom/index.js": `${fakePackages["node_modules/happy-dom/index.js"]}
        const { Window } = exports;
        exports.Window = class extends Window {
          constructor(...args) {
            super(...args);
            this.happyDOM.abort = async () => { throw new Error("cannot abort happy-dom"); };
          }
        };`,
      "1.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
      "2.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      "3.test.js": logEnvironment,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stderr).toContain("error: cannot close jsdom");
    expect(stderr).toContain("error: cannot abort happy-dom");
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
      "1.test.js jsdom#1 http://localhost:3000",
      "2.test.js happy-dom#1 http://localhost:3000",
      "3.test.js node ",
    ]);
    expect(summary(stderr)).toEqual(["3 pass", "0 fail", "2 errors"]);
    expect(exitCode).toBe(1);
  });

  test("a window that never finishes closing is reported as an error", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "node_modules/happy-dom/index.js": `${fakePackages["node_modules/happy-dom/index.js"]}
        const { Window } = exports;
        exports.Window = class extends Window {
          constructor(...args) {
            super(...args);
            this.happyDOM.abort = () => new Promise(() => {});
          }
        };`,
      "1.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      "2.test.js": logEnvironment,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stderr).toContain(
      errorBetweenTests(
        "error: The test environment never finished closing",
        "note: the event loop is empty, so nothing can settle it anymore",
      ),
    );
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
      "1.test.js happy-dom#1 http://localhost:3000",
      "2.test.js node ",
    ]);
    expect(summary(stderr)).toEqual(["2 pass", "0 fail", "1 error"]);
    expect(exitCode).toBe(1);
  });

  test("--timeout also limits how long a window may take to close", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      "node_modules/happy-dom/index.js": `${fakePackages["node_modules/happy-dom/index.js"]}
        const { Window } = exports;
        exports.Window = class extends Window {
          constructor(...args) {
            super(...args);
            this.happyDOM.abort = () => new Promise(() => void setInterval(() => {}, 1));
          }
        };`,
      // Each test sets its own timeout, so --timeout=50 only applies to closing the window.
      "1.test.js": `// ${VITEST} happy-dom
        import { test } from "bun:test";
        test("happy-dom", () => console.log(typeof document), 60_000);`,
      "2.test.js": `
        import { test } from "bun:test";
        test("node", () => console.log(typeof document), 60_000);`,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate", "--timeout=50");
    expect(stderr).toContain(errorBetweenTests("error: The test environment did not finish closing within 50ms"));
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["object", "undefined"]);
    expect(summary(stderr)).toEqual(["2 pass", "0 fail", "1 error"]);
    expect(exitCode).toBe(1);
  });

  describe("--preload", () => {
    const preload = `console.log("preload", typeof document === "undefined" ? "node" : environment);`;

    test.each([[[]], [["--isolate"]]])("runs in the project's environment %j", async flags => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "bunfig.toml": `[test]\nenvironment = "happy-dom"\npreload = ["./preload.js"]\n`,
        "preload.js": preload,
        "1.test.js": logEnvironment,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags);
      expect(
        stdout.filter(line => !/^(?:open|abort|close) /.test(line)).map(line => line.split(" ").slice(0, 2).join(" ")),
      ).toEqual([
        "preload happy-dom#1",
        "1.test.js happy-dom#1",
        ...(flags.length ? ["preload happy-dom#2", "2.test.js happy-dom#2"] : ["2.test.js happy-dom#1"]),
      ]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each([
      ["happy-dom", "node", "happy-dom#1"],
      ["happy-dom", "jsdom", "happy-dom#1"],
      ["node", "jsdom", "node"],
      ["", "happy-dom", "node"],
    ])("without --isolate, project %j and first file %j: %s", async (project, first, expected) => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "bunfig.toml": `[test]\npreload = ["./preload.js"]\n${project ? `environment = "${project}"\n` : ""}`,
        "preload.js": `${preload}
          import { beforeAll } from "bun:test";
          console.log("main", Bun.main === process.cwd() + require("node:path").sep + "1.test.js");
          beforeAll(() => console.log("beforeAll"));`,
        "1.test.js": `// ${VITEST} ${first}\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "./1.test.js", "./2.test.js");
      expect(
        stdout.filter(line => !line.startsWith("open ")).map(line => line.split(" ").slice(0, 2).join(" ")),
      ).toEqual([
        `preload ${expected}`,
        "main true",
        "beforeAll",
        `1.test.js ${first === "node" ? "node" : `${first}#1`}`,
        `2.test.js ${expected}`,
      ]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("without --isolate, a first file with its own options gets a separate window", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "preload.js": preload,
        "1.test.js": `// ${VITEST}-options { "url": "https://example.com/" }\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--preload=./preload.js",
        "--environment=happy-dom",
        "./1.test.js",
        "./2.test.js",
      );
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
        "preload happy-dom#1",
        "1.test.js happy-dom#2 https://example.com/",
        "2.test.js happy-dom#1 http://localhost:3000",
      ]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("--isolate: runs in the environment of each file", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "preload.js": preload,
        "1.test.js": `// ${VITEST} jsdom\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--isolate",
        "--preload=./preload.js",
        "--environment=happy-dom",
      );
      expect(
        stdout.filter(line => !/^(?:open|abort|close) /.test(line)).map(line => line.split(" ").slice(0, 2).join(" ")),
      ).toEqual(["preload jsdom#1", "1.test.js jsdom#1", "preload happy-dom#1", "2.test.js happy-dom#1"]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("that throws in the project's environment fails the file", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "preload.js": `throw new Error("preload in " + environment);`,
        "1.test.js": `// ${VITEST} node\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--preload=./preload.js", "--environment=jsdom");
      expect(stderr).toContain("error: preload in jsdom#1");
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual([]);
      expect(summary(stderr)).toEqual(["0 pass", "1 fail", "1 error"]);
      expect(exitCode).toBe(1);
    });

    test("window properties it defines are kept for every file in that environment", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        "preload.js": `Object.defineProperty(window, "matchMedia", { writable: true, value: () => "mocked" });`,
        "1.test.js": `import { test } from "bun:test"; test("1", () => console.log(matchMedia()));`,
        "2.test.js": `// ${VITEST} node\nimport { test } from "bun:test"; test("2", () => console.log(typeof matchMedia));`,
        "3.test.js": `import { test } from "bun:test"; test("3", () => console.log(matchMedia()));`,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--preload=./preload.js",
        "--environment=happy-dom",
      );
      expect(stdout.filter(line => !line.startsWith("open "))).toEqual(["mocked", "undefined", "mocked"]);
      expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    // The setup docs/test/dom.mdx has long recommended, in a project that kept its old runner's comments.
    test("that registers its own DOM wins over environment comments", async () => {
      using dir = tempDir("test-environment", {
        "preload.js": `globalThis.document = { body: {} }; globalThis.environment = "preloaded";`,
        "1.test.js": `// ${JEST} jsdom\n${logEnvironment}`,
        "2.test.js": logEnvironment,
        "3.test.js": `// ${VITEST} happy-dom\n${logEnvironment}`,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--preload=./preload.js");
      expect(warnings(stderr)).toEqual([]);
      expect(stdout).toEqual(["1.test.js preloaded ", "2.test.js preloaded ", "3.test.js preloaded "]);
      expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent("test environment with the real", () => {
  function project(files: Record<string, string>) {
    const dir = tempDir("test-environment", files);
    mkdirSync(join(String(dir), "node_modules"));
    for (const name of ["jsdom", "happy-dom"]) {
      const target = dirname(Bun.resolveSync(`${name}/package.json`, import.meta.dir));
      symlinkSync(target, join(String(dir), "node_modules", name), "junction");
    }
    return dir;
  }

  test.each(["jsdom", "happy-dom"])(
    "%s: with --isolate=modules a file sees nothing of the window before it",
    async name => {
      using dir = project({
        "a.test.js": `
        // ${VITEST} ${name}
        test("a", () => {
          document.body.innerHTML = "<p id='left'>left</p>";
          document.title = "a";
          localStorage.setItem("left", "1");
          window.left = 1;
          innerWidth = 123;
          Object.defineProperty(window, "matchMedia", { value: () => "a", configurable: true });
          HTMLElement.prototype.left = 1;
          addEventListener("ping", () => console.log("a hears ping"));
          document.addEventListener("ping", () => console.log("a hears ping"));
          globalThis.documentOfA = document;
          require("node:fs").documentOfA = document;
        });
      `,
        "b.test.js": `
        // ${VITEST} ${name}
        test("b", () => {
          dispatchEvent(new Event("ping"));
          document.dispatchEvent(new Event("ping"));
          expect({
            body: document.body.innerHTML,
            title: document.title,
            stored: localStorage.getItem("left"),
            left: "left" in window,
            innerWidth,
            matchMedia: typeof matchMedia === "function" && matchMedia("x") === "a",
            prototype: "left" in HTMLElement.prototype,
            documentOfA: "documentOfA" in globalThis,
            sameDocument: require("node:fs").documentOfA === document,
            window: window === globalThis && document.defaultView === globalThis,
            element: document.createElement("div") instanceof HTMLElement,
          }).toEqual({
            body: "",
            title: "",
            stored: null,
            left: false,
            innerWidth: 1024,
            matchMedia: false,
            // happy-dom's classes belong to the package, which a process loads once. jsdom makes them for each window.
            prototype: ${name === "happy-dom"},
            documentOfA: false,
            sameDocument: false,
            window: true,
            element: true,
          });
        });
      `,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate=modules");
      expect(stdout).toEqual([]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    },
  );

  test.each(["jsdom", "happy-dom"])(
    "%s: with --isolate=modules every file has all the names of its window",
    async name => {
      const file = `
      // ${VITEST} ${name}
      test("names", () => {
        console.log(typeof getSelection, typeof customElements, typeof CSSStyleSheet, Object.getOwnPropertyNames(globalThis).length);
      });
    `;
      using dir = project({ "a.test.js": file, "b.test.js": file, "c.test.js": file, "d.test.js": file });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate=modules");
      expect(stdout[0]).toStartWith("function object function ");
      expect(stdout).toEqual([stdout[0], stdout[0], stdout[0], stdout[0]]);
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    },
  );

  const dom = `
    import { test, expect, afterAll } from "bun:test";
    import { body } from "./screen.js";

    test("the window is the global object", () => {
      expect(window).toBe(globalThis);
      expect(self).toBe(globalThis);
      expect(top).toBe(globalThis);
      expect(parent).toBe(globalThis);
      expect(document.defaultView).toBe(globalThis);
      expect(location.href).toBe("https://example.com/path");
      expect(document.hidden).toBe(false);
      expect(typeof requestAnimationFrame).toBe("function");
    });

    test("a module that read the document when it was imported", () => {
      expect(body).toBe(document.body);
    });

    test("elements and events", () => {
      document.body.innerHTML = "<button id='b'>hello</button>";
      const button = document.getElementById("b");
      expect(button).toBeInstanceOf(HTMLButtonElement);
      expect(button).toBeInstanceOf(HTMLElement);
      expect(button).toBeInstanceOf(Node);
      const events = [];
      button.addEventListener("click", event => events.push(event instanceof MouseEvent));
      button.click();
      button.dispatchEvent(new MouseEvent("click"));
      expect(events).toEqual([true, true]);

      let heard = 0;
      const listener = () => heard++;
      addEventListener("ping", listener);
      dispatchEvent(new Event("ping"));
      window.removeEventListener("ping", listener);
      dispatchEvent(new Event("ping"));
      expect(heard).toBe(1);
      document.body.innerHTML = "";
    });

    test("window.onerror is the window's", () => {
      let calls = 0;
      window.onerror = () => (calls++, true);
      window.dispatchEvent(new ErrorEvent("error", { message: "oops", error: null }));
      window.onerror = null;
      expect(calls).toBe(1);
    });

    test("assigning to a global reaches the window", () => {
      const width = innerWidth;
      innerWidth = 320;
      expect(window.innerWidth).toBe(320);
      innerWidth = width;
    });

    test("Bun's APIs", async () => {
      expect(structuredClone({ a: 1 })).toEqual({ a: 1 });
      expect(new TextDecoder().decode(new TextEncoder().encode("é"))).toBe("é");
      expect(await Bun.file(import.meta.path).text()).toContain("Bun's APIs");
      expect(readFileSync(import.meta.path, "utf8")).toContain("Bun's APIs");
      expect(URL.createObjectURL(new Blob(["x"]))).toStartWith("blob:");
      expect(new URL("/x", location.href)).toBeInstanceOf(URL);
      expect(new Request(location.href)).toBeInstanceOf(Request);
    });

    afterAll(() => {
      expect(typeof document).toBe("object");
      console.log("afterAll");
    });
  `;

  const only = {
    "jsdom": `
      import { readFileSync } from "node:fs";
      test("fetch is Bun's", async () => {
        using server = Bun.serve({ port: 0, fetch: async request => new Response(request.method + (await request.text())) });
        const form = new FormData();
        form.append("a", "b");
        expect(form).toBeInstanceOf(jsdom.window.FormData);
        expect(await (await fetch(new Request(server.url, { method: "POST", body: new Blob(["blob"]) }))).text()).toBe("POSTblob");
        expect(await (await fetch(new Request(server.url, { method: "POST", body: form }))).text()).toContain('name="a"');
        expect(() => new Request("/relative")).toThrow();
        expect([Request.name, URL.name]).toEqual(["Request", "URL"]);
      });
      test("a listener takes the signal of Bun's AbortController", () => {
        let clicks = 0;
        const controller = new AbortController();
        expect(controller.signal).not.toBeInstanceOf(jsdom.window.AbortSignal);
        expect(document.body).toBeInstanceOf(EventTarget);
        document.body.addEventListener("click", () => clicks++, { signal: controller.signal });
        document.body.click();
        controller.abort();
        document.body.click();
        expect(clicks).toBe(1);
      });
    `,
    "happy-dom": `
      import { readFileSync } from "node:fs";
      test("fetch is the window's", () => {
        expect(new Request("/relative").url).toBe("https://example.com/relative");
        expect(new Response("x").constructor).toBe(Response);
        expect(Object.getPrototypeOf(new AbortController().signal)).toBe(AbortSignal.prototype);
      });
    `,
  };

  const node = `
    import { test, expect } from "bun:test";
    test("no DOM", () => {
      expect([typeof window, typeof document, typeof HTMLElement, typeof location, typeof jsdom, typeof happyDOM]).toEqual(Array(6).fill("undefined"));
      expect(self).toBe(globalThis);
      expect(new TextEncoder().encode("a")).toBeInstanceOf(Uint8Array);
      expect(new Request("http://localhost/").constructor).toBe(Request);
      expect(Object.getPrototypeOf(Request)).toBe(Function.prototype);
      expect(Object.getPrototypeOf(URL)).toBe(Function.prototype);
      expect(new AbortController().signal).toBeInstanceOf(EventTarget);
    });
  `;

  test.each(["jsdom", "happy-dom"] as const)("%s", async name => {
    const comments = `/**\n * ${VITEST} ${name}\n * ${VITEST}-options { "url": "https://example.com/path" }\n */\n`;
    using dir = project({
      "screen.js": `export const body = document.body;`,
      "1.test.js": comments + dom + only[name],
      "2.test.js": node,
      "3.test.js": comments + dom + only[name],
      "4.test.js": node,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir));
    expect(stderr).not.toContain("error:");
    expect(stdout).toEqual(["afterAll", "afterAll"]);
    expect(summary(stderr)).toEqual([name === "jsdom" ? "18 pass" : "16 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("jsdom and happy-dom under --isolate", async () => {
    const file = (name: keyof typeof only) =>
      `// ${VITEST} ${name}\n// ${VITEST}-options { "url": "https://example.com/path" }\n${dom}${only[name]}`;
    using dir = project({
      "screen.js": `export const body = document.body;`,
      "1.test.js": file("jsdom"),
      "2.test.js": node,
      "3.test.js": file("happy-dom"),
      "4.test.js": node,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate");
    expect(stderr).not.toContain("error:");
    expect(stdout).toEqual(["afterAll", "afterAll"]);
    expect(summary(stderr)).toEqual(["17 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("jsdom: an error thrown by an event listener fails the test", async () => {
    using dir = project({
      "a.test.js": `// ${VITEST} jsdom
        import { test, expect } from "bun:test";
        test("throws in a listener", () => {
          document.body.addEventListener("click", () => {
            throw new Error("from the listener");
          });
          document.body.click();
        });
        test("has an error listener of its own", () => {
          const errors = [];
          const listener = event => errors.push(event.error.message);
          window.addEventListener("error", listener);
          document.body.click();
          window.removeEventListener("error", listener);
          expect(errors).toEqual(["from the listener"]);
        });`,
    });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(stderr).toContain("error: from the listener");
    expect(summary(stderr)).toEqual(["1 pass", "1 fail"]);
    expect(exitCode).toBe(1);
  });

  // jsdom drops errors raised while it's already reporting one, so the next test must not start inside that report.
  test("jsdom: an error that ends a test doesn't hide the next test's errors", async () => {
    using dir = project({
      "a.test.js": `// ${VITEST} jsdom
        import { test } from "bun:test";
        test("throws in a frame callback", done => {
          requestAnimationFrame(() => {
            throw new Error("from the frame callback");
          });
        });
        test("throws in a listener", () => {
          document.body.addEventListener("click", () => {
            throw new Error("from the listener");
          });
          document.body.click();
        });`,
    });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(stderr).toContain("error: from the frame callback");
    expect(stderr).toContain("error: from the listener");
    expect(stderr).not.toContain("# Unhandled error between tests");
    expect(verdicts(stderr)).toEqual({ "throws in a frame callback": "fail", "throws in a listener": "fail" });
    expect(summary(stderr)).toEqual(["0 pass", "2 fail"]);
    expect(exitCode).toBe(1);
  });

  const throwInListener = `
    function throwInListener() {
      const button = document.createElement("button");
      button.addEventListener("click", () => {
        throw new Error("from the listener");
      });
      button.click();
    }
  `;

  describe("jsdom: an error goes to the runner unless the file listens for errors", () => {
    // [what the file does, whether vitest 5.0.3 then reports the error]. The files share one window and clean
    // nothing up, yet each must get the answer it gets alone.
    const files: [code: string, isReported: boolean][] = [
      [``, true],
      [`window.addEventListener("error", event => event.stopPropagation(), true);`, false],
      [`window.addEventListener("error", event => event.stopImmediatePropagation(), true);`, false],
      [`window.addEventListener("error", event => event.stopImmediatePropagation());`, false],
      [``, true],
      [`jsdom.window.addEventListener("error", () => {});`, false],
      [`window.dispatchEvent = EventTarget.prototype.dispatchEvent = () => true;`, true],
      [`window.addEventListener("error", () => {});`, false],
      [`addEventListener("error", () => {});`, false],
      [`window.addEventListener("error", event => event.preventDefault());`, false],
      [`window.addEventListener("error", null);`, false],
      [`window.addEventListener("error", listener); window.removeEventListener("error", listener);`, true],
      [`window.addEventListener("error", () => {}, { once: true });`, false],
      [`window.addEventListener("error", () => {}, { once: true }); throwInListener();`, false],
      [`window.addEventListener("error", () => {}, { signal: AbortSignal.abort() });`, false],
      [`window.addEventListener("error", listener, true); window.removeEventListener("error", listener, false);`, true],
      [`window.addEventListener("error", () => {}); window.removeEventListener("error", listener);`, true],
      [`window.removeEventListener("error", listener);`, true],
      [`window.removeEventListener("error", listener); window.addEventListener("error", listener);`, false],
      [
        `window.addEventListener("error", listener); window.addEventListener("error", listener); window.removeEventListener("error", listener);`,
        false,
      ],
      [`window.onerror = () => {};`, true],
      [`window.onerror = () => true;`, true],
      [`document.addEventListener("error", () => {});`, true],
      [``, true],
    ];

    // Only the listener count decides, so Bun reports these. vitest doesn't, as its own listener runs late or throws.
    const notCounted: typeof files = [
      [
        `const stop = event => event.stopPropagation(); window.addEventListener("error", stop, true); window.removeEventListener("error", stop, false);`,
        true,
      ],
      [
        `EventTarget.prototype.addEventListener.call(jsdom.window, "error", event => event.stopImmediatePropagation(), true);`,
        true,
      ],
      [`Event.prototype.preventDefault = () => { throw new Error("patched"); };`, true],
      [``, true],
    ];

    test.each([
      ["as in vitest", files],
      ["whatever a listener that is not counted does to the event", notCounted],
    ])("%s", async (_, files) => {
      using dir = project(
        Object.fromEntries(
          files.map(([code], i) => [
            `${String(i).padStart(2, "0")}.test.js`,
            `// ${VITEST} jsdom
            import { test } from "bun:test";
            ${throwInListener}
            test("file ${i}", () => {
              const listener = () => {};
              ${code}
              throwInListener();
            });`,
          ]),
        ),
      );
      const { stderr, exitCode } = await bunTest(String(dir));
      const reported = files.filter(([, isReported]) => isReported).length;
      expect(stderr).toContain("error: from the listener");
      expect(stderr).not.toContain("# Unhandled error between tests");
      expect(verdicts(stderr)).toEqual(
        Object.fromEntries(files.map(([, isReported], i) => [`file ${i}`, isReported ? "fail" : "pass"])),
      );
      expect(summary(stderr)).toEqual([`${files.length - reported} pass`, `${reported} fail`]);
      expect(exitCode).toBe(1);
    });

    test("an element's error event only counts if it bubbles to the window, as in vitest", async () => {
      const events: [code: string, isReported: boolean][] = [
        [`element.dispatchEvent(new Event("error"));`, false],
        [`element.dispatchEvent(new ErrorEvent("error", { error }));`, false],
        [`element.dispatchEvent(new ErrorEvent("error", { error, bubbles: true }));`, true],
        [
          `element.addEventListener("error", event => event.stopPropagation()); element.dispatchEvent(new ErrorEvent("error", { error, bubbles: true }));`,
          false,
        ],
        [`document.dispatchEvent(new ErrorEvent("error", { error, bubbles: true }));`, true],
      ];
      using dir = project({
        "a.test.js": `// ${VITEST} jsdom
          import { test } from "bun:test";
          ${events
            .map(
              ([code], i) => `test("event ${i}", () => {
                const error = new Error("of an element");
                const element = document.body.appendChild(document.createElement("div"));
                ${code}
              });`,
            )
            .join("\n")}`,
      });
      const { stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).toContain("error: of an element");
      expect(stderr).not.toContain("# Unhandled error between tests");
      expect(verdicts(stderr)).toEqual(
        Object.fromEntries(events.map(([, isReported], i) => [`event ${i}`, isReported ? "fail" : "pass"])),
      );
      expect(summary(stderr)).toEqual(["3 pass", "2 fail"]);
      expect(exitCode).toBe(1);
    });

    test("--rerun-each", async () => {
      using dir = project({
        "a.test.js": `// ${VITEST} jsdom
          import { test } from "bun:test";
          ${throwInListener}
          test("reported", throwInListener);
          test("leaves a listener", () => window.addEventListener("error", () => {}));`,
      });
      const { stderr, exitCode } = await bunTest(String(dir), "--rerun-each=2");
      expect(summary(stderr)).toEqual(["2 pass", "2 fail"]);
      expect(exitCode).toBe(1);
    });

    test.each([[[]], [["--isolate"]]])("a preload's error listener counts for every file %j", async flags => {
      const file = `// ${VITEST} jsdom
        import { test } from "bun:test";
        ${throwInListener}
        test("not reported", throwInListener);`;
      using dir = project({
        "preload.js": `window.addEventListener("error", event => console.log(event.error.message));`,
        "1.test.js": `${file}\ntest("removes a listener that was never added", () => window.removeEventListener("error", () => {}));`,
        "2.test.js": file,
      });
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--environment=jsdom",
        "--preload=./preload.js",
        ...flags,
      );
      expect(stdout).toEqual(["from the listener", "from the listener"]);
      expect(summary(stderr)).toEqual(["3 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("errors are reported again once a file removes the preload's listener", async () => {
      const file = (title: string) => `// ${VITEST} jsdom
        import { test } from "bun:test";
        ${throwInListener}
        test("${title}", throwInListener);`;
      using dir = project({
        "preload.js": `window.addEventListener("error", (globalThis.preloadListener = () => {}));`,
        "1.test.js": `${file("not reported")}\ntest("removes it", () => window.removeEventListener("error", preloadListener));`,
        "2.test.js": file("reported"),
      });
      const { stderr, exitCode } = await bunTest(String(dir), "--environment=jsdom", "--preload=./preload.js");
      expect(stderr).toContain("(pass) not reported");
      expect(stderr).toContain("(fail) reported");
      expect(summary(stderr)).toEqual(["2 pass", "1 fail"]);
      expect(exitCode).toBe(1);
    });
  });

  // The typed arrays and ArrayBuffer are the window's there, as in vitest, where these are all false but Response's.
  test.each([[], ["--isolate"], ["--isolate=modules"]])(
    "jsdom: binary data that Bun makes is an instance of the global classes: %s",
    async (...args) => {
      using dir = project({
        "binary.test.js": `// ${VITEST} jsdom
          import { test, expect } from "bun:test";
          import { readFileSync } from "node:fs";
          import { runInNewContext } from "node:vm";

          const names = [
            "ArrayBuffer", "Uint8Array", "Uint16Array", "Uint32Array", "Uint8ClampedArray", "Int8Array", "Int16Array",
            "Int32Array", "Float32Array", "Float64Array",
          ];

          test("the globals are the window's", () => {
            for (const name of names) expect(globalThis[name]).toBe(window[name]);
            expect(Object.getPrototypeOf(Buffer.prototype)).not.toBe(Uint8Array.prototype);
          });

          test("a Uint8Array", async () => {
            const values = [
              new TextEncoder().encode("a"),
              Buffer.from("a"),
              readFileSync(import.meta.path),
              structuredClone(new Uint8Array(1)),
              await new Response("a").bytes(),
              new Uint8Array(1),
            ];
            for (const value of values) {
              expect(value instanceof Uint8Array).toBe(true);
              expect(value).toBeInstanceOf(Uint8Array);
              expect(value).not.toBeInstanceOf(ArrayBuffer);
            }
          });

          test("an ArrayBuffer", async () => {
            for (const value of [Buffer.alloc(1).buffer, await new Response("a").arrayBuffer(), new ArrayBuffer(1)]) {
              expect(value instanceof ArrayBuffer).toBe(true);
              expect(value).not.toBeInstanceOf(Uint8Array);
            }
          });

          test("each class has its own kind only", () => {
            for (const made of names) {
              const value = runInNewContext("new " + made + "(8)");
              expect(names.filter(name => value instanceof globalThis[name])).toEqual([made]);
            }
          });

          test("nothing else", () => {
            for (const value of [null, undefined, 1, "a", {}, [], { byteLength: 1 }, new DataView(new ArrayBuffer(1))])
              expect(names.filter(name => value instanceof globalThis[name])).toEqual([]);
          });

          test("what inherits from the prototype, as ever", () => {
            expect(Object.create(Uint8Array.prototype) instanceof Uint8Array).toBe(true);
          });

          test("a subclass has its own instances only", () => {
            class Bytes extends Uint8Array {}
            expect(new Bytes(1) instanceof Bytes).toBe(true);
            expect(new Bytes(1) instanceof Uint8Array).toBe(true);
            expect(new Uint8Array(1) instanceof Bytes).toBe(false);
            expect(Buffer.alloc(1) instanceof Bytes).toBe(false);
          });
        `,
      });
      const { stderr, exitCode } = await bunTest(String(dir), ...args);
      expect(summary(stderr)).toEqual(["7 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    },
  );

  // React 19 calls reportError() where there is one. Node has none, so under vitest React dispatches the event itself.
  test.each(["jsdom", "happy-dom"])("%s: reportError() dispatches an error event at the window", async name => {
    using dir = project({
      "report.test.js": `// ${VITEST} ${name}
        import { test, expect, spyOn } from "bun:test";

        function report(error, listener) {
          window.addEventListener("error", listener);
          try {
            reportError(error);
          } finally {
            window.removeEventListener("error", listener);
          }
        }

        test("a listener that cancels it", () => {
          const log = spyOn(console, "error").mockImplementation(() => {});
          const error = new Error("canceled");
          const heard = [];
          report(error, event => {
            heard.push(event instanceof ErrorEvent, event.error === error, event.message, event.cancelable);
            event.preventDefault();
          });
          expect(heard).toEqual([true, true, "canceled", true]);
          expect(log).not.toHaveBeenCalled();
          log.mockRestore();
        });

        test("a listener that only looks", () => {
          const log = spyOn(console, "error").mockImplementation(() => {});
          const error = new Error("looked at");
          let heard;
          report(error, event => (heard = event.error));
          expect(heard).toBe(error);
          expect(log.mock.calls).toEqual([[error]]);
          log.mockRestore();
        });

        test("what is not an error", () => {
          const messages = [];
          // The ErrorEvent of both libraries has null for an \`error\` of undefined.
          for (const value of ["text", 1, null, undefined, { message: 2 }])
            report(value, event => (messages.push([event.error === (value ?? null), event.message]), event.preventDefault()));
          expect(messages).toEqual([
            [true, "text"],
            [true, "1"],
            [true, "null"],
            [true, "undefined"],
            [true, "[object Object]"],
          ]);
          expect(() => reportError()).toThrow(TypeError);
        });

        test("it is the window's", () => {
          expect(window.reportError).toBe(reportError);
        });
      `,
    });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(verdicts(stderr)).toEqual({
      "a listener that cancels it": "pass",
      "a listener that only looks": "pass",
      "what is not an error": "pass",
      "it is the window's": "pass",
    });
    expect(exitCode).toBe(0);
  });

  test("jsdom: what reportError() reports is the runner's when the file does not listen for errors", async () => {
    using dir = project({
      "report.test.js": `// ${VITEST} jsdom
        import { test } from "bun:test";
        test("nobody listens", () => reportError(new Error("nobody listens")));
        test("the next test", () => {});
      `,
    });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(stderr).toContain("error: nobody listens");
    expect(verdicts(stderr)).toEqual({ "nobody listens": "fail", "the next test": "pass" });
    expect(exitCode).toBe(1);
  });

  test("reportError() is Bun's again in a file without a DOM", async () => {
    using dir = project({
      "a.test.js": `// ${VITEST} jsdom
        test("with a window", () => expect(reportError.toString()).not.toContain("[native code]"));`,
      "b.test.js": `
        test("without one", () => expect(reportError.toString()).toContain("[native code]"));`,
    });
    const { stderr, exitCode } = await bunTest(String(dir));
    expect(verdicts(stderr)).toEqual({ "with a window": "pass", "without one": "pass" });
    expect(exitCode).toBe(0);
  });

  describe("a window closed by a file", () => {
    const file = (name: string, code: string) => `// ${VITEST} ${name}
      import { test, expect } from "bun:test";
      test("${name}", () => {
        document.body.innerHTML = "<b>1</b>";
        expect(document.querySelector("b").textContent).toBe("1");
        ${code}
      });`;

    test("isn't reused for the next file", async () => {
      using dir = project({
        "1.test.js": file("jsdom", "window.close();"),
        "2.test.js": file("jsdom", ""),
        "3.test.js": file("happy-dom", "window.close();"),
        "4.test.js": file("happy-dom", ""),
      });
      const { stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).not.toContain("error:");
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each([[[]], [["--isolate"]]])("isn't reused for the next --rerun-each run %j", async flags => {
      using dir = project({
        "1.test.js": file("jsdom", "window.close();"),
        "2.test.js": file("happy-dom", "window.close();"),
      });
      const { stderr, exitCode } = await bunTest(String(dir), "--rerun-each=2", ...flags);
      expect(stderr).not.toContain("error:");
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });
  });

  // Builtin modules must keep using Bun's own classes and accept typed arrays from jsdom's realm.
  test.each(["jsdom", "happy-dom"])("%s: builtin modules work as without it", async name => {
    const file = `
      import { test, expect } from "bun:test";
      import { once } from "node:events";
      import { createServer, request } from "node:http";
      import { availableParallelism } from "node:os";
      import { Readable } from "node:stream";
      import { arrayBuffer, blob, buffer, text } from "node:stream/consumers";
      import { gunzipSync, gzipSync } from "node:zlib";

      test("stream/consumers", async () => {
        const from = () => Readable.from([Buffer.from("ab")]);
        expect((await arrayBuffer(from())).byteLength).toBe(2);
        expect((await buffer(from())).toString()).toBe("ab");
        expect(await (await blob(from())).text()).toBe("ab");
      });
      test("shell", async () => {
        expect(await (await Bun.$\`echo hi\`.blob()).text()).toBe("hi\\n");
      });
      test("perf_hooks", () => {
        // Loaded here for the first time, for all the files.
        const { performance } = require("node:perf_hooks");
        expect([typeof performance.eventLoopUtilization, typeof performance.timerify]).toEqual(["function", "function"]);
      });
      test("http", async () => {
        const server = createServer((req, res) => void text(req).then(body => res.end(new Uint8Array([...Buffer.from(body)]))));
        await once(server.listen(0, "127.0.0.1"), "listening");
        try {
          const req = request({ host: "127.0.0.1", port: server.address().port, method: "POST" });
          req.write(new Uint8Array([97]));
          req.end(new Uint8Array([98]));
          expect(await text((await once(req, "response"))[0])).toBe("ab");
        } finally {
          server.close();
        }
      });
      test("zlib", () => {
        expect(gunzipSync(gzipSync(new Uint8Array([97, 98]).buffer)).toString()).toBe("ab");
      });
      test("os", () => {
        expect(availableParallelism()).toBe(Number(process.env.PARALLELISM));
      });
    `;
    using dir = project({
      "1.test.js": `// ${VITEST} ${name}\n${file}`,
      "2.test.js": file,
    });
    await using proc = Bun.spawn({
      // Debug builds take seconds to load node:http.
      cmd: [bunExe(), "test", "--timeout=60000"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_PATH: undefined, PARALLELISM: String(navigator.hardwareConcurrency) },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(summary(stderr)).toEqual(["12 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("the bun:dom test environment", () => {
  const which = `
    import { basename } from "node:path";
    console.log(basename(import.meta.path), "loads with", typeof window, typeof document, typeof XMLHttpRequest);
    test("which", () => {
      const dom = typeof document === "undefined" ? "none" : typeof jsdom === "object" ? "jsdom" : "bun:dom";
      console.log(basename(import.meta.path), dom, typeof location === "undefined" ? "" : location.href);
    });
  `;
  const files = {
    "plain.test.js": which,
    "line.test.js": `// ${VITEST} jsdom\n${which}`,
    "block.test.js": `/**\n * ${VITEST} happy-dom\n */\n${which}`,
    "jest.test.js": `/** ${JEST} jsdom */\n${which}`,
    "node.test.js": `// ${VITEST} node\n${which}`,
    "options.test.js": `// ${VITEST} jsdom\n// ${VITEST}-options {"url":"https://example.com/x"}\n${which}`,
    "preload.js": `console.log("preload sees", typeof window, typeof document, typeof XMLHttpRequest);`,
    "dom.toml": `[test]\nenvironment = "bun:dom"\n`,
  };
  const expected = [
    "block.test.js bun:dom http://localhost:3000/",
    "jest.test.js bun:dom http://localhost:3000/",
    "line.test.js bun:dom http://localhost:3000/",
    "node.test.js none ",
    "options.test.js bun:dom https://example.com/x",
    "plain.test.js bun:dom http://localhost:3000/",
  ];
  const results = (lines: string[]) => lines.filter(line => / (bun:dom|jsdom|none) /.test(line + " ")).sort();

  // No package is installed, so a file that got jsdom or happy-dom would fail to set up.
  test.each([
    ["the flag", ["--environment=bun:dom"], []],
    ["the flag, --isolate", ["--environment=bun:dom", "--isolate"], []],
    ["the flag, --isolate=modules", ["--environment=bun:dom", "--isolate=modules"], []],
    ["the flag, --parallel", ["--environment=bun:dom", "--parallel=2"], []],
    ["the config", [], ["--config=dom.toml"]],
    ["the config, --parallel", ["--parallel=2"], ["--config=dom.toml"]],
  ])("wins over a comment that names another DOM, and not over a node comment: %s", async (_, args, before) => {
    using dir = tempDir("bun-dom-environment", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...before, "test", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NODE_PATH: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A worker's output is replayed on stderr.
    expect({ results: results((stdout + stderr).split("\n")), summary: summary(stderr) }).toEqual({
      results: expected,
      summary: ["6 pass", "0 fail"],
    });
    expect(exitCode).toBe(0);
  });

  test.each([[], ["--isolate"], ["--isolate=modules"]])(
    "preloads and the file's imports see the window: %s",
    async (...args) => {
      using dir = tempDir("bun-dom-preload", files);
      const { stdout, stderr, exitCode } = await bunTest(
        String(dir),
        "--environment=bun:dom",
        "--preload=./preload.js",
        ...args,
        "./plain.test.js",
        "./node.test.js",
      );
      expect(stdout.filter(line => /sees|loads with/.test(line))).toEqual(
        args.length
          ? [
              "preload sees object object function",
              "plain.test.js loads with object object function",
              "preload sees undefined undefined undefined",
              "node.test.js loads with undefined undefined undefined",
            ]
          : [
              "preload sees object object function",
              "plain.test.js loads with object object function",
              "node.test.js loads with undefined undefined undefined",
            ],
      );
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    },
  );

  // React 19 reports what a component throws through it.
  test("reportError() is the window's, not Bun's", async () => {
    using dir = tempDir("bun-dom-report-error", {
      "report.test.js": `
        import { expect, test } from "bun:test";
        test("a listener that cancels it", () => {
          const error = new Error("reported");
          const seen = [];
          const listener = event => {
            seen.push(event.error === error, event.target === window);
            event.preventDefault();
          };
          window.addEventListener("error", listener);
          try {
            reportError(error);
          } finally {
            window.removeEventListener("error", listener);
          }
          expect(seen).toEqual([true, true]);
          expect(window.reportError).toBe(reportError);
        });
        test("nobody listens", () => reportError(new Error("nobody listens")));
      `,
    });
    const { stderr, exitCode } = await bunTest(String(dir), "--environment=bun:dom");
    expect(stderr.split("\n").filter(line => line.startsWith("error: "))).toEqual(["error: nobody listens"]);
    expect(summary(stderr)).toEqual(["1 pass", "1 fail"]);
    expect(exitCode).toBe(1);
  });

  test("a requestAnimationFrame() that was taken before useFakeTimers() still calls back after useRealTimers()", async () => {
    using dir = tempDir("bun-dom-frames", {
      "frames.test.js": `
        import { expect, onTestFinished, test, vi } from "vitest";
        const taken = requestAnimationFrame;
        test("asks for a frame under fake timers", () => {
          vi.useFakeTimers();
          onTestFinished(() => void vi.useRealTimers());
          expect(requestAnimationFrame).not.toBe(taken);
          taken(() => {});
          vi.advanceTimersByTime(1000);
        });
        test("the next test gets its frames", async () => {
          expect(await new Promise(taken)).toBeNumber();
        });
      `,
    });
    const { stderr, exitCode } = await bunTest(String(dir), "--environment=bun:dom");
    expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("URL.createObjectURL() and revokeObjectURL() are back after a test defines and deletes its own", async () => {
    using dir = tempDir("bun-dom-url", {
      "url.test.js": `
        const names = ["createObjectURL", "revokeObjectURL"];
        beforeEach(() => {
          for (const name of names) Object.defineProperty(URL, name, { configurable: true, value: () => "mine" });
        });
        afterEach(() => {
          for (const name of names) delete URL[name];
        });
        test("its own", () => {
          expect(URL.createObjectURL(new Blob(["x"]))).toBe("mine");
        });
        afterAll(() => {
          const url = URL.createObjectURL(new Blob(["x"]));
          URL.revokeObjectURL(url);
          const parsed = new URL("/a?b=1", location.href);
          console.log(url.slice(0, 5), parsed.href, parsed instanceof URL, URL.canParse("x:y"), window.URL === URL, URL.name);
        });
      `,
    });
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--environment=bun:dom");
    expect(stdout.filter(line => line.startsWith("blob:"))).toEqual([
      "blob: http://localhost:3000/a?b=1 true true true URL",
    ]);
    expect(summary(stderr)).toEqual(["1 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("--isolate=modules undoes what a file does to the classes, which every file's window shares", async () => {
    const state = `
      const element = document.createElement("div");
      let assigned = "ok";
      try { element.getBoundingClientRect = () => 1; } catch (error) { assigned = error.message; }
      console.log(JSON.stringify([
        assigned,
        Object.hasOwn(HTMLElement.prototype, "getBoundingClientRect"), Object.hasOwn(HTMLDivElement.prototype, "focus"),
        typeof Element.prototype.getClientRects, typeof Element.prototype.matches, "added" in Node.prototype,
        Object.getOwnPropertyDescriptor(Element.prototype, "id").get.name, "extra" in Element,
      ]));
    `;
    const change = [
      `Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", { value: () => ({}) });`,
      `Object.defineProperty(HTMLDivElement.prototype, "focus", { configurable: true, get: () => () => {} }); delete Element.prototype.getClientRects;`,
      `Element.prototype.matches = 1; Node.prototype.added = 1; Object.defineProperty(Element.prototype, "id", { get() {} }); Element.extra = 1;`,
      ``,
    ];
    using dir = tempDir(
      "bun-dom-classes",
      Object.fromEntries(change.map((code, i) => [`${i}.test.js`, `test("${i}", () => { ${state} ${code} });`])),
    );
    const { stdout, stderr, exitCode } = await bunTest(String(dir), "--environment=bun:dom", "--isolate=modules");
    expect(stdout.filter(line => line.startsWith("["))).toEqual(
      Array(change.length).fill(JSON.stringify(["ok", false, false, "function", "function", false, "get id", false])),
    );
    expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("navigator, MessageEvent, TouchEvent and elementFromPoint take what tests written for jsdom do with them", async () => {
    using dir = tempDir("bun-dom-jsdom-habits", {
      "habits.test.js": `
        import { expect, test, vi } from "bun:test";
        test("navigator", () => {
          expect(navigator).toBeInstanceOf(Navigator);
          expect(window.navigator).toBe(navigator);
          expect([navigator.vendor, navigator.cookieEnabled, navigator.plugins.length]).toEqual(["Apple Computer, Inc.", true, 0]);
          const spy = vi.spyOn(Navigator.prototype, "userAgent", "get").mockReturnValue("a phone");
          expect(navigator.userAgent).toBe("a phone");
          spy.mockRestore();
          expect(navigator.userAgent).toStartWith("Bun/");
          Object.defineProperty(navigator, "userAgent", { value: "a tablet", configurable: true });
          expect(navigator.userAgent).toBe("a tablet");
          Object.defineProperty(Navigator.prototype, "share", { value: vi.fn(), configurable: true });
          navigator.share({ title: "x" });
          expect(navigator.share).toHaveBeenCalledWith({ title: "x" });
        });
        test("MessageEvent", () => {
          const source = { postMessage: vi.fn() };
          let heard;
          window.addEventListener("message", event => (heard = event), { once: true });
          window.dispatchEvent(new MessageEvent("message", { data: "ping", origin: "https://example.com", source }));
          expect(heard.source).toBe(source);
          heard.source.postMessage("pong");
          expect(source.postMessage).toHaveBeenCalledWith("pong");
        });
        test("TouchEvent", () => {
          const seen = [];
          document.body.addEventListener("touchstart", event => seen.push(event.touches[0].clientX, event.changedTouches.length));
          document.body.dispatchEvent(new window.TouchEvent("touchstart", { bubbles: true, touches: [{ clientX: 7 }] }));
          expect(seen).toEqual([7, 0]);
          expect("ontouchstart" in window).toBe(true);
        });
        test("elementFromPoint", () => {
          expect(document.elementFromPoint).toBe(undefined);
          document.elementFromPoint = vi.fn(() => document.body);
          expect(document.elementFromPoint(1, 2)).toBe(document.body);
        });
      `,
    });
    const { stderr, exitCode } = await bunTest(String(dir), "--environment=bun:dom");
    expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });
});
