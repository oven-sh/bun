import { describe, expect, test } from "bun:test";
import { join, sep } from "path";
import { bunEnv, bunExe, fakeNodeRun, tempDir } from "../../harness";

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

  // Node sets `process.argv[1]` to `path.resolve()` of the script argument.
  describe("process.argv[1] is the normalized path of the script", () => {
    const scripts: [name: string, script: (temp: string) => string, normalized: (temp: string) => string][] = [
      ["an absolute path with `.` and `..`", temp => `${temp}/./pkg/../index.js`, temp => join(temp, "index.js")],
      ["an absolute path with a repeated separator", temp => `${temp}//index.js`, temp => join(temp, "index.js")],
      [
        "an absolute path with `/` separators",
        temp => join(temp, "index.js").replaceAll("\\", "/"),
        temp => join(temp, "index.js"),
      ],
      // Unlike `path.resolve()`, a trailing separator stays: see the directory test below.
      ["a directory with a trailing separator", temp => `${temp}//pkg/`, temp => join(temp, "pkg") + sep],
    ];
    test.each(scripts)("%s", (_, script, normalized) => {
      using temp = tempDir("fake-node", {
        "index.js": "console.log(process.argv[1])",
        "pkg/index.js": "console.log(process.argv[1])",
      });
      expect(fakeNodeRun(temp, script(String(temp))).stdout).toBe(normalized(String(temp)));
    });

    const mainModules: [name: string, script: (temp: string) => string][] = [
      // The launcher that pnpm writes to `node_modules/.bin` runs `node "$basedir/../pkg/cli.mjs"`.
      ["through `node_modules/.bin/..`", temp => `${temp}/node_modules/.bin/../pkg/cli.mjs`],
      // Git Bash and MSYS2 pass a Windows path with `/` separators.
      ["with `/` separators", temp => join(temp, "node_modules", "pkg", "cli.mjs").replaceAll("\\", "/")],
    ];
    test.each(mainModules)("an ES module that runs %s finds that it is the main module", (_, script) => {
      using temp = tempDir("fake-node", {
        "node_modules/.bin/pkg": "",
        "node_modules/pkg/cli.mjs": `
          import { fileURLToPath } from "node:url";
          console.log(process.argv[1] === fileURLToPath(import.meta.url));
        `,
      });
      expect(fakeNodeRun(temp, script(String(temp))).stdout).toBe("true");
    });

    // The module loader resolves the entry from the same path. Bun tries `pkg.ts` before the directory
    // `pkg` (see "entrypoint file extension picking"), so only the separator keeps `node ./pkg/` on
    // `pkg/index.js`, which is what Node runs beside a `pkg.ts`.
    test.each(["pkg.js", "pkg.ts"])("a trailing separator selects the directory over %s", sibling => {
      using temp = tempDir("fake-node", {
        [sibling]: "console.log('sibling')",
        "pkg/index.js": "console.log('directory')",
      });
      expect([fakeNodeRun(temp, "./pkg").stdout, fakeNodeRun(temp, "./pkg/").stdout]).toEqual(["sibling", "directory"]);
    });
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
});
