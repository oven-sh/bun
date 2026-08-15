import { describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, fakeNodeRun, isWindows, tempDir } from "../../harness";

describe("fake node cli", () => {
  test("the node cli actually works", () => {
    using temp = tempDir("fake-node", {
      "index.ts": "console.log(Bun.version)",
    });
    expect(fakeNodeRun(temp, join(temp, "index.ts")).stdout).toBe(Bun.version);
  });
  test("doesnt resolve bins", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "node_modules/.bin/vite": "#!/usr/bin/sh\necho fail && exit 1",
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("doesnt resolve scripts", () => {
    using temp = tempDir("fake-node", {
      "vite.js": "console.log('pass')",
      "package.json": '{"scripts":{"vite":"echo fail && exit 1"}}',
    });
    expect(fakeNodeRun(temp, "vite").stdout).toBe("pass");
  });
  test("can run a script named run.js", () => {
    using temp = tempDir("fake-node", {
      "run.js": "console.log('pass')",
      "run/index.js": "console.log('fail')",
      "node_modules/run/index.js": "console.log('fail')",
    });
    expect(fakeNodeRun(temp, "run").stdout).toBe("pass");
  });
  describe("entrypoint file extension picking", () => {
    // Bun supports JSX and TS, and node doesnt, so our behavior here differs a bit
    // Hopefully these priorization rules will not break any node apps.
    test("picks tsx over any other ext", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('fail (build.jsx)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
        "build.tsx": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks jsx over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.jsx": "console.log('pass')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('fail (build.mts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks mts over ts", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('fail (build.ts)')",
        "build.cts": "console.log('fail (build.cts)')",
        "build.mts": "console.log('pass')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
    test("picks ts over js/cjs/etc", () => {
      using temp = tempDir("fake-node", {
        "build.js": "console.log('fail (build.js)')",
        "build.cjs": "console.log('fail (build.cjs)')",
        "build.mjs": "console.log('fail (build.mjs)')",
        "build.ts": "console.log('pass')",
        "build.cts": "console.log('fail (build.cts)')",
      });
      expect(fakeNodeRun(temp, "build").stdout).toBe("pass");
    });
  });

  test("node -e ", () => {
    using temp = tempDir("fake-node", {});
    expect(fakeNodeRun(temp, ["-e", "console.log('pass')"]).stdout).toBe("pass");
  });

  test("process args work", () => {
    using temp = tempDir("fake-node", {
      "index.js": "console.log(JSON.stringify(process.argv.slice(1)))",
    });
    expect(fakeNodeRun(temp, ["index", "a", "b", "c"]).stdout).toBe(
      // note: no extension here is INTENTIONAL
      JSON.stringify([join(temp, "index"), "a", "b", "c"]),
    );
  });

  // Bare `node` now matches Node.js: a TTY stdin enters the REPL, a
  // non-TTY stdin (pipe) prints "Missing script". fakeNodeRun's default
  // stdin is platform-dependent (Windows may inherit a console), so pin
  // a piped stdin here.
  test("no args with piped stdin errors with 'Missing script'", () => {
    using temp = tempDir("fake-node", {});
    const result = Bun.spawnSync([bunExe(), "--bun", "node"], {
      cwd: temp,
      env: { ...bunEnv, NODE_ENV: undefined },
      stdin: Buffer.alloc(0),
    });
    expect(result.stderr.toString()).toContain("Missing script");
    expect(result.success).toBe(false);
  });

  // Node.js resolves symlinks on the main entry point by default (its
  // `resolveMainPath` calls `toRealPath`), so `node_modules/.bin/tool ->
  // ../pkg/cli.mjs` runs with module resolution anchored at the real package
  // directory. Regression tests for https://github.com/oven-sh/bun/issues/28331.
  test.skipIf(isWindows)("binary asset import works through an extensionless .bin symlink entry", () => {
    // The extensionless symlink otherwise classifies the entry as CommonJS,
    // and the synchronous loader feeds the .woff2 to the JS transpiler:
    // `error: Expected ";" but found ...` at font.woff2:1:1.
    using temp = tempDir("fake-node-binary", {
      "node_modules/my-tool/cli.mjs": 'import fontPath from "./font.woff2";\nconsole.log("loaded:", typeof fontPath);',
      "node_modules/.bin/.gitkeep": "",
    });
    require("fs").writeFileSync(join(temp, "node_modules/my-tool/font.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02]));
    symlinkSync(join(temp, "node_modules/my-tool/cli.mjs"), join(temp, "node_modules/.bin/my-tool"));
    expect(fakeNodeRun(temp, join(temp, "node_modules/.bin/my-tool")).stdout).toBe("loaded: string");
  });
  test.skipIf(isWindows)("resolves the entry symlink so relative imports work", () => {
    using temp = tempDir("fake-node-symlink", {
      "node_modules/my-tool/cli.mjs": 'import { greet } from "./lib.mjs";\nconsole.log(greet());',
      "node_modules/my-tool/lib.mjs": 'export function greet() { return "hello from my-tool"; }',
      "node_modules/.bin/.gitkeep": "",
    });
    symlinkSync(join(temp, "node_modules/my-tool/cli.mjs"), join(temp, "node_modules/.bin/my-tool"));
    expect(fakeNodeRun(temp, join(temp, "node_modules/.bin/my-tool")).stdout).toBe("hello from my-tool");
  });
  test.skipIf(isWindows)("__dirname of a symlinked entry is the real directory", () => {
    using temp = tempDir("fake-node-symlink", {
      "node_modules/my-tool/cli.js": "console.log(__dirname)",
      "node_modules/.bin/.gitkeep": "",
    });
    const real = join(temp, "node_modules/my-tool/cli.js");
    symlinkSync(real, join(temp, "node_modules/.bin/my-tool"));
    expect(fakeNodeRun(temp, join(temp, "node_modules/.bin/my-tool")).stdout).toBe(dirname(real));
  });
  test.skipIf(isWindows)("process.argv[1] is the real path, like plain bun", () => {
    // Bun realpaths argv[1] for symlinked entries in every mode (`bun
    // <symlink>` does too); Node.js keeps the symlink spelling there, but
    // that divergence predates this fix and applies bun-wide.
    using temp = tempDir("fake-node-symlink", {
      "node_modules/my-tool/cli.js": "console.log(process.argv[1])",
      "node_modules/.bin/.gitkeep": "",
    });
    const real = join(temp, "node_modules/my-tool/cli.js");
    symlinkSync(real, join(temp, "node_modules/.bin/my-tool"));
    expect(fakeNodeRun(temp, join(temp, "node_modules/.bin/my-tool")).stdout).toBe(real);
  });
  test.skipIf(isWindows)("bun run --bun runs a .bin symlink with working relative imports", () => {
    // The full flow behind `bunx --bun tool`: PATH lookup finds the .bin
    // symlink, the shebang re-enters bun as node, and relative imports must
    // resolve against the real file location.
    using temp = tempDir("bun-run-symlink", {
      "node_modules/my-tool/cli.mjs": '#!/usr/bin/env node\nimport { greet } from "./lib.mjs";\nconsole.log(greet());',
      "node_modules/my-tool/lib.mjs": 'export function greet() { return "it works"; }',
      "node_modules/.bin/.gitkeep": "",
      "package.json": "{}",
    });
    require("fs").chmodSync(join(temp, "node_modules/my-tool/cli.mjs"), 0o755);
    symlinkSync(join(temp, "node_modules/my-tool/cli.mjs"), join(temp, "node_modules/.bin/my-tool"));
    const result = Bun.spawnSync([bunExe(), "run", "--bun", "my-tool"], { cwd: String(temp), env: bunEnv });
    expect(result.stderr.toString("utf8").trim()).toBe("");
    expect(result.stdout.toString("utf8").trim()).toBe("it works");
    expect(result.exitCode).toBe(0);
  });
});
