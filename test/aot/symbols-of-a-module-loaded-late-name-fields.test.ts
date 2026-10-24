// `await import("./app.cjs")` in the entry point, or one `require` in a function, and somebody may see each module that it reaches before its body has ended. Such a CommonJS module begins with the object
// that `module.exports` starts as, so `const { kState } = require("./symbols.cjs")` is the symbol or undefined as far as the compiler knows. The symbols name fields all the same.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "symbols.cjs": `"use strict";\nconst keys = { kState: Symbol("state"), kHeaders: Symbol("headers"), kSent: Symbol("sent") };\nmodule.exports = keys;\n`,
  "reply.cjs": `"use strict";
    const { kState, kHeaders, kSent } = require("./symbols.cjs");
    function Reply(raw) {
      this.raw = raw;
      this[kState] = 0;
      this[kHeaders] = null;
      this[kSent] = false;
    }
    function code(state) { this[kState] = state; return this; }
    function send(count) {
      if (this[kSent] === true) return this;
      this[kSent] = true;
      this.raw.total += count + this[kState] + (this[kHeaders] === null ? 0 : 1);
      return this;
    }
    Reply.prototype.code = code;
    Reply.prototype.send = send;
    module.exports = Reply;
  `,
  "app.cjs": `"use strict";
    const Reply = require("./reply.cjs");
    exports.run = function (turns) {
      const raw = { total: 0 };
      for (let turn = 0; turn < turns; turn++) new Reply(raw).code(turn & 3).send(1);
      return raw.total;
    };
  `,
  "imported.mjs": `import app from "./app.cjs";\nconsole.log(app.run(100));\n`,
  "imported-late.mjs": `const { default: app } = await import("./app.cjs");\nconsole.log(app.run(100));\n`,
  "required-late.cjs": `function load() { return require("./app.cjs"); }\nconsole.log(load().run(100));\n`,
};

test("the symbols of a CommonJS module name fields however the program gets to the module", async () => {
  using dir = tempDir("aot-symbols-of-a-module-loaded-late", files);
  const costsIn = async (entry: string) => {
    const executable = join(String(dir), entry + (isWindows ? ".exe" : ".out"));
    const report = join(String(dir), entry + ".json");
    const built = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-report=" + report,
        "--aot-report-detail=sites",
        entry,
        "--outfile",
        executable,
      ],
      String(dir),
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    expect(await run([executable], String(dir))).toEqual({ stdout: "250\n", stderr: "", exitCode: 0 });
    const sites: { file: string | null; line: number; kind: string; cost: string }[] = JSON.parse(
      readFileSync(report, "utf8"),
    ).accessSites;
    // The lines of the constructor and the two methods: every access there has `this` as its receiver or is a field of `raw`.
    return sites
      .filter(site => site.file?.endsWith("reply.cjs") && site.line >= 3 && site.line <= 15)
      .filter(site => site.kind === "read" || site.kind === "store")
      .map(site => site.line + " " + site.kind + " " + (site.cost === "byName" ? "by name" : "by slot"));
  };
  for (const entry of ["imported.mjs", "imported-late.mjs", "required-late.cjs"]) {
    const costs = await costsIn(entry);
    // Where the allocation takes the values of the constructor's stores, the stores are gone.
    expect(costs.length).toBeGreaterThanOrEqual(8);
    expect({ entry, byName: costs.filter(site => site.endsWith("by name")) }).toEqual({ entry, byName: [] });
  }
}, 120_000);
