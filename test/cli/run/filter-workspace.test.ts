import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "path";

const cwd_root = tempDirWithFiles("testworkspace", {
  packages: {
    pkga: {
      "index.js": "console.log('pkga');",
      "sleep.js":
        "for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 100)); console.log('x'); }",
      "package.json": JSON.stringify({
        name: "pkga",
        scripts: {
          present: "echo scripta",
          long: `${bunExe()} run sleep.js`,
        },
      }),
    },
    scoped: {
      "index.js": "console.log('pkga');",
      "sleep.js":
        "for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 100)); console.log('x'); }",
      "package.json": JSON.stringify({
        name: "@scoped/scoped",
        scripts: {
          present: "echo scriptd",
          long: `${bunExe()} run sleep.js`,
        },
      }),
    },
    pkgb: {
      "index.js": "console.log('pkgb');",
      "sleep.js":
        "for (let i = 0; i < 3; i++) { await new Promise(resolve => setTimeout(resolve, 100)); console.log('y'); }",
      "package.json": JSON.stringify({
        name: "pkgb",
        scripts: {
          present: "echo scriptb",
          long: `${bunExe()} run sleep.js`,
        },
      }),
    },
    dirname: {
      "index.js": "console.log('pkgc');",
      "package.json": JSON.stringify({
        name: "pkgc",
        scripts: {
          present: "echo scriptc",
        },
      }),
    },
    malformed1: {
      "package.json": JSON.stringify({
        scripts: {
          present: "echo malformed1",
        },
      }),
    },
    malformed2: {
      "package.json": "asdfsadfas",
    },
    missing: {
      foo: "bar",
    },
  },
  "package.json": JSON.stringify({
    name: "ws",
    scripts: {
      present: "echo rootscript",
    },
    workspaces: ["packages/*"],
  }),
});

// Edges: web -> api -> shared -> pkg-a; pkg-b and the root are isolated.
const graph_root = tempDirWithFiles("filter-selectors", {
  packages: {
    web: {
      "package.json": JSON.stringify({
        name: "web",
        dependencies: { api: "workspace:*" },
        scripts: { present: "echo out-web" },
      }),
    },
    api: {
      "package.json": JSON.stringify({
        name: "api",
        devDependencies: { shared: "workspace:*" },
        scripts: { present: "echo out-api" },
      }),
    },
    shared: {
      "package.json": JSON.stringify({
        name: "shared",
        dependencies: { "pkg-a": "*" },
      }),
    },
    "pkg-a": {
      "package.json": JSON.stringify({
        name: "pkg-a",
        scripts: { present: "echo out-pkg-a" },
      }),
    },
    "pkg-b": {
      "package.json": JSON.stringify({
        name: "pkg-b",
        scripts: { present: "echo out-pkg-b" },
      }),
    },
  },
  "package.json": JSON.stringify({
    name: "ws",
    workspaces: ["packages/*"],
    scripts: { present: "echo out-root" },
  }),
});

const cwd_packages = join(cwd_root, "packages");
const cwd_a = join(cwd_packages, "pkga");
const cwd_b = join(cwd_packages, "pkgb");
const cwd_c = join(cwd_packages, "dirname");
const cwd_d = join(cwd_packages, "scoped");

function runInCwdSuccess({
  cwd,
  pattern,
  target_pattern,
  antipattern,
  command = ["present"],
  auto = false,
  env = {},
  elideCount,
}: {
  cwd: string;
  pattern: string | string[];
  target_pattern: RegExp | RegExp[];
  antipattern?: RegExp | RegExp[];
  command?: string[];
  auto?: boolean;
  env?: Record<string, string | undefined>;
  elideCount?: number;
}) {
  const cmd = auto ? [bunExe()] : [bunExe(), "run"];

  // Add elide-lines first if specified
  if (elideCount !== undefined) {
    cmd.push("--elide-lines", elideCount.toString());
  }

  if (Array.isArray(pattern)) {
    for (const p of pattern) {
      cmd.push("--filter", p);
    }
  } else {
    cmd.push("-F", pattern);
  }

  for (const c of command) {
    cmd.push(c);
  }

  const { exitCode, stdout, stderr } = spawnSync({
    cwd,
    cmd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutval = stdout.toString();
  for (const r of Array.isArray(target_pattern) ? target_pattern : [target_pattern]) {
    expect(stdoutval).toMatch(r);
  }
  if (antipattern !== undefined) {
    for (const r of Array.isArray(antipattern) ? antipattern : [antipattern]) {
      expect(stdoutval).not.toMatch(r);
    }
  }
  // expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
}

function runInCwdFailure(cwd: string, pkgname: string, scriptname: string, result: RegExp) {
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: [bunExe(), "run", "--filter", pkgname, scriptname],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toMatch(result);
  expect(exitCode).not.toBe(0);
}

describe("bun", () => {
  const dirs = [cwd_root, cwd_packages, cwd_a, cwd_b, cwd_c, cwd_d];
  const packages = [
    {
      name: "pkga",
      output: /scripta/,
    },
    {
      name: "pkgb",
      output: /scriptb/,
    },
    {
      name: "pkgc",
      output: /scriptc/,
    },
    {
      name: "@scoped/scoped",
      output: /scriptd/,
    },
  ];

  const names = packages.map(p => p.name);
  for (const d of dirs) {
    for (const { name, output } of packages) {
      test(`resolve ${name} from ${d}`, () => {
        runInCwdSuccess({ cwd: d, pattern: name, target_pattern: output });
      });
    }
  }

  for (const d of dirs) {
    test(`resolve '*' from ${d}`, () => {
      runInCwdSuccess({
        cwd: d,
        pattern: "*",
        target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/],
      });
    });
    test(`resolve all from ${d}`, () => {
      runInCwdSuccess({
        cwd: d,
        pattern: names,
        target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/],
      });
    });
  }

  test("works with auto command", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "./packages/*",
      target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/, /malformed1/],
      auto: true,
    });
  });

  test("resolve all with glob", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "./packages/*",
      target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/, /malformed1/],
    });
  });
  test("resolve all with recursive glob", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "./**",
      target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/, /malformed1/],
    });
  });
  test("resolve 'pkga' and 'pkgb' but not 'pkgc' with targeted glob", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "./packages/pkg*",
      target_pattern: [/scripta/, /scriptb/],
      antipattern: /scriptc/,
    });
  });
  test("resolve package with missing name", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "./packages/malformed1",
      target_pattern: [/malformed1/],
      antipattern: [/scripta/, /scriptb/, /scriptc/],
    });
  });

  test("run in parallel", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "pkg*",
      target_pattern: [/x[\s\S]*y[\s\S]*x/],
      antipattern: [/scripta/, /scriptb/, /scriptc/],
      command: ["long"],
    });
  });

  test("run pre and post scripts, in order", () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "write.js": "await Bun.write('out.txt', 'success')",
        "readwrite.js": "console.log(await Bun.file('out.txt').text()); await Bun.write('post.txt', 'great success')",
        "read.js": "console.log(await Bun.file('post.txt').text())",
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            prescript: `${bunExe()} run write.js`,
            script: `${bunExe()} run readwrite.js`,
            postscript: `${bunExe()} run read.js`,
          },
        }),
      },
    });
    runInCwdSuccess({
      cwd: dir,
      pattern: "*",
      target_pattern: [/success/, /great success/],
      antipattern: [/not found/],
      command: ["script"],
    });
  });

  test("respect dependency order", () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "index.js": [
          "await new Promise((resolve) => setTimeout(resolve, 100))",
          "Bun.write('out.txt', 'success')",
        ].join(";"),
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      dep1: {
        "index.js": 'console.log(await Bun.file("../dep0/out.txt").text())',
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
    });
    runInCwdSuccess({
      cwd: dir,
      pattern: "*",
      target_pattern: [/success/],
      antipattern: [/not found/],
      command: ["script"],
    });
  });

  test("respect dependency order when dependency name is larger than 8 characters", () => {
    const largeNamePkgName = "larger-than-8-char";
    const fileContent = `${largeNamePkgName} - ${new Date().getTime()}`;
    const largeNamePkg = {
      "index.js": [
        "await new Promise((resolve) => setTimeout(resolve, 100))",
        `Bun.write('out.txt', '${fileContent}')`,
      ].join(";"),
      "package.json": JSON.stringify({
        name: largeNamePkgName,
        scripts: {
          script: `${bunExe()} run index.js`,
        },
      }),
    };
    using dir = tempDir("testworkspace", {
      main: {
        "index.js": `console.log(await Bun.file("../${largeNamePkgName}/out.txt").text())`,
        "package.json": JSON.stringify({
          name: "main",
          dependencies: {
            [largeNamePkgName]: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      [largeNamePkgName]: largeNamePkg,
    });
    runInCwdSuccess({
      cwd: dir,
      pattern: "*",
      target_pattern: [new RegExp(fileContent)],
      command: ["script"],
    });
  });

  test("ignore dependency order on cycle, preserving pre and post script order", () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "write.js": "await Bun.write('out.txt', 'success')",
        "readwrite.js":
          "console.log(await Bun.file('out.txt').text()); await Bun.write('post.txt', 'great success'); setTimeout(() => {}, 300)",
        "read.js": "console.log(await Bun.file('post.txt').text())",
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            prescript: `${bunExe()} run write.js`,
            script: `${bunExe()} run readwrite.js`,
            postscript: `${bunExe()} run read.js`,
          },
          dependencies: {
            dep1: "*",
          },
        }),
      },
      dep1: {
        "index.js": "setTimeout(() => {}, 300)",
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
    });
    runInCwdSuccess({
      cwd: dir,
      pattern: "*",
      target_pattern: [/success/, /great success/],
      antipattern: [/not found/],
      command: ["script"],
    });
  });

  test("detect cycle of length > 2", () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: "echo dep0",
          },
          dependencies: {
            dep1: "*",
          },
        }),
      },
      dep1: {
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep2: "*",
          },
          scripts: {
            script: "echo dep1",
          },
        }),
      },
      dep2: {
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: "echo dep2",
          },
        }),
      },
    });
    runInCwdSuccess({
      cwd: dir,
      pattern: "*",
      target_pattern: [/dep0/, /dep1/, /dep2/],
      antipattern: [/not found/],
      command: ["script"],
    });
  });

  // #40544: `bun --filter=<pat> test` must run each matched package's "test"
  // script (like `bun run --filter=<pat> test`), not bun's own test runner.
  // Same for `build` and the bundler.
  describe.concurrent("routes `test` and `build` to the package scripts", () => {
    const test_root = tempDirWithFiles("filter-test-subcommand", {
      packages: {
        pkga: {
          ".env": "FILTER_TEST_ENV=from-pkga-env",
          "package.json": JSON.stringify({
            name: "pkga",
            scripts: {
              test: `${bunExe()} -e "console.log('testa', process.env.FILTER_TEST_ENV)"`,
              build: "echo builda",
            },
          }),
        },
        pkgb: {
          "package.json": JSON.stringify({
            name: "pkgb",
            scripts: {
              test: "echo testb",
              build: "echo buildb",
            },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
    });

    for (const args of [
      ["--filter=pkga", "test"],
      ["-F=pkga", "test"],
      ["-Fpkga", "test"],
      ["--filter", "pkga", "test"],
    ]) {
      test(`bun ${args.join(" ")}`, () => {
        const { exitCode, stdout } = spawnSync({
          cwd: test_root,
          cmd: [bunExe(), ...args],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        // The package's own .env is loaded because the script runs with the
        // package directory as cwd.
        expect(stdout.toString()).toMatch(/testa from-pkga-env/);
        expect(stdout.toString()).not.toMatch(/testb/);
        expect(exitCode).toBe(0);
      });
    }

    test("bun --workspaces test", () => {
      const { exitCode, stdout } = spawnSync({
        cwd: test_root,
        cmd: [bunExe(), "--workspaces", "test"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stdout.toString()).toMatch(/testa from-pkga-env/);
      expect(stdout.toString()).toMatch(/testb/);
      expect(exitCode).toBe(0);
    });

    test("bun --filter=pkga build runs the package build script", () => {
      const { exitCode, stdout } = spawnSync({
        cwd: test_root,
        cmd: [bunExe(), "--filter=pkga", "build"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stdout.toString()).toMatch(/builda/);
      expect(stdout.toString()).not.toMatch(/buildb/);
      expect(exitCode).toBe(0);
    });

    test("bun --workspaces build runs every package build script", () => {
      const { exitCode, stdout } = spawnSync({
        cwd: test_root,
        cmd: [bunExe(), "--workspaces", "build"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stdout.toString()).toMatch(/builda/);
      expect(stdout.toString()).toMatch(/buildb/);
      expect(exitCode).toBe(0);
    });

    test("bun --filter=pkgb test forwards extra args to the script", () => {
      const { exitCode, stdout } = spawnSync({
        cwd: test_root,
        cmd: [bunExe(), "--filter=pkgb", "test", "extra-arg"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(stdout.toString()).toMatch(/testb extra-arg/);
      expect(exitCode).toBe(0);
    });
  });

  test("should error with missing script", () => {
    runInCwdFailure(cwd_root, "*", "notpresent", /error: Script "notpresent" not found in \d+ packages matching "\*"/);
    runInCwdFailure(cwd_root, "pkga", "notpresent", /error: Script "notpresent" not found in package "pkga"/);
  });
  test("should error once when the filter matches no package", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_root,
      cmd: [bunExe(), "run", "--filter", "nosuchpkg", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    // Said once, as an error — not as a warning and then again as an error.
    expect(stderr.toString().match(/No workspace packages matched/g)).toEqual(["No workspace packages matched"]);
    expect(stderr.toString()).toContain(`error: No workspace packages matched the filter "nosuchpkg"`);
    expect(exitCode).toBe(1);
  });
  test("warns about a filter that matched nothing while running the others", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_root,
      cmd: [bunExe(), "run", "--filter", "pkga", "--filter", "typo", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toMatch(/pkga/);
    expect(stderr.toString()).toContain('warn: No workspace packages matched the filter "typo"');
    expect(exitCode).toBe(0);
  });
  test("should warn about malformed package.json", () => {
    runInCwdFailure(cwd_root, "*", "x", /Failed to read .*malformed2.*package\.json/);
  });
  test("nonzero exit code on failure", () => {
    using dir = tempDir("testworkspace", {
      dep0: {
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: "exit 0",
          },
        }),
      },
      dep1: {
        "package.json": JSON.stringify({
          name: "dep1",
          scripts: {
            script: "exit 23",
          },
        }),
      },
    });
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutval = stdout.toString();
    expect(stdoutval).toMatch(/code 0/);
    expect(stdoutval).toMatch(/code 23/);
    expect(exitCode).toBe(23);
  });

  function runElideLinesTest({
    elideLines,
    target_pattern,
    antipattern,
  }: {
    elideLines?: number;
    target_pattern: RegExp[];
    antipattern?: RegExp[];
  }) {
    const dir = tempDirWithFiles("testworkspace", {
      packages: {
        dep0: {
          "index.js": Array(20).fill("console.log('log_line');").join("\n"),
          "package.json": JSON.stringify({
            name: "dep0",
            scripts: {
              script: `${bunExe()} run index.js`,
            },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
    });

    if (process.platform === "win32") {
      // Windows spawnSync pipes stdout, so `windowsIsTerminal()` returns false,
      // `state.pretty_output` is false, and `redraw()` short-circuits before
      // ever emitting elision output. `target_pattern` is intentionally NOT
      // iterated here: every caller bundles TTY-only regexes such as
      // `/\[N lines elided\]/` that would never appear in piped Windows output
      // and would fail the test for the wrong reason. The hardcoded log_line
      // match covers the non-TTY subset of every caller's target_pattern.
      // `antipattern` is iterated because absence-checks remain valid on either
      // code path.
      const { exitCode, stderr, stdout } = spawnSync({
        cwd: dir,
        cmd: [
          bunExe(),
          "run",
          "--filter",
          "./packages/dep0",
          ...(elideLines === undefined ? [] : ["--elide-lines", String(elideLines)]),
          "script",
        ],
        env: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdoutval = stdout.toString();
      expect(stderr.toString()).not.toContain("--elide-lines is only supported in terminal environments");
      expect(stdoutval).toMatch(/(?:log_line[\s\S]*?){20}/);
      if (antipattern) {
        for (const r of antipattern) {
          expect(stdoutval).not.toMatch(r);
        }
      }
      expect(exitCode).toBe(0);
      return;
    }

    runInCwdSuccess({
      cwd: dir,
      pattern: "./packages/dep0",
      env: { FORCE_COLOR: "1", NO_COLOR: "0" },
      target_pattern,
      antipattern,
      command: ["script"],
      elideCount: elideLines,
    });
  }

  test("does not elide output by default when using --filter", () => {
    runElideLinesTest({
      target_pattern: [/(?:log_line[\s\S]*?){20}/],
      antipattern: [/lines elided/],
    });
  });

  test("respects --elide-lines argument", () => {
    runElideLinesTest({
      elideLines: 15,
      target_pattern: [/\[5 lines elided\]/, /(?:log_line[\s\S]*?){20}/],
    });
  });

  test("--elide-lines=0 shows all output", () => {
    runElideLinesTest({
      elideLines: 0,
      target_pattern: [/(?:log_line[\s\S]*?){20}/],
      antipattern: [/lines elided/],
    });
  });

  test("--elide-lines is a no-op (not an error) when stdout is not a terminal", () => {
    using dir = tempDir("testworkspace", {
      packages: {
        dep0: {
          "index.js": Array(20).fill("console.log('log_line');").join("\n"),
          "package.json": JSON.stringify({ name: "dep0", scripts: { script: `${bunExe()} run index.js` } }),
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });

    // Use a non-zero value so the test would fail if elision ever leaked into
    // the non-TTY code path. With `--elide-lines 5`, a broken implementation
    // would only surface 5 log_line entries and the 20-match regex would fail.
    const { exitCode, stderr, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "./packages/dep0", "--elide-lines", "5", "script"],
      env: { ...bunEnv, FORCE_COLOR: undefined, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutval = stdout.toString();
    expect(stderr.toString()).not.toContain("--elide-lines is only supported in terminal environments");
    // Elision text is written to stdout via std.fs.File.stdout().writeAll() in
    // filter_run.zig's flushDrawBuf; guard the correct stream.
    expect(stdoutval).not.toMatch(/lines elided/);
    expect(stdoutval).toMatch(/(?:log_line[\s\S]*?){20}/);
    expect(exitCode).toBe(0);
  });

  // The terminal renderer is TTY-only on Windows (see runElideLinesTest).
  test.skipIf(isWindows)("terminal output reports how long a successful script took", () => {
    using dir = tempDir("filter-done-in", {
      packages: {
        dep0: {
          "package.json": JSON.stringify({ name: "dep0", scripts: { script: "exit 0" } }),
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });

    const { exitCode, stdout } = spawnSync({
      cwd: String(dir),
      cmd: [bunExe(), "run", "--filter", "dep0", "script"],
      env: { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stdout.toString()).toMatch(/Done in (?:\d+ ms|\d+\.\d{2} s)/);
    expect(exitCode).toBe(0);
  });

  test("self-referential directory symlink in a workspace does not loop", () => {
    using dir = tempDir("filter-symlink-loop", {
      packages: {
        pkga: {
          "package.json": JSON.stringify({ name: "pkga", scripts: { present: "echo scripta" } }),
        },
        cyc: {
          "package.json": JSON.stringify({ name: "cyc", scripts: { present: "echo scriptcyc" } }),
        },
      },
      // `packages/**` makes workspace discovery recurse into every package.
      "package.json": JSON.stringify({
        name: "ws",
        scripts: { present: "echo rootscript" },
        workspaces: ["packages/**"],
      }),
    });
    // "junction" so the link is creatable on unprivileged Windows; the type is
    // ignored on POSIX.
    symlinkSync(join(dir, "packages", "cyc"), join(dir, "packages", "cyc", "loop"), "junction");

    const { exitCode, stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutval = stdout.toString();
    const count = (needle: string) => stdoutval.split(needle).length - 1;
    // `pkga` is matched once. `cyc` is matched at `packages/cyc` and once more
    // through its own `loop` alias, where the cycle is detected and descent
    // stops instead of recursing until the path length limit.
    expect({ scripta: count("scripta"), scriptcyc: count("scriptcyc"), exitCode }).toEqual({
      scripta: 1,
      scriptcyc: 2,
      exitCode: 0,
    });
  });

  test("warning names which package.json failed to parse", async () => {
    await using dir = tempDir("filter-bad-pkgjson", {
      packages: {
        good: {
          "package.json": JSON.stringify({ name: "good", scripts: { go: "echo ok" } }),
        },
        broken: {
          "package.json": "this is { not valid json",
        },
      },
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--filter", "*", "go"],
      cwd: dir,
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The good package still runs; the broken one is skipped with a warning
    // that names its path.
    expect(stdout).toContain("ok");
    const sep = process.platform === "win32" ? "\\" : "/";
    expect(stderr).toContain(`broken${sep}package.json`);
    expect(stderr).toContain("skipping this workspace package");
    expect(exitCode).toBe(0);
  });
});

describe("selectors", () => {
  test("'foo...' runs foo and the workspaces it depends on", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "api...",
      target_pattern: [/out-api/, /out-pkg-a/],
      antipattern: [/out-web/, /out-pkg-b/, /out-root/],
    });
  });

  test("'foo^...' runs only the dependencies", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "api^...",
      target_pattern: [/out-pkg-a/],
      antipattern: [/out-api/, /out-web/],
    });
  });

  test("'...foo' runs foo and its dependents", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "...api",
      target_pattern: [/out-api/, /out-web/],
      antipattern: [/out-pkg-a/, /out-pkg-b/, /out-root/],
    });
  });

  test("'...^foo' runs only the dependents", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "...^api",
      target_pattern: [/out-web/],
      antipattern: [/out-api/, /out-pkg-a/],
    });
  });

  test("a relation on a directory selector", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "...{./packages/pkg-a}",
      target_pattern: [/out-pkg-a/, /out-api/, /out-web/],
      antipattern: [/out-pkg-b/, /out-root/],
    });
  });

  test("'{dir}' runs everything under the directory but not the root", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "{packages}",
      target_pattern: [/out-api/, /out-web/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-root/],
    });
  });

  test("'{.}' is resolved from the current directory", () => {
    runInCwdSuccess({
      cwd: join(graph_root, "packages"),
      pattern: "{.}",
      target_pattern: [/out-api/, /out-web/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-root/],
    });
  });

  // `bun run --filter` only runs workspace members; the root's own scripts are never selected.
  test("a '!' pattern subtracts from '*'", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: ["*", "!web"],
      target_pattern: [/out-api/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-web/, /out-root/],
    });
  });

  test("a negation-only filter set starts from every workspace", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "!web",
      target_pattern: [/out-api/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-web/, /out-root/],
    });
    runInCwdSuccess({
      cwd: graph_root,
      pattern: ["!web", "!pkg-b"],
      target_pattern: [/out-api/, /out-pkg-a/],
      antipattern: [/out-web/, /out-pkg-b/, /out-root/],
    });
  });

  test("a negation-only filter set still skips a package.json without a name", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "!pkga",
      target_pattern: [/scriptb/, /scriptc/, /scriptd/],
      antipattern: [/scripta/, /malformed1/, /rootscript/],
    });
  });

  test("a negated path pattern subtracts from '*'", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: ["*", "!./packages/web"],
      target_pattern: [/out-api/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-web/, /out-root/],
    });
  });

  test("a negated '{dir}' pattern on its own subtracts from every workspace", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "!{./packages/web}",
      target_pattern: [/out-api/, /out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-web/, /out-root/],
    });
  });

  test("'foo...' follows optionalDependencies but not peerDependencies", () => {
    using dir = tempDir("filter-optional-peer", {
      packages: {
        app: {
          "package.json": JSON.stringify({
            name: "app",
            optionalDependencies: { optlib: "workspace:*" },
            peerDependencies: { peerlib: "workspace:*" },
            scripts: { present: "echo out-app" },
          }),
        },
        optlib: {
          "package.json": JSON.stringify({ name: "optlib", scripts: { present: "echo out-optlib" } }),
        },
        peerlib: {
          "package.json": JSON.stringify({ name: "peerlib", scripts: { present: "echo out-peerlib" } }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
        scripts: { present: "echo out-root" },
      }),
    });
    runInCwdSuccess({
      cwd: String(dir),
      pattern: "app...",
      target_pattern: [/out-app/, /out-optlib/],
      antipattern: [/out-peerlib/, /out-root/],
    });
  });

  test("a negated relation subtracts the whole group", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: ["*", "!...api"],
      target_pattern: [/out-pkg-a/, /out-pkg-b/],
      antipattern: [/out-api/, /out-web/, /out-root/],
    });
  });

  test("selectors work in the 'bun --filter <script>' form", () => {
    runInCwdSuccess({
      cwd: graph_root,
      pattern: "api...",
      target_pattern: [/out-api/, /out-pkg-a/],
      antipattern: [/out-web/, /out-pkg-b/, /out-root/],
      auto: true,
    });
  });

  test("selectors work with --parallel", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--parallel", "--filter", "api...", "present"],
      cwd: graph_root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("out-api");
    expect(stdout).toContain("out-pkg-a");
    expect(stdout).not.toContain("out-web");
    expect(exitCode).toBe(0);
  });

  test("a bare '...' is rejected", () => {
    runInCwdFailure(graph_root, "...", "present", /is missing a workspace name or path/);
  });

  test("dependency order is kept inside a relation selection", () => {
    using dir = tempDir("filter-selectors-order", {
      dep0: {
        "index.js": [
          "await new Promise((resolve) => setTimeout(resolve, 100))",
          "Bun.write('out.txt', 'success')",
        ].join(";"),
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      dep1: {
        "index.js": 'console.log(await Bun.file("../dep0/out.txt").text())',
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      dep2: {
        "package.json": JSON.stringify({
          name: "dep2",
          scripts: {
            script: "echo unrelated",
          },
        }),
      },
    });
    runInCwdSuccess({
      cwd: String(dir),
      pattern: "dep1...",
      target_pattern: [/success/],
      antipattern: [/not found/, /unrelated/],
      command: ["script"],
    });
  });

  test("'*' still skips a package.json without a name", () => {
    runInCwdSuccess({
      cwd: cwd_root,
      pattern: "*",
      target_pattern: [/scripta/],
      antipattern: [/malformed1/],
    });
  });
});

// #20319: on Windows, `bun --filter` / `bun run --parallel` spawn each script
// as `bun exec "<script>"` with CREATE_NO_WINDOW, so the user's Ctrl+C never
// reaches the scripts and cleanup is entirely on the parent. libuv's global
// spawn Job is KILL_ON_CLOSE | SILENT_BREAKAWAY_OK, so membership only
// propagates one hop: as soon as the tree contains a non-libuv spawner
// (cmd.exe, a `.cmd` bin shim, node.exe), everything below it escapes and keeps
// its port bound after the parent exits.
//
// Tree under test:
//   test → bun parent → `bun exec` → cmd.exe → leaf bun (long-running).
// The leaf writes its pid to a file; the test kills the parent and polls the
// leaf. Without a recursive kill-on-close Job on the parent, the leaf survives.
describe.skipIf(!isWindows).each([
  { via: "--filter", argv: ["--filter", "*", "dev"] },
  { via: "run --parallel", argv: ["run", "--parallel", "dev"] },
])("windows: $via reaps the whole descendant tree when the parent exits (#20319)", ({ argv }) => {
  test.concurrent(
    "leaf dies",
    async () => {
      function isAlive(pid: number): boolean {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }
      async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (!isAlive(pid)) return true;
          await sleep(25);
        }
        return !isAlive(pid);
      }

      using dir = tempDir("filter-win-cleanup", {
        "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
        // .bat avoids cmd /c's quote-stripping around a quoted exe path + arg.
        "packages/app/run.bat": `@"${bunExe()}" "%~dp0server.js"\r\n`,
        "packages/app/server.js": `
          require("fs").writeFileSync(process.env.PIDFILE, String(process.pid));
          setInterval(() => {}, 1000);
        `,
        "packages/app/package.json": JSON.stringify({
          name: "app",
          scripts: { dev: "cmd /d /c run.bat" },
        }),
      });

      const pidfile = join(String(dir), "leaf.pid");
      // Unset NO_ORPHANS so the test exercises the unconditional Job rather
      // than the opt-in env-var path CI may set globally.
      const env: Record<string, string | undefined> = {
        ...bunEnv,
        PIDFILE: pidfile,
        BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
        NO_COLOR: "1",
      };

      const parent = Bun.spawn({
        cmd: [bunExe(), ...argv],
        env,
        cwd: join(String(dir), "packages", "app"),
        stdout: "ignore",
        stderr: "pipe",
      });

      let leafPid = 0;
      try {
        const deadline = Date.now() + 15000;
        while (leafPid === 0 && Date.now() < deadline) {
          try {
            const t = await Bun.file(pidfile).text();
            if (t.length > 0) leafPid = Number(t.trim());
          } catch {}
          if (leafPid === 0) await sleep(25);
        }
        if (leafPid === 0) {
          parent.kill("SIGKILL");
          await parent.exited;
          const stderr = await parent.stderr.text();
          throw new Error(`leaf never wrote pidfile; stderr:\n${stderr}`);
        }
        expect(isAlive(leafPid)).toBe(true);

        // TerminateProcess on the parent — same effect as the second Ctrl+C
        // (default handler) or the first Ctrl+C's abort() path once the direct
        // children have exited and the parent calls Global::exit().
        parent.kill("SIGKILL");
        await parent.exited;

        const died = await waitUntilDead(leafPid, 10000);
        expect(died).toBe(true);
      } finally {
        parent.kill("SIGKILL");
        await parent.exited;
        if (leafPid > 0 && isAlive(leafPid)) {
          try {
            process.kill(leafPid, "SIGKILL");
          } catch {}
          await waitUntilDead(leafPid, 2000);
        }
      }
    },
    30000,
  );
});

describe("output timing", () => {
  // A script is finished when its process exits: output it already wrote is
  // drained at that point, but a detached child still holding the pipe write
  // ends must not keep the run alive waiting for an EOF that may never come.
  test("a detached child holding the pipes does not delay the script's finish", async () => {
    using dir = tempDir("filter-late-output", {
      "package.json": JSON.stringify({
        name: "ws-late",
        workspaces: ["packages/*"],
      }),
      "packages/late/package.json": JSON.stringify({
        name: "pkg-late",
        scripts: {
          go: `${bunExe()} late.js`,
        },
      }),
      "packages/late/late.js": `
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "await Bun.sleep(30_000); console.log('late-line')"],
          stdio: ["ignore", "inherit", "inherit"],
          // Windows: keep the child out of this process's kill-on-close job.
          detached: true,
        });
        child.unref();
        await Bun.write("pid.txt", String(child.pid));
        console.log("early-line");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--filter", "pkg-late", "go"],
      // CI ASAN lanes set BUN_FEATURE_FLAG_NO_ORPHANS, which makes the script's
      // bun SIGKILL the detached child on exit; unset it so the child really
      // keeps the pipes open.
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Reap the pipe-holding child so nothing outlives the test. Guard the pid:
    // kill(0) would signal this whole process group.
    try {
      const pid = Number(await Bun.file(join(String(dir), "packages", "late", "pid.txt")).text());
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
    } catch {}
    expect(stdout).toContain("early-line");
    expect(stdout).toContain("Exited with code 0");
    // The run ends when the script exits; the child's much later write goes to
    // a closed pipe instead of delaying the run by 30s.
    expect(stdout).not.toContain("late-line");
    expect(exitCode).toBe(0);
  });

  // On abort (here: SIGINT), exit alone finishes a script; waiting for pipe
  // EOF would hang on the detached child that still holds go's stdout.
  test.skipIf(isWindows)("SIGINT does not wait for a child holding the script's pipes", async () => {
    using dir = tempDir("filter-abort-late", {
      "package.json": JSON.stringify({
        name: "ws-abort",
        workspaces: ["packages/*"],
      }),
      "packages/bg/package.json": JSON.stringify({
        name: "pkg-bg",
        scripts: {
          go: `${bunExe()} go.js`,
        },
      }),
      "packages/bg/go.js": `
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "await Bun.sleep(30_000)"],
          stdio: ["ignore", "inherit", "inherit"],
          detached: true,
        });
        child.unref();
        await Bun.write("ready.txt", String(child.pid));
        await Bun.sleep(15_000);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--filter", "pkg-bg", "go"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // New session, so the group signal below cannot reach the test runner.
      detached: true,
    });
    const ready = join(String(dir), "packages", "bg", "ready.txt");
    const deadline = Date.now() + 15_000;
    while (!existsSync(ready)) {
      if (Date.now() > deadline || proc.exitCode !== null) {
        proc.kill();
        const [o, e] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
        throw new Error(`go never wrote ready.txt; stdout: ${o}stderr: ${e}`);
      }
      await Bun.sleep(10);
    }
    // Ctrl-C semantics: the terminal signals the foreground process group
    // (bun run and the script), but not the detached grandchild.
    const start = Date.now();
    process.kill(-proc.pid, "SIGINT");
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Reap the pipe-holding grandchild so nothing outlives the test. Guard the
    // pid: kill(0) would signal this whole process group.
    try {
      const pid = Number(await Bun.file(ready).text());
      if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGKILL");
    } catch {}
    // 128 + SIGINT: go is killed by the signal and is the only script. stderr
    // rides along so a regression surfaces it in the failure output.
    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 130,
      stdout: expect.any(String),
      stderr: expect.any(String),
    });
    // Waiting out the grandchild's 30s sleep means the abort bypass regressed.
    expect(Date.now() - start).toBeLessThan(15000);
  });
});

describe("auto-discovered bunfig.toml [run] section", () => {
  // With `run.bun = true` bun puts a `node` shim on PATH, so `typeof Bun`
  // tells which binary ran the script.
  const typeofBun = `node -e "console.log('Bun is ' + typeof Bun)"`;

  function workspace(prefix: string, bunfig: string) {
    return tempDir(prefix, {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify({ name: "ws", workspaces: ["packages/*"] }),
      packages: {
        dep0: {
          "index.js": Array(20).fill("console.log('log_line');").join("\n"),
          "package.json": JSON.stringify({
            name: "dep0",
            scripts: { script: typeofBun, lines: `${bunExe()} run index.js` },
          }),
        },
      },
    });
  }

  function run(dir: string, args: string[], env: Record<string, string | undefined> = {}) {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
  }

  test.each([
    ["bun run --filter", ["run", "--filter", "dep0", "script"]],
    ["bun --filter", ["--filter", "dep0", "script"]],
    ["bun run --workspaces", ["run", "--workspaces", "script"]],
  ])("%s applies [run] bun = true", (_, args) => {
    using dir = workspace("filter-bunfig-run-bun", "[run]\nbun = true\n");
    const r = run(String(dir), args);
    expect(r.stdout).toContain("Bun is object");
    expect(r.exitCode).toBe(0);
  });

  test("--bun on the CLI wins over [run] bun = false", () => {
    using dir = workspace("filter-bunfig-cli-bun", "[run]\nbun = false\n");
    const r = run(String(dir), ["run", "--bun", "--filter", "dep0", "script"]);
    expect(r.stdout).toContain("Bun is object");
    expect(r.exitCode).toBe(0);
  });

  // Elision only happens on a terminal. On POSIX FORCE_COLOR=1 turns the
  // terminal renderer on for a pipe; on Windows it stays off (see runElideLinesTest).
  test.skipIf(isWindows)("[run] elide-lines enables elision for --filter", () => {
    using dir = workspace("filter-bunfig-elide", "[run]\nelide-lines = 15\n");
    const r = run(String(dir), ["run", "--filter", "dep0", "lines"], { FORCE_COLOR: "1", NO_COLOR: "0" });
    expect(r.stdout).toMatch(/\[5 lines elided\]/);
    expect(r.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("--elide-lines on the CLI wins over [run] elide-lines", () => {
    using dir = workspace("filter-bunfig-cli-elide", "[run]\nelide-lines = 15\n");
    const r = run(String(dir), ["run", "--elide-lines", "0", "--filter", "dep0", "lines"], {
      FORCE_COLOR: "1",
      NO_COLOR: "0",
    });
    expect(r.stdout).not.toMatch(/lines elided/);
    expect(r.stdout).toMatch(/(?:log_line[\s\S]*?){20}/);
    expect(r.exitCode).toBe(0);
  });

  test("a malformed bunfig.toml fails the run", () => {
    using dir = workspace("filter-bunfig-malformed", '[run]\nbun = "yes"\n');
    const r = run(String(dir), ["run", "--filter", "dep0", "script"]);
    expect(r.stderr).toContain("Expected boolean");
    expect(r.stdout).not.toContain("Bun is");
    expect(r.exitCode).toBe(1);
  });
});
