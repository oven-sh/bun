import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
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
}: {
  cwd: string;
  pattern: string | string[];
  target_pattern: RegExp | RegExp[];
  antipattern?: RegExp | RegExp[];
  command?: string[];
  auto?: boolean;
}) {
  const cmd = auto ? [bunExe()] : [bunExe(), "run"];
  if (Array.isArray(pattern)) {
    for (const p of pattern) {
      cmd.push("--filter", p);
    }
  } else {
    cmd.push("--filter", pattern);
  }
  for (const c of command) {
    cmd.push(c);
  }
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: cmd,
    env: bunEnv,
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
        "index.js": "Bun.write('out.txt', 'success')",
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
});
