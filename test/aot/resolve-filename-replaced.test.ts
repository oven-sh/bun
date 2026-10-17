import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

// A replaced `Module._resolveFilename` is asked for every name that is required from then on, also for one that the build could resolve
// itself. Packages that give paths an alias work this way.

const files = {
  "lib.js": `exports.name = "the real lib"; exports.dep = require("./dep.js").name;`,
  "dep.js": `exports.name = "the real dep";`,
  "other.js": `exports.name = "the other dep";`,
  "user.js": `exports.pkg = require("pkg").name;`,
  "register.js": `const Module = module.constructor.length > 1 ? module.constructor : require("node:module");
const old = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return old.call(this, request === "./dep.js" ? "./other.js" : request, ...rest); };
`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/pkg/index.js": `exports.name = "the package in node_modules";`,
};

const programs: Record<string, string> = {
  "another-file-for-a-path.js": `const Module = require("node:module");
const old = Module._resolveFilename, seen = [];
Module._resolveFilename = function (request, ...rest) { seen.push(request); return old.call(this, request === "./dep.js" ? "./other.js" : request, ...rest); };
console.log(JSON.stringify(require("./lib.js")), seen.join());
`,
  "a-file-for-a-package-that-is-there.js": `const Module = require("node:module"), path = require("node:path");
const old = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return old.call(this, request === "pkg" ? path.join(__dirname, "dep.js") : request, ...rest); };
console.log(require("pkg").name, JSON.stringify(require("./user.js")));
`,
  "set-by-a-required-file.js": `require("./register.js");
console.log(JSON.stringify(require("./lib.js")));
`,
  "put-back.js": `const Module = require("node:module");
const old = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return old.call(this, request === "./dep.js" ? "./other.js" : request, ...rest); };
const first = require("./dep.js").name;
Module._resolveFilename = old;
console.log(first, require("./dep.js").name, JSON.stringify(require("./lib.js")));
`,
  "only-called.js": `const Module = require("node:module");
console.log(Module._resolveFilename("./dep.js", module) === require.resolve("./dep.js"), JSON.stringify(require("./lib.js")));
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    // What the hook alone names is written once, where it never runs, so that it is a file of the program.
    const written = `if (process.argv.length > 9) { require("./other.js"); require("./dep.js"); }\n`;
    using dir = tempDir("resolve-filename", { ...files, [entry]: programs[entry] + written });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", ...flags, entry],
        cwd: String(dir),
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--debug-aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
