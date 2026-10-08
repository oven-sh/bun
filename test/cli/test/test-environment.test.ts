import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// In pieces: `bun test` finds these comments anywhere in the text of a test file, this one included.
const VITEST = "@vitest" + "-environment";
const JEST = "@jest" + "-environment";

// Stand-ins that log what the runner does with the package: loading the real ones takes seconds in a debug build.
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

/** Logs the name of the file and the window it runs with. */
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
  // The first line is "bun test v1.2.3".
  return { stdout: stdout.split("\n").slice(1).filter(Boolean), stderr, exitCode };
}

/** How an error that is not a test's is printed, with nothing else: no source lines, no stack. */
function errorBetweenTests(...lines: string[]) {
  const rule = Buffer.alloc(31, "-").toString();
  return ["# Unhandled error between tests", rule, ...lines, rule, ""].join("\n");
}

function warnings(output: string) {
  return output.split("\n").filter(line => /^(?:warn|note): /.test(line));
}

function cannotSetUp(name: string, file: string) {
  return `Cannot set up the "${name}" test environment of "${file}"`;
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

describe.concurrent("test environment", () => {
  test("the comment is found where vitest finds it", async () => {
    // Expectations are what vitest 5.0.3's `detectCodeBlock` returns for the same text.
    const comments: Record<string, [text: string, environment: string]> = {
      "line": [`// ${VITEST} jsdom\n`, "jsdom#1"],
      "block": [`/** ${VITEST} happy-dom */\n`, "happy-dom#1"],
      "jest-docblock": [`/**\n * ${JEST} jsdom\n */\n`, "jsdom#1"],
      "jest-line": [`// ${JEST} happy-dom\n`, "happy-dom#1"],
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
    ]);
    expect(summary(stderr)).toEqual(["6 pass", "0 fail"]);
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

    // --parallel prints what its workers wrote to stdout on stderr.
    test.each(["--isolate", "--parallel=2", "--parallel=2 --no-isolate"])("%s", async flags => {
      using dir = tempDir("test-environment", { ...files, "bunfig.toml": `[test]\nenvironment = "jsdom"\n` });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), ...flags.split(" "));
      expect(environments([...stdout, ...stderr.split("\n")]).sort()).toEqual(withDefault("jsdom#1"));
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test("--parallel passes --environment on to its workers", async () => {
      using dir = tempDir("test-environment", files);
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--parallel=2", "--environment=happy-dom");
      expect(stdout).toEqual([]);
      expect(environments(stderr.split("\n")).sort()).toEqual(withDefault("happy-dom#1"));
      expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });

    test.each(["edge-runtime", "", "JSDOM"])("--environment=%s is refused", async name => {
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
    ])("environment = %s in bunfig.toml is refused", async (value, message) => {
      using dir = tempDir("test-environment", { ...files, "bunfig.toml": `[test]\nenvironment = ${value}\n` });
      const { stdout, stderr, exitCode } = await bunTest(String(dir));
      expect(stderr).toContain(`error: ${message}`);
      expect(stdout).toEqual([]);
      expect(exitCode).toBe(1);
    });
  });

  test("the package is the one the test file resolves", async () => {
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

  // `bun test` ignored the comments for years, and suites that came from Jest or vitest still have them.
  describe("a comment that cannot be followed is a warning, and the file runs without an environment", () => {
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
          `warn: The "${name}" test environment of "${join(String(dir), "a.test.js")}" is not supported`,
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

    test("--isolate: a preload that registers a DOM of its own still does", async () => {
      using dir = tempDir("test-environment", {
        "preload.js": `globalThis.document = { body: {} }; globalThis.environment = "preloaded";`,
        "1.test.js": `// ${JEST} jsdom\n${logEnvironment}`,
        "2.test.js": logEnvironment,
      });
      const { stdout, stderr, exitCode } = await bunTest(String(dir), "--isolate", "--preload=./preload.js");
      expect(warnings(stderr)).toEqual(cannotFindPackage("jsdom", join(String(dir), "1.test.js")));
      expect(stdout).toEqual(["1.test.js preloaded ", "2.test.js preloaded "]);
      expect(summary(stderr)).toEqual(["2 pass", "0 fail"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("the project's environment that cannot be set up fails the file, and the run goes on", () => {
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

    test("the options of a file are not JSON", async () => {
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

    test("every global is put back after a file", async () => {
      using dir = tempDir("test-environment", {
        ...fakePackages,
        // Reading a descriptor is what makes a lazy global of Bun's a plain property: do it before comparing.
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
      // One window per environment: see "a module that read the document when it was imported".
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

    test("what a file assigns or defines is there for the next file of that environment only", async () => {
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

    test("a global that cannot be redefined is left alone", async () => {
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
      "2.test.js happy-dom#1 http://localhost:3000",
      "afterAll happy-dom#1",
      "abort happy-dom#1",
      "close happy-dom#1",
      "3.test.js jsdom#1 http://localhost:3000",
      "afterAll jsdom#1",
      "close jsdom#1",
      "4.test.js node ",
    ]);
    expect(stdout.filter(line => line.startsWith("open "))).toHaveLength(3);
    expect(summary(stderr)).toEqual(["4 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  });

  test("--isolate: a file that leaves fake timers on does not keep its window from closing", async () => {
    using dir = tempDir("test-environment", {
      ...fakePackages,
      // Like happy-dom, which waits for a timer of the setTimeout it took when it was loaded.
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

  test("a window that fails to close is an error of its file", async () => {
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

  test("a window that never finishes closing is an error of its file", async () => {
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
        "note: it is waiting for something that can no longer happen: the event loop has nothing left to run",
      ),
    );
    expect(stdout.filter(line => !line.startsWith("open "))).toEqual([
      "1.test.js happy-dom#1 http://localhost:3000",
      "2.test.js node ",
    ]);
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
        ...(flags.length ? ["preload happy-dom#1"] : []),
        "2.test.js happy-dom#1",
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

    test("without --isolate, a first file with options of its own", async () => {
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

    test("what it defines on the window is there for every file", async () => {
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

    // What docs/test/dom.mdx has long recommended, in projects that kept the comments of their previous runner.
    test("that registers a DOM of its own keeps it", async () => {
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
    // fetch, Response, Headers and AbortController stay Bun's; Request takes the window's Blob and FormData.
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
});
