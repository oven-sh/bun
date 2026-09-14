import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/7623
//
// webpack.config.js (ESM, "type":"module") does:
//   import infernoTsPlugin from "ts-plugin-inferno";
//   ... after: [infernoTsPlugin.default()]
//
// ts-plugin-inferno is a CJS package whose dist/index.js sets
//   Object.defineProperty(exports, "__esModule", { value: true });
//   exports.default = () => { ... };
//
// Node maps the default import to module.exports, so `.default` is the
// function. Bun previously honored the __esModule marker and unwrapped to
// exports.default, making `.default` undefined and the call throw
// "infernoTsPlugin.default is not a function".

test.concurrent("ESM default import of __esModule-marked CJS package is module.exports (issue #7623)", async () => {
  using dir = tempDir("issue-07623", {
    "package.json": JSON.stringify({ name: "repro-7623", type: "module" }),
    "node_modules/ts-plugin-inferno/package.json": JSON.stringify({
      name: "ts-plugin-inferno",
      main: "dist/index.js",
    }),
    "node_modules/ts-plugin-inferno/dist/index.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POSSIBLE_IMPORTS_TO_ADD = ["createVNode", "createFragment"];
exports.default = () => "transformer";
`,
    "webpack.config.js": `import infernoTsPlugin from "ts-plugin-inferno";
if (typeof infernoTsPlugin.default !== "function") {
  throw new TypeError("infernoTsPlugin.default is not a function");
}
console.log(JSON.stringify({
  pluginType: typeof infernoTsPlugin,
  defaultType: typeof infernoTsPlugin.default,
  call: infernoTsPlugin.default(),
  named: infernoTsPlugin.POSSIBLE_IMPORTS_TO_ADD,
}));
`,
    // webpack-cli loads the config via dynamic import from a CJS entry point.
    "loader.cjs": `import("./webpack.config.js").catch(e => { console.error(e.message); process.exit(1); });
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "loader.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    pluginType: "object",
    defaultType: "function",
    call: "transformer",
    named: ["createVNode", "createFragment"],
  });
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/29304
// webpack-cli@7 does: const { default: CLIPlugin } = (await import("./plugins/cli-plugin.js")).default;
test.concurrent(
  "dynamic import of __esModule-marked CJS: .default.default reaches exports.default (issue #29304)",
  async () => {
    using dir = tempDir("issue-07623-dyn", {
      "plugin.cjs": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class CLIPlugin { constructor(o) { this.options = o; } }
exports.default = CLIPlugin;
`,
      "entry.mjs": `const ns = await import("./plugin.cjs");
console.log(JSON.stringify({
  nsDefaultType: typeof ns.default,
  nsDefaultDefaultType: typeof ns.default.default,
  ctor: new ns.default.default({ ok: true }).options.ok,
}));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.trim()).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      nsDefaultType: "object",
      nsDefaultDefaultType: "function",
      ctor: true,
    });
    expect(exitCode).toBe(0);
  },
);

// https://github.com/oven-sh/bun/issues/27810
// Next.js + Turbopack: exports.default is a getter, not a plain value property.
test.concurrent("dynamic import of __esModule-marked CJS with getter default (issue #27810)", async () => {
  using dir = tempDir("issue-07623-getter", {
    "config.cjs": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function loadConfig(phase) { return { phase }; }
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return loadConfig; } });
`,
    "entry.mjs": `const ns = await import("./config.cjs");
console.log(JSON.stringify({
  defaultType: typeof ns.default,
  defaultDefaultType: typeof ns.default.default,
  call: ns.default.default("dev").phase,
}));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    defaultType: "object",
    defaultDefaultType: "function",
    call: "dev",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("CJS without __esModule: default import is still module.exports", async () => {
  using dir = tempDir("issue-07623-nomark", {
    "mod.cjs": `module.exports = function fn() { return 42; };
`,
    "entry.mjs": `import fn from "./mod.cjs";
console.log(JSON.stringify({ type: typeof fn, call: fn() }));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ type: "function", call: 42 });
  expect(exitCode).toBe(0);
});
