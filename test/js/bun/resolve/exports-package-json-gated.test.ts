import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Node gates `pkg/package.json` behind the "exports" map like every other subpath:
// https://nodejs.org/api/packages.html#package-entry-points
//   "all subpaths of the package will be encapsulated ... including the package.json"
// Prior to this change Bun exempted the manifest, so require('pkg/package.json') resolved
// even when the package's exports map did not list "./package.json".

const fixtureFiles = {
  "package.json": JSON.stringify({ name: "app", private: true }),

  // object-form exports that do NOT list "./package.json"
  "node_modules/objx/package.json": JSON.stringify({
    name: "objx",
    main: "./m.js",
    exports: { ".": "./m.js", "./sub": "./sub.js" },
  }),
  "node_modules/objx/m.js": 'module.exports = "objx/m.js"',
  "node_modules/objx/sub.js": 'module.exports = "objx/sub.js"',
  "node_modules/objx/internal.js": 'module.exports = "objx/internal.js"',

  // string-sugar exports
  "node_modules/strx/package.json": JSON.stringify({
    name: "strx",
    exports: "./m.js",
  }),
  "node_modules/strx/m.js": 'module.exports = "strx/m.js"',

  // `exports: {}` — package fully encapsulated, nothing importable at all
  "node_modules/empx/package.json": JSON.stringify({
    name: "empx",
    main: "./m.js",
    exports: {},
  }),
  "node_modules/empx/m.js": 'module.exports = "empx/m.js"',

  // package that explicitly exports "./package.json" — must keep working
  "node_modules/openx/package.json": JSON.stringify({
    name: "openx",
    exports: { ".": "./m.js", "./package.json": "./package.json" },
  }),
  "node_modules/openx/m.js": 'module.exports = "openx/m.js"',

  // no exports map at all — deep paths are not gated
  "node_modules/bare/package.json": JSON.stringify({ name: "bare", main: "./m.js" }),
  "node_modules/bare/m.js": 'module.exports = "bare/m.js"',

  "probe.mjs": `
    import { createRequire } from "node:module";
    const req = createRequire(import.meta.url);
    const out = {};
    async function cell(id, fn) {
      try {
        const v = await fn();
        out[id] = v && v.name ? "manifest name=" + v.name : typeof v === "string" ? "resolved" : String(v);
      } catch (e) {
        out[id] = "ERR:" + (e.code || e.name);
      }
    }
    await cell("require objx/package.json", () => req("objx/package.json"));
    await cell("require.resolve objx/package.json", () => req.resolve("objx/package.json"));
    await cell("import objx/package.json {type:json}", async () => (await import("objx/package.json", { with: { type: "json" } })).default);
    await cell("import.meta.resolve objx/package.json", () => import.meta.resolve("objx/package.json"));
    await cell("require strx/package.json (exports: string)", () => req("strx/package.json"));
    await cell("require empx/package.json (exports: {})", () => req("empx/package.json"));
    await cell("require objx/internal.js (deep, control)", () => req("objx/internal.js"));
    await cell("require openx/package.json (explicitly exported)", () => req("openx/package.json"));
    await cell("require bare/package.json (no exports map)", () => req("bare/package.json"));
    await cell("require objx (root, control)", () => req("objx"));
    console.log(JSON.stringify(out));
  `,
};

// Node uses ERR_PACKAGE_PATH_NOT_EXPORTED; Bun historically used MODULE_NOT_FOUND for
// exports-gated subpaths. The invariant under test here is that resolution *fails*
// (the manifest is not returned), so accept either code.
const gated = expect.stringMatching(/^ERR:(ERR_PACKAGE_PATH_NOT_EXPORTED|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)$/);

describe("pkg/package.json is gated by the exports map", () => {
  test.concurrent("require / import / resolve", async () => {
    using dir = tempDir("exports-pjson-gate", fixtureFiles);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "probe.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "require objx/package.json": gated,
      "require.resolve objx/package.json": gated,
      "import objx/package.json {type:json}": gated,
      "import.meta.resolve objx/package.json": gated,
      "require strx/package.json (exports: string)": gated,
      "require empx/package.json (exports: {})": gated,
      "require objx/internal.js (deep, control)": gated,
      "require openx/package.json (explicitly exported)": "manifest name=openx",
      "require bare/package.json (no exports map)": "manifest name=bare",
      "require objx (root, control)": "resolved",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("self-reference from inside the package", async () => {
    using dir = tempDir("exports-pjson-self", {
      ...fixtureFiles,
      "node_modules/objx/self.cjs": `
        try {
          require("objx/package.json");
          console.log("RESOLVED");
        } catch (e) {
          console.log("ERR:" + (e.code || e.name));
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "node_modules/objx/self.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect({ out: stdout.trim() }).toEqual({ out: gated });
    expect(exitCode).toBe(0);
  });
});
