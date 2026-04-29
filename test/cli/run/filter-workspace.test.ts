import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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
    const dir = tempDirWithFiles("testworkspace", {
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
    const dir = tempDirWithFiles("testworkspace", {
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
    const dir = tempDirWithFiles("testworkspace", {
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
    const dir = tempDirWithFiles("testworkspace", {
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
    const dir = tempDirWithFiles("testworkspace", {
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

  test("should error with missing script", () => {
    runInCwdFailure(cwd_root, "*", "notpresent", /No packages matched/);
  });
  test("should warn about malformed package.json", () => {
    runInCwdFailure(cwd_root, "*", "x", /Failed to read package.json/);
  });
  test("nonzero exit code on failure", () => {
    const dir = tempDirWithFiles("testworkspace", {
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
    elideLines: number;
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
        cmd: [bunExe(), "run", "--filter", "./packages/dep0", "--elide-lines", String(elideLines), "script"],
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

  test("elides output by default when using --filter", () => {
    runElideLinesTest({
      elideLines: 10,
      target_pattern: [/\[10 lines elided\]/, /(?:log_line[\s\S]*?){20}/],
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
    const dir = tempDirWithFiles("testworkspace", {
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

  // Regression test for https://github.com/oven-sh/bun/issues/29938.
  //
  // `bun run --filter <path-glob> ...` walks the workspace via
  // DirEntryAccessor, whose entry map is keyed by the lowercased filename.
  // Returning the map key as the entry name would hand the glob walker a
  // lowercased path it then openat()s on a case-sensitive filesystem,
  // surfacing `error: ENOENT`.
  test("--filter with a path glob works when a workspace dir contains uppercase letters (issue #29938)", () => {
    const dir = tempDirWithFiles("filter-casepath", {
      apps: {
        app1: {
          "package.json": JSON.stringify({
            name: "@issue/app1",
            scripts: { build: "echo app1-built" },
          }),
        },
        app2: {
          "package.json": JSON.stringify({
            name: "@issue/app2",
            scripts: { build: "echo app2-built" },
          }),
        },
      },
      packages: {
        somePackage: {
          "package.json": JSON.stringify({
            name: "@issue/somepackage",
            scripts: { build: "echo somepackage-built" },
          }),
        },
        "somePackage.test": {
          "package.json": JSON.stringify({
            name: "@issue/somepackage.test",
            scripts: { build: "echo somepackage-test-built" },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "issue",
        workspaces: ["apps/*", "packages/*"],
      }),
    });

    // A path-style filter traverses dirs on disk via the glob walker.
    const apps = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "./apps/**", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(apps.stderr.toString()).not.toContain("ENOENT");
    expect(apps.stdout.toString()).toContain("app1-built");
    expect(apps.stdout.toString()).toContain("app2-built");
    expect(apps.exitCode).toBe(0);

    // Same thing but hitting the mixed-case directory names directly.
    const pkgs = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "./packages/**", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(pkgs.stderr.toString()).not.toContain("ENOENT");
    expect(pkgs.stdout.toString()).toContain("somepackage-built");
    expect(pkgs.stdout.toString()).toContain("somepackage-test-built");
    expect(pkgs.exitCode).toBe(0);
  });
});
