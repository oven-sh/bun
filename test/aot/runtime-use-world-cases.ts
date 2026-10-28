import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim, featureOf, withoutFeatures } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import {
  accountsFor,
  build,
  closed,
  completeness,
  external,
  open,
  retainsFeature,
  uncompiledModule,
  type Use,
} from "./runtime-use-expectations";
import { unsupported } from "./harness/compiler";
import { declared, of, runtimeUse, tsconfig, withDeclarations } from "./runtime-use-harness";

const groups: [name: string, body: () => void][] = [];
const group = (name: string, body: () => void) => void groups.push([name, body]);

const usesEveryMember = (use: Use) => use.lines.includes("property toTemporalInstant");
const hello = { "main.ts": declared + `console.log("hello");` };

group("import name = a.b, which only TypeScript has", () => {
  const bun = `declare namespace Bun { function color(name: string, format: string): string; }\n`;
  const log = `declare const console: any;\n`;

  test.each([
    [
      "a global",
      log +
        `declare namespace HTMLRewriter { const one: number; }\nimport Rewriter = HTMLRewriter; console.log(Rewriter.one);`,
      ["global HTMLRewriter"],
    ],
    [
      "a member of a global",
      log + `import Format = Intl.NumberFormat; console.log(new Format("de").format(1.5));`,
      ["global Intl", "Intl NumberFormat"],
    ],
  ])("counts as a use of %s", async (_, text, lines) => {
    const use = await runtimeUse({ "main.ts": text });
    expect(lines.filter(line => accountsFor(use, line))).toEqual(lines);
  });

  test.each([
    [
      "a namespace of the program's own with that name",
      `namespace Bun { export function color(name: string, format: string) { return name + format; } }\nimport paint = Bun.color; console.log(paint("red", "hex"));`,
    ],
    [
      "an alias for a type alone",
      bun +
        `declare namespace Bun { interface Shade { name: string } }\nimport Shade = Bun.Shade; let shade: Shade | undefined; console.log(shade);`,
    ],
  ])("is no use of Bun with %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": log + text });
    expect({
      ...completeness(use),
      ofBun: use.lines.filter(line => line.startsWith("Bun ") || line === "global Bun"),
    }).toEqual({ ...closed, ofBun: [] });
  });
});

group("require with a second argument", () => {
  test.each([["a built-in module", `console.log(require("bun:sqlite", 0));`, "module bun:sqlite"]])(
    "counts as a use of %s",
    async (_, text, line) => {
      expect(accountsFor(await of(text), line)).toBe(true);
    },
  );
});

group("Function evaluates text however it is called", () => {
  test.each([["Function.prototype.call", `console.log(Function.prototype.call.call((one: number) => one, null, 1));`]])(
    "the report stays closed with %s",
    async (_, text) => {
      expect(completeness(await of(text))).toEqual(closed);
    },
  );
});

group("with --disallow-code-generation-from-strings no string becomes code through eval or Function", () => {
  const withFlag = (text: string, flag = "--disallow-code-generation-from-strings") =>
    runtimeUse({ "main.ts": declared + text }, ["check", "--aot", "--no-pretty", flag]);
  const input = `const input: any = JSON.parse(process.argv[2]);\n`;

  test.each([
    // Whoever is handed it may call it.
    ["eval that reaches unknown code", external + `external(eval);`],
  ])("the report is closed with %s", async (_, text) => {
    const [without, use, strict] = await Promise.all([
      of(text),
      withFlag(text),
      withFlag(text, "--disallow-code-generation-from-strings=strict"),
    ]);
    expect({ isOpenWithout: without.whyOpen.length > 0, first: use.lines[0], strict: strict.lines[0] }).toEqual({
      isOpenWithout: true,
      first: closed.first,
      strict: closed.first,
    });
  });

  test.each([
    ["Function('return this')(), whose text the compiler reads", `console.log(Function("return this")().Object);`],
  ])("the report is closed with and without the flag with %s", async (_, text) => {
    const [without, use, strict] = await Promise.all([
      of(text),
      withFlag(text),
      withFlag(text, "--disallow-code-generation-from-strings=strict"),
    ]);
    expect({ without: without.lines[0], first: use.lines[0], strict: strict.lines[0] }).toEqual({
      without: closed.first,
      first: closed.first,
      strict: closed.first,
    });
  });

  test.each([
    [
      "require of a computed name beside new Function",
      `try { new Function(""); } catch {}\nconsole.log(typeof require(process.argv[2]));`,
    ],
  ])("the report is still open with %s", async (_, text) => {
    expect((await withFlag(text)).whyOpen).not.toEqual([]);
  });

  test.each([
    [
      "node:http",
      `import http from "node:http";\nhttp.createServer((request: any, response: any) => response.end("hello")).listen(0);`,
    ],
    ["node:events", `import { EventEmitter } from "node:events";\nnew EventEmitter().emit("hello");`],
  ])("Bun's own JavaScript in %s leaves the report closed", async (_, text) => {
    expect((await withFlag(text)).lines[0]).toEqual(closed.first);
  });
});

group("an object of the program's own, read by a computed key", () => {
  const key = `const key: string = process.argv[2];\n`;
  const table = `const table = { home: () => "home", about: () => "about" };\n`;
  const called = `const found = (table as any)[key];\nconsole.log(found ? found() : "none");`;
  const judged = async (text: string, entryPoint = "main.ts") => {
    const use = await runtimeUse(
      { [entryPoint]: (entryPoint.endsWith(".ts") ? declared + key : `const key = process.argv[2];\n`) + text },
      undefined,
      entryPoint,
    );
    return { usesEveryMember: usesEveryMember(use), exitCode: use.exitCode };
  };

  test.each([
    ["its keys are enumerated", `${table}for (const name in table) console.log(name);\n${called}`],
    [
      "it is local to a function",
      `function run(name: string) {\n  const table: Record<string, () => string> = { home: () => "home" };\n  const found = table[name];\n  return found ? found() : "none";\n}\nconsole.log(run(key));`,
    ],
    [
      "it is a parameter",
      `function run(table: Record<string, () => string>) {\n  const found = table[key];\n  return found ? found() : "none";\n}\nconsole.log(run({}));`,
    ],
    [
      "the result is compared by size",
      `const table = { low: 0, high: 2 };\nconst found = (table as any)[key] ?? 1;\nif (found > 0) console.log("some");`,
    ],
    [
      "it is an enum",
      `enum Color {\n  Red,\n  Green = 1 << 2,\n  Blue = "blue",\n}\nconsole.log(Color[key as keyof typeof Color] === Color.Red, typeof Color[process.argv.length], Color.Green);\nconst found = (Color as any)[key];\nconsole.log(found ? found() : "none");`,
    ],
    ["the result is called in place and awaited", `${table}console.log(await (table as any)[key]());\nexport {};`],
    [
      "a member says this, and the result is called in place",
      `const table = { home() { return this; } };\n(table as any)[key]();`,
    ],
  ])("only the members of Object.prototype may be used where %s", async (_, text) => {
    expect(await judged(text)).toEqual({ usesEveryMember: false, exitCode: 0 });
  });

  const inherited = ["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"].map(
    name => "property " + name,
  );

  test.each([
    [
      "the var is declared twice",
      `var table: any = { home: () => "home" };\nvar table: any = process.argv;\n${called}`,
    ],
  ])("the members of what the second declaration holds may be used where %s", async (_, text) => {
    const use = await runtimeUse({ "main.ts": declared + key + text });
    expect({ usesMembersOfLists: use.lines.includes("property toSpliced"), exitCode: use.exitCode }).toEqual({
      usesMembersOfLists: true,
      exitCode: 0,
    });
  });
});

group("the report of a build", () => {
  test.each([["stores to module.exports", `module.exports = { value: 1 };`]])(
    "a CommonJS entry point that %s uses no member under a computed name",
    async (_, text) => {
      const use = await runtimeUse({ "main.cjs": text, "other.cjs": `exports.value = 1;` }, build, "main.cjs");
      expect({ first: use.lines[0], usesEveryMember: usesEveryMember(use), exitCode: use.exitCode }).toEqual({
        first: closed.first,
        usesEveryMember: false,
        exitCode: 0,
      });
    },
  );

  test("a dependency that requires an external package opens the report, a dependency that is compiled does not", async () => {
    const wrapper = {
      "node_modules/wrapper/package.json": `{ "name": "wrapper", "main": "index.js" }`,
      "node_modules/wrapper/index.js": `let found;\ntry { found = require("late-package"); } catch {}\nmodule.exports = found;`,
    };
    const installed = {
      "node_modules/installed/package.json": `{ "name": "installed", "main": "index.js" }`,
      "node_modules/installed/index.js": `module.exports = { a: 1 };`,
    };
    const [late, there] = await Promise.all([
      runtimeUse(
        { "main.ts": declared + `// @ts-ignore\nimport found from "wrapper";\nconsole.log(found);`, ...wrapper },
        [...build, "--external", "late-package"],
      ),
      runtimeUse(
        { "main.ts": declared + `// @ts-ignore\nimport found from "installed";\nconsole.log(found);`, ...installed },
        [...build, "--external", "late-package"],
      ),
    ]);
    expect({ late: completeness(late).whyOpen, there: there.whyOpen }).toEqual({
      late: expect.arrayContaining([uncompiledModule]),
      there: [],
    });
  });
});

group("the features that the options of a build use", () => {
  const optional = ["Interpreter", "PackageFiles", "SourceMaps", "RuntimeTranspiler", "Inspector"];
  const used = async (...flags: string[]) => {
    const use = await runtimeUse(hello, [...build, ...flags]);
    expect(use.exitCode).toBe(0);
    return optional.filter(feature => retainsFeature(use.lines, feature));
  };

  test("--inspect in the arguments of the executable runs code the compiler does not see", async () => {
    expect(completeness(await runtimeUse(hello, [...build, "--compile-exec-argv=--inspect=127.0.0.1:0"]))).toEqual(
      open("build-option: a build option lets the executable load code at run time"),
    );
  });
});

group("Bun.serve for the exports of the entry point", () => {
  const server = `{ port: 0, fetch() { return new Response("served"); } }`;
  const answers = `function () { return new Response("ok"); }`;
  const otherModules = {
    "other.cjs": `exports.value = 1;\nexports.fetch = ${answers};`,
    "stores.cjs": `require("./main.cjs").fetch = ${answers};`,
  };
  const judged = async (files: Record<string, string>) => {
    const use = await runtimeUse(withDeclarations(files), build, Object.keys(files)[0]);
    return {
      serves: retainsFeature(use.lines, "Serve"),
      mayServe: use.whyOpen.length > 0 || retainsFeature(use.lines, "Serve"),
      first: use.lines[0],
      exitCode: use.exitCode,
    };
  };

  test.each([
    [
      "export * in a cycle",
      { "main.ts": `export * from "./other";`, "other.ts": `export * from "./main";\nexport const port = 3000;` },
    ],
    [
      "a CommonJS module that requires a module that exports fetch",
      { "main.cjs": `console.log(require("./other.cjs").value);`, ...otherModules },
    ],
  ])("is not used with %s", async (_, files) => {
    expect(await judged(files)).toEqual({ serves: false, mayServe: false, first: closed.first, exitCode: 0 });
  });

  test.each([
    ["export default of a variable", { "main.ts": `const config = ${server};\nexport default config;` }],
    ["export { config as default }", { "main.ts": `const config = ${server};\nexport { config as default };` }],
    [
      "export { default } from",
      { "main.ts": `export { default } from "./other";`, "other.ts": `export default ${server};` },
    ],
    [
      "export * as default from",
      {
        "main.ts": `export * as default from "./other";`,
        "other.ts": `export const port = 0;\nexport function fetch() { return new Response("served"); }`,
      },
    ],
    [
      "export * from a CommonJS module",
      {
        "main.ts": `// @ts-ignore\nexport * from "./other.cjs";`,
        "other.cjs": `exports.then = function (resolve) { resolve({ default: ${server} }); };`,
      },
    ],
  ])("may be used with %s", async (_, files) => {
    expect(await judged(files)).toMatchObject({ mayServe: true, exitCode: 0 });
  });

  test.each([
    ["exports app", `exports.app = {};`],
    [
      "defines a getter named default",
      `Object.defineProperty(exports, "default", { enumerable: true, get: function () { return served; } });\nconst served = { fetch: ${answers} };`,
    ],
    [
      "was an ES module",
      `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = { fetch: ${answers} };`,
    ],
    ["stores through this", `this.fetch = ${answers};`],
    ["is required by a module that stores on the result", `require("./stores.cjs");`],
    [
      "calls a method of its exports, which stores through this",
      `exports.fill = function () { this.fetch = ${answers}; };\nexports.fill();`,
    ],
    ["takes module out of a disjunction", `const alias = module || null;\nalias.exports.fetch = ${answers};`],
    ["takes module out of a conjunction", `const alias = 1 && module;\nalias.exports.fetch = ${answers};`],
    [
      "stores the result of a call where it finds that there is a module",
      `function make() { return { fetch: ${answers} }; }\nif (typeof module !== "undefined" && module.exports) module.exports = make();`,
    ],
    ["exports a function with fetch on it", `module.exports = function () {};\nmodule.exports.fetch = ${answers};`],
    ["exports a class", `module.exports = class { static fetch() { return new Response("ok"); } };`],
    [
      "exports the name of a function that it constructs",
      `function App() {\n  new.target.fetch = ${answers};\n}\nnew App();\nmodule.exports = App;`,
    ],
    [
      "exports the name of a function, a member of which it calls",
      `function app() {}\napp.fill = function () {\n  this.fetch = ${answers};\n};\napp.fill();\nmodule.exports = app;`,
    ],
    [
      "exports a function in a branch",
      `if (process.argv.length > 5) module.exports = function () {};\nelse module.exports = { fetch: ${answers} };`,
    ],
    [
      "exports a function and passes it on",
      `module.exports = function () {};\nObject.assign(module.exports, { fetch: ${answers} });`,
    ],
  ])("may be used with a CommonJS entry point that %s", async (_, text) => {
    expect(await judged({ "main.cjs": text, ...otherModules })).toMatchObject({ mayServe: true, exitCode: 0 });
  });
});

group("what is done with the exports of the entry point does not depend on how the program runs", () => {
  async function said(cmd: string[], cwd: string) {
    const { stdout, stderr, exitCode } = await run(cmd, cwd);
    return {
      stdout: stdout.replace(/^Started (development )?server: http:\/\/localhost:\d+$/gm, "Started a server"),
      stderr,
      exitCode,
    };
  }

  const leaves = `setTimeout(() => process.exit(0), 50);`;

  test.each([
    ["no exports", { "main.ts": `console.log("hello");` }, "hello\n"],
    [
      "a server's configuration",
      { "main.ts": `export default { port: 0, fetch() { return new Response("served"); } };\n${leaves}` },
      "Started a server\n",
    ],
    [
      "a server's configuration out of another module",
      {
        "main.ts": `export { default } from "./other";\n${leaves}`,
        "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };`,
      },
      "Started a server\n",
    ],
    [
      "a server's configuration that only export * reaches",
      {
        "main.ts": `export * from "./other";`,
        "other.ts": `export default { port: 0, fetch() { return new Response("served"); } };`,
      },
      "",
    ],
    [
      "a server's configuration in a CommonJS module",
      { "main.cjs": `module.exports = { port: 0, fetch() { return new Response("served"); } };\n${leaves}` },
      "Started a server\n",
    ],
    [
      "a server",
      {
        "main.ts": `const server = Bun.serve({ port: 0, fetch() { return new Response("served"); } });\nexport default server;\n${leaves}`,
      },
      "",
    ],
    ["a class", { "main.ts": `export default class Server { static fetch = "no function"; }` }, ""],
    ["the global object", { "main.ts": `export default globalThis;` }, ""],
    [
      "an object that says what is read of it",
      {
        "main.ts": `export default new Proxy({}, { get(_, name) { console.log("read", String(name)); return undefined; } });`,
      },
      "read fetch\nread app\n",
    ],
    [
      "a binding that changes while it is looked at",
      {
        "main.ts": `
          const second = { get port() { console.log("the second is served"); return 0; }, fetch() { return new Response("second"); } };
          let config = { get port() { console.log("the first is served"); return 0; }, get fetch() { config = second; return () => new Response("first"); } };
          export { config as default };
          ${leaves}
        `,
      },
      "the second is served\nStarted a server\n",
    ],
    [
      "a function named then",
      {
        "main.ts": `
          export function then(this: object, resolve: (namespace: object) => void, reject: unknown) {
            console.log("then", Object.prototype.toString.call(this), Object.keys(this).join(), reject === reportError);
            resolve({ default: { port: 0, fetch() { return new Response("served"); } } });
            ${leaves}
          }
          export default { get fetch() { console.log("the default export is not looked at"); return undefined; } };
        `,
      },
      "then [object Module] default,then true\nStarted a server\n",
    ],
  ])("%s", async (_, files, stdout) => {
    using dir = tempDir("aot-runtime-use-entry", { "tsconfig.json": tsconfig, ...withDeclarations(files) });
    const [cwd, entryPoint] = [String(dir), Object.keys(files)[0]];
    const built = await Promise.all([
      said([bunExe(), "build", "--compile", entryPoint, "--outfile", "bundled"], cwd),
      said([bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", "compiled"], cwd),
    ]);
    expect(built.map(it => ({ stderr: it.stderr, exitCode: it.exitCode }))).toEqual([
      { stderr: "", exitCode: 0 },
      { stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 },
    ]);
    const expected = { stdout, stderr: "", exitCode: 0 };
    expect(
      await Promise.all([
        said([bunExe(), entryPoint], cwd),
        said([join(cwd, "bundled")], cwd),
        said([join(cwd, "compiled")], cwd),
      ]),
    ).toEqual([expected, expected, expected]);
  });
});

group("what --trim removes", () => {
  const main = declared + `console.log("hello");`;

  async function built(files: Record<string, string>, entryPoints = ["main.ts"]) {
    using dir = tempDir("aot-runtime-use-writer", { "tsconfig.json": tsconfig, ...files });
    const contents: string[] = [];
    for (const [folder, without] of [
      ["by-use", []],
      ["without-an-unused-feature", [featureOf("HTMLRewriter")]],
    ] as const) {
      const { stderr: buildErrors, exitCode: buildExitCode } = await run(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "--trim",
          ...withoutFeatures(without),
          ...entryPoints,
          "--outfile",
          join(folder, "main"),
        ],
        String(dir),
      );
      if (buildExitCode !== 0) throw new Error(buildErrors);
      const executable = await Bun.file(
        join(String(dir), folder, process.platform === "win32" ? "main.exe" : "main"),
      ).bytes();
      contents.push(new Bun.CryptoHasher("sha256").update(executable).digest("hex"));
    }
    const { stdout, exitCode } = await run([join(String(dir), "by-use", "main")], String(dir));
    return { stdout, exitCode, removesUnusedFeatures: contents[0] === contents[1] };
  }

  test("a closed program: the features it does not use", async () => {
    expect(await built({ "main.ts": main })).toEqual({ stdout: "hello\n", exitCode: 0, removesUnusedFeatures: true });
  });

  test("a program that loads an external package: no feature for being unused", async () => {
    expect(
      await built({ "main.ts": main + `\ntry { require("late-package"); } catch {}` }, [
        "main.ts",
        "--external",
        "late-package",
      ]),
    ).toEqual({ stdout: "hello\n", exitCode: 0, removesUnusedFeatures: false });
  });

  test.each(["--smol", "--stack-trace-limit=3", "--sql-preconnect"])(
    "--compile-exec-argv=%s: the features the program does not use",
    async option => {
      expect(await built({ "main.ts": main }, ["main.ts", "--compile-exec-argv=" + option])).toEqual({
        stdout: "hello\n",
        exitCode: 0,
        removesUnusedFeatures: true,
      });
    },
  );

  test("--compile-exec-argv=--trace-exitx takes a module of the library that the image does not have: no build", async () => {
    expect(built({ "main.ts": main }, ["main.ts", "--compile-exec-argv=--trace-exitx"])).rejects.toThrow(
      "--aot does not support --trace-exitx in --compile-exec-argv",
    );
  });

  test("the script of a page runs in a browser, not here: the features the program does not use", async () => {
    const files = {
      "main.ts": `// @ts-ignore\nimport page from "./index.html";\n` + declared + `console.log(typeof page);`,
      "index.html": `<html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `export {};\n(globalThis as any).ready = 1 + 1;`,
    };
    expect(await built(files)).toEqual({ stdout: "object\n", exitCode: 0, removesUnusedFeatures: true });
  });
});

/** Every `parts`-th group, from the `part`-th on. */
export function runtimeUseOfTheWorldTests(part: number, parts: number) {
  groups.forEach(([name, body], index) => {
    if (index % parts === part - 1)
      (unsupported || (name === "what --trim removes" && !canTrim) ? describe.skip : describe.concurrent)(name, body);
  });
}
