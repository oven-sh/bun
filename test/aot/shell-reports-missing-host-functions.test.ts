// The `jsc` shell makes its own import.meta, module and require, without the functions that Bun puts on them. Compiled code calls such a
// function without testing that it is there, so the shell puts one in its place that names the function the program needs, and
// shell/quick.py skips the program. shell/tools.ts says what the scripts need.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./harness/commands";
import { run } from "./harness/run";
import { python, scriptEnvironment, scriptSkipReason } from "./shell/tools";

const caught = (call: string) =>
  `try { console.log(typeof ${call}); } catch (error) { console.log(error instanceof TypeError); }\n`;

const programs: Record<string, [extension: string, text: string, needs: string]> = {
  "calls-import-meta-resolve": ["js", caught(`import.meta.resolve("./other.js")`), "%ImportMeta%.resolve"],
  "calls-import-meta-resolve-sync": ["js", caught(`import.meta.resolveSync("./other.js")`), "%ImportMeta%.resolveSync"],
  "calls-import-meta-resolve-if-present": ["js", caught(`import.meta.resolve?.("./other.js")`), "%ImportMeta%.resolve"],
  "calls-import-meta-resolve-through-call": [
    "js",
    caught(`import.meta.resolve.call(import.meta, "./other.js")`),
    "%ImportMeta%.resolve",
  ],
  "calls-a-bound-import-meta-resolve": [
    "js",
    caught(`import.meta.resolve.bind(import.meta)("./other.js")`),
    "%ImportMeta%.resolve",
  ],
  "calls-import-meta-resolve-from-a-pattern": [
    "js",
    `const { resolve } = import.meta;\n${caught(`resolve("./other.js")`)}`,
    "%ImportMeta%.resolve",
  ],
  "calls-import-meta-require-resolve": ["js", caught(`import.meta.require.resolve()`), "%ModuleRequire%.resolve"],
  "calls-resolve-of-the-require-of-a-module": [
    "mjs",
    `const load = require;\n${caught(`load.resolve()`)}`,
    "%ModuleRequire%.resolve",
  ],
  "calls-require-resolve": ["cjs", caught(`require.resolve()`), "%ModuleRequire%.resolve"],
  "calls-require-resolve-from-a-pattern": [
    "cjs",
    `const { resolve } = require;\n${caught(`resolve("./other.js")`)}`,
    "%ModuleRequire%.resolve",
  ],
};

if (scriptSkipReason && !unsupported)
  console.error(`SKIPPED: test/aot/shell-reports-missing-host-functions.test.ts: ${scriptSkipReason}`);

test.skipIf(!!scriptSkipReason)(
  "a program that calls a function only Bun has is skipped by the name of the function",
  async () => {
    using folder = tempDir(
      "aot-missing-host-functions",
      Object.fromEntries(
        Object.entries(programs).map(([name, [extension, text]]) => [`programs/host/${name}.${extension}`, text]),
      ),
    );
    const names = Object.keys(programs).map(name => `host/${name}`);
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), ...names],
      undefined,
      {
        ...scriptEnvironment(),
        PROGRAMS: join(String(folder), "programs"),
        WORK: join(String(folder), "work"),
      },
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => line !== "")).toEqual(
      Object.entries(programs).map(([name, [, , needs]]) => `host/${name}: skipped: it needs the host's ${needs}`),
    );
    expect(exitCode).toBe(0);
  },
  290_000,
);

test.skipIf(!!scriptSkipReason)(
  "a program that only looks at such a function runs",
  async () => {
    using folder = tempDir("aot-missing-host-functions", {
      "programs/host/looks-at-import-meta.js": `console.log(typeof import.meta.resolve, typeof import.meta.resolveSync, import.meta.resolve.name);\n`,
      "programs/host/looks-at-require.cjs": `console.log(typeof require.resolve, typeof module.require);\n`,
    });
    const { stdout, stderr, exitCode } = await run(
      [python!, join(import.meta.dir, "shell", "quick.py"), "host/looks-at-import-meta", "host/looks-at-require"],
      undefined,
      { ...scriptEnvironment(), PROGRAMS: join(String(folder), "programs"), WORK: join(String(folder), "work") },
    );
    expect(stderr).toBe("");
    expect(stdout.split("\n").filter(line => line !== "")).toEqual([
      "host/looks-at-import-meta: same (1 lines)",
      "host/looks-at-require: same (1 lines)",
    ]);
    expect(exitCode).toBe(0);
  },
  290_000,
);
