import { $ } from "bun";
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { bunEnv as bunEnv_, bunExe, forEachLine, isWindows, substDrive, tempDir, tempDirWithFiles } from "harness";
import { basename, delimiter, join } from "path";

const bunEnv: typeof bunEnv_ = {
  ...bunEnv_,
  BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN: "1",
};

describe.concurrent("bun run", () => {
  for (let withRun of [false, true]) {
    describe(withRun ? "bun run" : "bun", () => {
      describe("should work with .", () => {
        it("respecting 'main' field and allowing trailing commas/comments in package.json", async () => {
          using dir = tempDir("bun-run-main", {
            "test.js": "console.log('Hello, world!');",
            "package.json": `{
            // single-line comment
            "name": "test",
            /** even multi-line comment!!
             * such feature much compatible very ecosystem
             */
            "version": "0.0.0",
            "main": "test.js",
          }`,
          });
          await using proc = Bun.spawn({
            cmd: [bunExe(), ...(withRun ? ["run"] : []), "."].filter(Boolean),
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toBe("");
          expect(stdout).toBe("Hello, world!\n");
          expect(exitCode).toBe(0);
        });

        it("falling back to index", async () => {
          using dir = tempDir("bun-run-index", {
            "index.ts": "console.log('Hello, world!');",
            "package.json": JSON.stringify({
              name: "test",
              version: "0.0.0",
            }),
          });

          await using proc = Bun.spawn({
            cmd: [bunExe(), ...(withRun ? ["run"] : []), "."].filter(Boolean),
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toBe("");
          expect(stdout).toBe("Hello, world!\n");
          expect(exitCode).toBe(0);
        });

        it("invalid tsconfig.json is ignored", async () => {
          using dir = tempDir("bun-run-tsconfig", {
            "package.json": JSON.stringify({
              name: "test",
              version: "0.0.0",
              scripts: {
                "boop": "echo hi",
              },
            }),
            "tsconfig.json": "!!!bad!!!",
          });

          await using proc = Bun.spawn({
            cmd: [bunExe(), "--silent", ...(withRun ? ["run"] : []), "boop"].filter(Boolean),
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toBe("");
          expect(stdout.replaceAll("\r\n", "\n")).toBe("hi\n");
          expect(exitCode).toBe(0);
        });

        it("--silent omits error messages", async () => {
          using dir = tempDir("bun-run-silent", {});
          const exe = isWindows ? "bun.exe" : "bun";
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", "--silent", exe, "doesnotexist"],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).not.toEndWith(`error: "${exe}" exited with code 1\n`);
          expect(stdout).toBe("");
          expect(exitCode).toBe(1);
        });

        it("no --silent includes error messages", async () => {
          using dir = tempDir("bun-run-nosilent", {});
          const exe = isWindows ? "bun.exe" : "bun";
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", exe, "doesnotexist"],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toEndWith(`error: "${exe}" exited with code 1\n`);
          expect(exitCode).toBe(1);
        });

        it.skipIf(isWindows)("exit code message works above 128", async () => {
          using dir = tempDir("bun-run-exitcode", {});
          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", "bash", "-c", "ulimit -c 0; exit 200"],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toStartWith('error: "bash" exited with code 200');
          expect(exitCode).toBe(200);
        });

        describe.each(["--silent", "not silent"])("%s", silentOption => {
          const silent = silentOption === "--silent";
          it.skipIf(isWindows)("exit signal works", async () => {
            using dir = tempDir("bun-run-signal", {});
            {
              await using proc = Bun.spawn({
                cmd: [bunExe(), ...(silent ? ["--silent"] : []), "run", "bash", "-c", "ulimit -c 0; kill -4 $$"].filter(
                  Boolean,
                ),
                cwd: String(dir),
                env: bunEnv,
                stdout: "pipe",
                stderr: "pipe",
              });

              const [stdout, stderr, exitCode] = await Promise.all([
                proc.stdout.text(),
                proc.stderr.text(),
                proc.exited,
              ]);

              if (silent) {
                expect(stderr).toBe("");
              } else {
                expect(stderr).toContain("bash");
                expect(stderr).toContain("SIGILL");
              }

              expect(proc.signalCode).toBe("SIGILL");
              // exitCode is null or 128+signal depending on context
              expect(exitCode === null || exitCode === 132).toBe(true);
            }
            {
              await using proc = Bun.spawn({
                cmd: [bunExe(), ...(silent ? ["--silent"] : []), "run", "bash", "-c", "ulimit -c 0; kill -9 $$"],
                cwd: String(dir),
                env: bunEnv,
                stdout: "pipe",
                stderr: "pipe",
              });

              const [stdout, stderr, exitCode] = await Promise.all([
                proc.stdout.text(),
                proc.stderr.text(),
                proc.exited,
              ]);

              if (silent) {
                expect(stderr).toBe("");
              } else {
                expect(stderr).toContain("bash");
                expect(stderr).toContain("SIGKILL");
              }
              expect(proc.signalCode).toBe("SIGKILL");
              // exitCode is null or 128+signal depending on context
              expect(exitCode === null || exitCode === 137).toBe(true);
            }
          });
        });

        for (let withLogLevel of [true, false]) {
          it(
            "valid tsconfig.json with invalid extends doesn't crash" + (withLogLevel ? " (log level debug)" : ""),
            async () => {
              using dir = tempDir("bun-run-tsconfig-extends", {
                "package.json": JSON.stringify({
                  name: "test",
                  version: "0.0.0",
                  scripts: {},
                }),
                "tsconfig.json": JSON.stringify(
                  {
                    extends: "!!!bad!!!",
                  },
                  null,
                  2,
                ),
                "index.js": "console.log('hi')",
                ...(withLogLevel ? { "bunfig.toml": `logLevel = "debug"` } : {}),
              });

              await using proc = Bun.spawn({
                // TODO: figure out why -c is necessary here.
                cmd: [
                  bunExe(),
                  ...(withRun ? ["run"] : []),
                  "-c=" + join(String(dir), "bunfig.toml"),
                  "./index.js",
                ].filter(Boolean),
                cwd: String(dir),
                env: bunEnv,
                stdout: "pipe",
                stderr: "pipe",
              });

              const [stdout, stderr, exitCode] = await Promise.all([
                proc.stdout.text(),
                proc.stderr.text(),
                proc.exited,
              ]);

              if (withLogLevel) {
                expect(stderr.trim()).toContain("ENOENT loading tsconfig.json extends");
              } else {
                expect(stderr.trim()).not.toContain("ENOENT loading tsconfig.json extends");
              }

              expect(stdout).toBe("hi\n");
              expect(exitCode).toBe(0);
            },
          );
        }

        it("falling back to index with no package.json", async () => {
          using dir = tempDir("bun-run-nopkg", {
            "index.ts": "console.log('Hello, world!');",
          });

          await using proc = Bun.spawn({
            cmd: [bunExe(), ...(withRun ? ["run"] : []), "."].filter(Boolean),
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toBe("");
          expect(stdout).toBe("Hello, world!\n");
          expect(exitCode).toBe(0);
        });

        it("should not passthrough script arguments to pre- or post- scripts", async () => {
          using dir = tempDir("bun-run-prepost", {
            "package.json": JSON.stringify({
              scripts: {
                premyscript: "echo pre",
                myscript: "echo main",
                postmyscript: "echo post",
              },
            }),
          });

          await using proc = Bun.spawn({
            cmd: [bunExe(), "run", "--silent", "myscript", "-a", "-b", "-c"].filter(Boolean),
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          expect(stderr).toBe("");
          expect(stdout.replaceAll("\r\n", "\n")).toBe("pre\n" + "main -a -b -c\n" + "post\n");
          expect(exitCode).toBe(0);
        });
      });
    });
  }

  it("should show the correct working directory when run with --cwd", async () => {
    using dir = tempDir("bun-run-cwd", {
      "subdir/test.js": `console.log(process.cwd());`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--cwd", "subdir", "test.js"],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
      },
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toMatch(/subdir/);
    // The exit code will not be 1 if it panics.
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29273
  // `C:` is the current directory of drive C, it is not the root `C:\`.
  it.skipIf(!isWindows)("runs a script of a package.json in the root of a drive", async () => {
    using dir = tempDir("bun-run-drive-root", {
      "package.json": JSON.stringify({
        name: "test",
        version: "0.0.0",
        scripts: { prehello: "echo pre", hello: "pwd" },
      }),
      "subdir/.keep": "",
    });
    using drive = substDrive(String(dir));

    for (const cwd of [drive.root, join(drive.root, "subdir")]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "hello"],
        cwd,
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ cwd, stderr }).toEqual({ cwd, stderr: "$ echo pre\n$ pwd\n" });
      expect(stdout.replaceAll("\r\n", "\n")).toBe(`pre\n${drive.root}\n`);
      expect(exitCode).toBe(0);
    }
  });

  describe("--cwd longer than the OS path limit", () => {
    // Longer than PATH_MAX on every platform (4096 on Linux, 1024 on macOS).
    const tooLong = Buffer.alloc(5000, "a").toString();

    for (const [kind, cwdArg] of [
      ["absolute", "/" + tooLong],
      ["relative", tooLong],
    ] as const) {
      it(`${kind} value is reported as an error instead of crashing`, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--cwd", cwdArg, "-e", "console.log('ran')"],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toContain(`Could not change directory to "${cwdArg}"`);
        // Windows leaves the verdict on a path this long to SetCurrentDirectoryW.
        if (!isWindows) expect(stderr).toContain("ENAMETOOLONG");
        expect(stdout).toBe("");
        expect(proc.signalCode).toBeNull();
        expect(exitCode).toBe(1);
      });
    }

    it("value that only normalizes down to a path that fits is honored", async () => {
      using dir = tempDir("bun-run-cwd-normalize", {
        "subdir/.keep": "",
      });
      // 6006 bytes before normalization, "subdir" after it.
      const cwdArg = "subdir" + Buffer.alloc(6000, "/../subdir").toString();

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--cwd", cwdArg, "-e", "console.log(process.cwd())"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(basename(stdout.trim())).toBe("subdir");
      expect(exitCode).toBe(0);
    });
  });

  it("DCE annotations are respected", async () => {
    using dir = tempDir("test", {
      "index.ts": `
      /* @__PURE__ */ console.log("Hello, world!");
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/41275
  it("a __PURE__ marker that is not the first word of a // comment is not a DCE annotation", async () => {
    const source = `
      function repro() {
        // \`/*#__PURE__*/\`
        console.log("Hello, world!");
      }
      repro();
      // Wrap class inside init: \`/*#__PURE__*/ (() => { let C = class C {}; return C; })()\`
      console.log("second");
      // @__PURE__
      console.log("removed");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("Hello, world!\nsecond\n");
    expect(exitCode).toBe(0);
  });

  it("--ignore-dce-annotations ignores DCE annotations", async () => {
    using dir = tempDir("test", {
      "index.ts": `
      /* @__PURE__ */ console.log("Hello, world!");
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--ignore-dce-annotations", "run", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("Hello, world!\n");
    expect(exitCode).toBe(0);
  });

  it("$npm_command is accurate", async () => {
    using dir = tempDir("bun-run-npm-command", {
      "package.json": `{
      "scripts": {
        "sample": "echo $npm_command",
      },
    }
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "sample"],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe(`$ echo $npm_command\n`);
    expect(stdout).toBe(`run-script\n`);
    expect(exitCode).toBe(0);
  });

  it("$npm_lifecycle_event is accurate", async () => {
    using dir = tempDir("bun-run-npm-lifecycle", {
      "package.json": `{
      "scripts": {
        "presample": "echo $npm_lifecycle_event",
        "sample": "echo $npm_lifecycle_event",
        "postsample": "echo $npm_lifecycle_event",
      },
    }
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "sample"],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // prettier-ignore
    expect(stderr).toBe(`$ echo $npm_lifecycle_event\n$ echo $npm_lifecycle_event\n$ echo $npm_lifecycle_event\n`);
    expect(stdout).toBe(`presample\nsample\npostsample\n`);
    expect(exitCode).toBe(0);
  });

  it("$npm_package_config_* works", async () => {
    using dir = tempDir("bun-run-npm-config", {
      "package.json": `{
      "config": {
        "foo": "bar"
      },
      "scripts": {
        "sample": "echo $npm_package_config_foo",
      },
    }
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "sample"],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe(`$ echo $npm_package_config_foo\n`);
    expect(stdout).toBe(`bar\n`);
    expect(exitCode).toBe(0);
  });

  it("does not crash after spawning with $ variable", async () => {
    using dir = tempDir("bun-run-dollar", {
      "package.json": JSON.stringify({
        scripts: {
          debug: "bun index.js $hi",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "debug"],
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toBe(
      '$ bun index.js $hi\nerror: Module not found "index.js"\nerror: script "debug" exited with code 1\n',
    );
    expect(exitCode).toBe(1);
  });

  it("should pass arguments correctly in scripts", async () => {
    using dir = tempDir("test", {
      "package.json": JSON.stringify({
        workspaces: ["a", "b"],
        scripts: { "root_script": "bun index.ts" },
      }),
      "index.ts": `for(const arg of Bun.argv) console.log(arg);`,
      "a/package.json": JSON.stringify({ name: "a", scripts: { echo2: "echo" } }),
      "b/package.json": JSON.stringify({ name: "b", scripts: { echo2: "npm run echo3", echo3: "echo" } }),
    });

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "root_script", "$HOME (!)", "argument two"].filter(Boolean),
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe('$ bun index.ts "\\$HOME (!)" "argument two"\n');
      expect(stdout).toEndWith("\n$HOME (!)\nargument two\n");
      expect(exitCode).toBe(0);
    }
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--filter", "*", "echo2", "$HOME (!)", "argument two"].filter(Boolean),
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout.split("\n").sort().join("\n")).toBe(
        [
          "a echo2: $HOME (!) argument two",
          "a echo2: Exited with code 0",
          'b echo2: $ echo "\\$HOME (!)" "argument two"',
          "b echo2: $HOME (!) argument two",
          "b echo2: Exited with code 0",
          "",
        ]
          .sort()
          .join("\n"),
      );
      expect(exitCode).toBe(0);
    }
  });

  const cases = [
    ["yarn run", "run"],
    ["yarn add", "passthrough"],
    ["yarn audit", "passthrough"],
    ["yarn -abcd run", "passthrough"],
    ["yarn info", "passthrough"],
    ["yarn generate-lock-entry", "passthrough"],
    ["yarn", "run"],
    ["npm run", "run"],
    ["npx", "x"],
    ["pnpm run", "run"],
    ["pnpm dlx", "x"],
    ["pnpx", "x"],
  ];
  describe("should handle run case", () => {
    for (const ccase of cases) {
      it(ccase[0], async () => {
        using dir = tempDir("test", {
          "package.json": JSON.stringify({
            scripts: {
              "root_script": `   ${ccase[0]} target_script%    `,
              "target_script%": "   echo target_script    ",
            },
          }),
        });
        {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "root_script"],
            cwd: String(dir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

          if (ccase[1] === "run") {
            expect(stderr).toMatch(/^\$    bun(-debug)? run target_script%    \n\$    echo target_script    \n/);
            expect(stdout).toEndWith("target_script\n");
            expect(exitCode).toBe(0);
          } else if (ccase[1] === "x") {
            expect(stderr).toMatch(
              /^\$    bun(-debug)? x target_script%    \nerror: unrecognised dependency format: target_script%/,
            );
            expect(exitCode).toBe(1);
          } else {
            expect(stderr).toStartWith(`$    ${ccase[0]} target_script%    \n`);
          }
        }
      });
    }
  });

  // https://github.com/oven-sh/bun/issues/33796
  describe("npm workspace flags in scripts", () => {
    // `start` is the script under test. Only apps/app has `hello`, only the root has `greet`.
    async function runStart(start: string) {
      const dir = tempDir("npm-workspace-flags", {
        "package.json": JSON.stringify({
          private: true,
          workspaces: ["apps/*"],
          scripts: { start, greet: "echo greet-done" },
        }),
        "apps/app/package.json": JSON.stringify({ name: "app", scripts: { hello: "echo workspace-ok" } }),
        "apps/scoped/package.json": JSON.stringify({ name: "@apps/scoped", scripts: { scoped: "echo scoped-ok" } }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "start"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        // Without the rewrite the script runs itself again, without end.
        timeout: 15_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { dir, stdout, stderr, exitCode };
    }

    it.each([
      ["npm run hello -w app", " run --filter=app hello\n", "workspace-ok"],
      ["npm run -w app hello", " run --filter=app hello\n", "workspace-ok"],
      ["npm run hello --workspace app", " run --filter=app hello\n", "workspace-ok"],
      ["npm run hello --workspace=app", " run --filter=app hello\n", "workspace-ok"],
      ["npm run hello -w=app", " run --filter=app hello\n", "workspace-ok"],
      ["npm run hello -w apps/app", " run --filter=./apps/app hello\n", "workspace-ok"],
      ["npm run hello -w ./apps/app", " run --filter=./apps/app hello\n", "workspace-ok"],
      ["npm run hello --workspace=apps/app", " run --filter=./apps/app hello\n", "workspace-ok"],
      ["npm run scoped -w @apps/scoped", " run --filter=@apps/scoped scoped\n", "scoped-ok"],
      ["npm run hello --ws --if-present", " run --workspaces --if-present hello\n", "workspace-ok"],
      ["npm run hello --workspaces --if-present", " run --workspaces --if-present hello\n", "workspace-ok"],
      ["echo chained && npm run hello --if-present --ws", " run --if-present --workspaces hello\n", "workspace-ok"],
      ["npm run hello -w app && echo chained", " run --filter=app hello && echo chained\n", "chained"],
    ])("%s runs the script of the workspace", async (start, rewritten, output) => {
      const { dir, stdout, stderr, exitCode } = await runStart(start);
      using _ = dir;
      expect(stderr).not.toContain("error:");
      expect(stderr).toContain(rewritten);
      expect(stdout).toContain(output);
      expect(exitCode).toBe(0);
    });

    // Anything that isn't a workspace flag of this `npm run`, or that's ambiguous, is left where it is.
    it.each([
      "npm run greet -- -w app",
      "npm run greet -w --if-present",
      "(true && npm run greet -w app)",
      "npm run greet -w $(echo app)",
      "npm run greet # switch to -w app",
      ...(isWindows ? [] : ["sh -c 'npm run greet -w app'"]),
    ])("%s still runs the root's script", async start => {
      const { dir, stdout, stderr, exitCode } = await runStart(start);
      using _ = dir;
      expect(stderr).not.toContain("--filter");
      expect(stdout).toContain("greet-done");
      expect(exitCode).toBe(0);
    });

    it("doesn't change a redirect that's attached to the workspace name", async () => {
      const { dir, stderr, exitCode } = await runStart("npm run greet -w app>out.txt");
      using _ = dir;
      expect(stderr).not.toContain("--filter");
      expect(await Bun.file(join(String(dir), "out.txt")).text()).toContain("greet-done");
      expect(exitCode).toBe(0);
    });

    it.skipIf(isWindows)("doesn't change an `npm run` that's only quoted text", async () => {
      const { dir, stdout, exitCode } = await runStart("echo 'step: npm run build -w app' && echo 'ok; done'");
      using _ = dir;
      expect(stdout).toContain("-w app");
      expect(stdout).not.toContain("--filter");
      expect(exitCode).toBe(0);
    });
  });

  describe("'bun run' priority", async () => {
    // priority:
    // - 1: run script with matching name
    // - 2: load module and run that module
    // - 3: execute a node_modules/.bin/<X> command
    // - 4: ('run' only): execute a system command, like 'ls'
    const dir = tempDirWithFiles("test", {
      "test": { "index.js": "console.log('test/index.js');" },
      "build": { "script.js": "console.log('build/script.js');" },
      "consume": { "index.js": "console.log('consume/index.js');" },
      "index.js": "console.log('index.js')",
      "main.js": "console.log('main.js')",
      "typescript.ts": "console.log('typescript.ts')",
      "sample.js": "console.log('sample.js')",
      "noext": "console.log('noext')",
      "folderandfile": { "index.js": "console.log('folderandfile/index.js')" },
      "folderandfile.js": "console.log('folderandfile.js')",
      "shellscript.sh": "echo shellscript.sh",
      ".secretscript.js": "console.log('.secretscript.js')",
      "package.json": JSON.stringify({
        scripts: {
          "build": "echo scripts/build",
          "test": "echo scripts/test",
          "sample.js": "echo scripts/sample.js",
          "§'.js": 'echo "scripts/§\'.js"',
          "test.todo": "echo scripts/test.todo",
          "/absolute": "echo DO_NOT_RUN",
          "./relative": "echo DO_NOT_RUN",
        },
        main: "main.js",
      }),
      "nx.json": JSON.stringify({}),
      "§'.js": 'console.log("§\'.js")',
      "node_modules": {
        ".bin": {
          "confabulate": `#!${bunExe()}\nconsole.log("node_modules/.bin/confabulate")`,
          "nx": `#!${bunExe()}\nconsole.log("node_modules/.bin/nx")`,
        },
      },
      "no_run_json.json": JSON.stringify({}),
    });
    chmodSync(dir + "/node_modules/.bin/confabulate", 0o755);
    chmodSync(dir + "/node_modules/.bin/nx", 0o755);

    const commands: {
      command: string[];
      req_run?: boolean;
      stdout: string;
      stderr?: string | RegExp;
      exitCode?: number;
    }[] = [
      { command: ["test"], stdout: "scripts/test", stderr: "$ echo scripts/test", req_run: true },
      { command: ["build"], stdout: "scripts/build", stderr: "$ echo scripts/build", req_run: true },
      { command: ["consume"], stdout: "consume/index.js", stderr: "" },

      { command: ["test/index"], stdout: "test/index.js", stderr: "" },
      { command: ["test/index.js"], stdout: "test/index.js", stderr: "" },
      { command: ["build/script"], stdout: "build/script.js", stderr: "" },
      { command: ["build/script.js"], stdout: "build/script.js", stderr: "" },
      { command: ["consume/index"], stdout: "consume/index.js", stderr: "" },
      { command: ["consume/index.js"], stdout: "consume/index.js", stderr: "" },

      { command: ["./test"], stdout: "test/index.js", stderr: "" },
      { command: ["./build"], stdout: "", stderr: /error: Module not found "\.(\/|\\|\\\\)build"|EACCES/, exitCode: 1 },
      { command: ["./consume"], stdout: "consume/index.js", stderr: "" },

      { command: ["index.js"], stdout: "index.js", stderr: "" },
      { command: ["./index.js"], stdout: "index.js", stderr: "" },
      { command: ["index"], stdout: "index.js", stderr: "" },
      { command: ["./index"], stdout: "index.js", stderr: "" },

      { command: ["."], stdout: "main.js", stderr: "" },
      { command: ["./"], stdout: "main.js", stderr: "" },

      { command: ["typescript.ts"], stdout: "typescript.ts", stderr: "" },
      { command: ["./typescript.ts"], stdout: "typescript.ts", stderr: "" },
      { command: ["typescript.js"], stdout: "typescript.ts", stderr: "" },
      { command: ["./typescript.js"], stdout: "typescript.ts", stderr: "" },
      { command: ["typescript"], stdout: "typescript.ts", stderr: "" },
      { command: ["./typescript"], stdout: "typescript.ts", stderr: "" },

      { command: ["sample.js"], stdout: "scripts/sample.js", stderr: "$ echo scripts/sample.js", req_run: true },
      { command: ["sample.js"], stdout: "sample.js", stderr: "", req_run: false },
      { command: ["./sample.js"], stdout: "sample.js", stderr: "" },
      { command: ["sample"], stdout: "sample.js", stderr: "" },
      { command: ["./sample"], stdout: "sample.js", stderr: "" },

      { command: ["test.todo"], stdout: "scripts/test.todo", stderr: "$ echo scripts/test.todo" },

      { command: ["§'.js"], stdout: "scripts/§'.js", stderr: '$ echo "scripts/§\'.js"', req_run: true },
      { command: ["§'.js"], stdout: "§'.js", stderr: "", req_run: false },
      { command: ["./§'.js"], stdout: "§'.js", stderr: "" },
      { command: ["§'"], stdout: "§'.js", stderr: "" },
      { command: ["./§'"], stdout: "§'.js", stderr: "" },

      { command: ["noext"], stdout: "noext", stderr: "" },
      { command: ["./noext"], stdout: "noext", stderr: "" },

      { command: ["folderandfile"], stdout: "folderandfile.js", stderr: "" },
      { command: ["./folderandfile"], stdout: "folderandfile.js", stderr: "" },
      { command: ["folderandfile.js"], stdout: "folderandfile.js", stderr: "" },
      { command: ["./folderandfile.js"], stdout: "folderandfile.js", stderr: "" },
      ...(isWindows
        ? [] // on windows these ones run "folderandfile.js" but the absolute path ones run "folderandfile/index.js"
        : [
            { command: ["folderandfile/"], stdout: "folderandfile/index.js", stderr: "" },
            { command: ["./folderandfile/"], stdout: "folderandfile/index.js", stderr: "" },
          ]),
      { command: ["folderandfile/index"], stdout: "folderandfile/index.js", stderr: "" },
      { command: ["./folderandfile/index"], stdout: "folderandfile/index.js", stderr: "" },
      { command: ["folderandfile/index.js"], stdout: "folderandfile/index.js", stderr: "" },
      { command: ["./folderandfile/index.js"], stdout: "folderandfile/index.js", stderr: "" },
      { command: [dir + "/folderandfile"], stdout: "folderandfile.js", stderr: "" },
      { command: [dir + "/folderandfile/"], stdout: "folderandfile/index.js", stderr: "" },

      { command: ["shellscript.sh"], stdout: "shellscript.sh", stderr: "" },
      { command: ["./shellscript.sh"], stdout: "shellscript.sh", stderr: "" },

      { command: [".secretscript.js"], stdout: ".secretscript.js", stderr: "" },
      { command: ["./.secretscript"], stdout: ".secretscript.js", stderr: "" },
      { command: [dir + "/.secretscript"], stdout: ".secretscript.js", stderr: "" },

      {
        command: ["no_run_json"],
        stdout: "",
        stderr: /error: Cannot run ".*no_run_json\.json"|EACCES/,
        exitCode: 1,
      },
      {
        command: ["no_run_json.json"],
        stdout: "",
        stderr: /error: Cannot run ".*no_run_json\.json"|EACCES/,
        exitCode: 1,
      },
      {
        command: ["./no_run_json"],
        stdout: "",
        stderr: /error: Cannot run ".*no_run_json\.json"|EACCES/,
        exitCode: 1,
      },

      {
        command: ["/absolute"],
        stdout: "",
        stderr: /error: Module not found "(\/|\\|\\\\)absolute"|EACCES/,
        exitCode: 1,
      },
      {
        command: ["./relative"],
        stdout: "",
        stderr: /error: Module not found ".(\/|\\|\\\\)relative"|EACCES/,
        exitCode: 1,
      },

      ...(isWindows
        ? [
            // TODO: node_modules command
            // TODO: system command
          ]
        : [
            // node_modules command
            { command: ["confabulate"], stdout: "node_modules/.bin/confabulate", stderr: "" },
            { command: ["nx"], stdout: "node_modules/.bin/nx", stderr: "" },

            // system command
            { command: ["echo", "abc"], stdout: "abc", stderr: "", req_run: true },
            { command: ["echo", "abc"], stdout: "", exitCode: 1, req_run: false },
          ]),

      // TODO: test preloads (https://bun.sh/docs/runtime/bunfig#preload), test $npm_lifecycle_event
      // TODO: test with path overrides in tsconfig.json
    ];
    if (isWindows) {
      for (const cmd of [...commands]) {
        if (cmd.command[0].includes("/")) {
          commands.push({
            ...cmd,
            command: [cmd.command[0].replaceAll("/", "\\"), ...cmd.command.slice(1)],
          });
        }
      }
    }

    for (const cmd of commands) {
      for (const flag of [[], ["--bun"]]) {
        for (const postflag of cmd.req_run === true ? [["run"]] : cmd.req_run === false ? [[]] : [[], ["run"]]) {
          const full_command = [...flag, ...postflag, ...cmd.command];
          it("bun " + full_command.join(" "), async () => {
            await using proc = Bun.spawn({
              cmd: [bunExe(), ...full_command],
              cwd: dir,
              env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
              stdout: "pipe",
              stderr: "pipe",
            });

            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

            if (cmd.stderr != null && typeof cmd.stderr !== "string") expect(stderr).toMatch(cmd.stderr);
            expect({
              ...(cmd.stderr != null && typeof cmd.stderr === "string" ? { stderr: stderr.trim() } : {}),
              stdout: stdout.trim(),
              exitCode,
            }).toStrictEqual({
              ...(cmd.stderr != null && typeof cmd.stderr === "string" ? { stderr: cmd.stderr } : {}),
              stdout: cmd.stdout,
              exitCode: cmd.exitCode ?? 0,
            });
          });
        }
      }
    }
  });

  it("should run from stdin", async () => {
    const res = await $`echo "console.log('hello')" | bun run -`.text();
    expect(res).toBe(`hello\n`);
  });

  describe.todo("run from stdin", async () => {
    // TODO: write this test
    // note limit of around 1gb when running from stdin
    // - which says 'catch return false'
  });

  describe("should run scripts from the project root (#16169)", async () => {
    const dir = tempDirWithFiles("test", {
      "run_here": {
        "myscript.ts": "console.log('successful run')",
        "package.json": JSON.stringify({
          scripts: { "sample": "pwd", "runscript": "bun myscript.ts" },
        }),
        "dont_run_in_here": {
          "runme.ts": "console.log('do run this script')",
        },
      },
    });

    it("outside", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "sample"],
        cwd: dir + "/run_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("run_here");
      expect(stdout).not.toContain("dont_run_in_here");
      expect(exitCode).toBe(0);
    });

    it("inside", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "sample"],
        cwd: dir + "/run_here/dont_run_in_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("run_here");
      expect(stdout).not.toContain("dont_run_in_here");
      expect(exitCode).toBe(0);
    });

    it("inside --shell=bun", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--shell=bun", "run", "sample"],
        cwd: dir + "/run_here/dont_run_in_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("run_here");
      expect(stdout).not.toContain("dont_run_in_here");
      expect(exitCode).toBe(0);
    });

    it("inside script", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "runme.ts"],
        cwd: dir + "/run_here/dont_run_in_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toContain("do run this script");
      expect(exitCode).toBe(0);
    });

    it("inside wrong script", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "myscript.ts"],
        cwd: dir + "/run_here/dont_run_in_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      if (stderr.includes("myscript.ts") && stderr.includes("EACCES")) {
        // for some reason on musl, the run_here folder is in $PATH
        // 'error: Failed to run "myscript.ts" due to:\nEACCES: run_here/myscript.ts: Permission denied (posix_spawn())'
      } else {
        expect(stderr).toBe('error: Module not found "myscript.ts"\n');
      }
      expect(exitCode).toBe(1);
    });

    it("outside 2", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "runscript"],
        cwd: dir + "/run_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toBe("successful run\n");
      expect(exitCode).toBe(0);
    });

    it("inside 2", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "runscript"],
        cwd: dir + "/run_here/dont_run_in_here",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toBe("successful run\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("run main within monorepo", async () => {
    const dir = tempDirWithFiles("test", {
      "package.json": JSON.stringify({
        name: "monorepo_root",
        main: "monorepo_root.ts",
        workspaces: ["packages/*"],
      }),
      "monorepo_root.ts": "console.log('monorepo_root')",
      "packages": {
        "package_a": {
          "package.json": JSON.stringify({ name: "package_a", main: "package_a.ts" }),
          "package_a.ts": "console.log('package_a')",
        },
        "package_b": {
          "package.json": JSON.stringify({ name: "package_b" }),
        },
      },
    });

    it("should run main from monorepo root", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "."],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toBe("monorepo_root\n");
      expect(exitCode).toBe(0);
    });

    it("should run package_a from package_a", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "."],
        cwd: dir + "/packages/package_a",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout).toBe("package_a\n");
      expect(exitCode).toBe(0);
    });

    it("should fail from package_b", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "."],
        cwd: dir + "/packages/package_b",
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
    });
  });

  // BUN-3MAQ: guards the user-visible contract that a >32,767-u16 environment
  // block reaches a .bunx child intact. CreateProcessW with
  // CREATE_UNICODE_ENVIRONMENT has no documented block-size limit. This does
  // not assert which spawn path (fast .bunx shim vs. libuv fallback) was
  // taken, since both are correct; it fails only if the child loses env data
  // or the process crashes. POSIX hits E2BIG first, so Windows-only.
  it.if(isWindows)(
    "runs a node_modules/.bin entry with an environment block larger than 32,767 wide chars",
    async () => {
      using dir = tempDir("bun-run-large-env", {
        "package.json": JSON.stringify({
          name: "consumer",
          version: "0.0.0",
          dependencies: { "print-env-len": "file:./print-env-len" },
        }),
        "print-env-len": {
          "package.json": JSON.stringify({
            name: "print-env-len",
            version: "0.0.0",
            bin: { "print-env-len": "./bin.js" },
          }),
          "bin.js": `#!/usr/bin/env node\nprocess.stdout.write(String((process.env.HUGE_A || "").length + (process.env.HUGE_B || "").length));\n`,
        },
      });

      {
        await using install = Bun.spawn({
          cmd: [bunExe(), "install"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          install.stdout.text(),
          install.stderr.text(),
          install.exited,
        ]);
        expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
      }

      expect(await Bun.file(join(String(dir), "node_modules", ".bin", "print-env-len.bunx")).exists()).toBe(true);

      // Two 25,000-char values plus the rest of bunEnv push the serialized
      // block past 32,767 u16s without approaching any per-variable or
      // per-block ceiling Windows actually enforces.
      const chunk = Buffer.alloc(25_000, "a").toString();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "print-env-len"],
        cwd: String(dir),
        env: { ...bunEnv, HUGE_A: chunk, HUGE_B: chunk },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("error");
      expect(stdout).toBe(String(chunk.length * 2));
      expect(exitCode).toBe(0);
    },
  );

  // https://github.com/oven-sh/bun/issues/30711 — nested `--bun` used to rewrite
  // the BUN_NODE_DIR/{bun,node} shim to point at ITSELF. After the OUTER `--bun`
  // prepends BUN_NODE_DIR to PATH, the INNER bun's argv[0] (PATH-resolved) is
  // `<BUN_NODE_DIR>/bun` — exactly the shim it was about to rewrite. The symlink
  // becomes self-referencing and `/usr/bin/env node` fails with ELOOP
  // ("Too many levels of symbolic links").
  it.skipIf(isWindows)("nested --bun does not create a self-referencing node/bun shim", async () => {
    // Reproduce the reporter's exact invocation: `bun run --bun bun run --bun <binScript>`
    // where:
    // - the literal "bun" must be resolved via PATH so the inner process's
    //   argv[0] ends up being the shim path (this is what feeds the self-loop
    //   into the symlink target)
    // - the final script must be a `node_modules/.bin/<name>` shim script
    //   that shebang's `/usr/bin/env node` — that's where ELOOP actually
    //   surfaces when the shim is broken
    using dir = tempDir("bun-run-nested-bun-shim", {
      "package.json": JSON.stringify({ name: "nested-bun-shim" }),
      "node_modules/fake-pkg/bin.js": "#!/usr/bin/env node\nconsole.log('nested --bun ok');\n",
    });

    const dirStr = String(dir);
    chmodSync(join(dirStr, "node_modules/fake-pkg/bin.js"), 0o755);

    // node_modules/.bin/fake-pkg → ../fake-pkg/bin.js
    const binDir = join(dirStr, "node_modules/.bin");
    await $`mkdir -p ${binDir} && ln -sf ../fake-pkg/bin.js ${binDir}/fake-pkg`.quiet();

    // Plant a `bun` symlink on PATH so the outer `--bun bun` resolves via
    // PATH-lookup (not as an absolute argv[0]).
    const pathBinDir = join(dirStr, "path-bin");
    await $`mkdir -p ${pathBinDir} && ln -sf ${bunExe()} ${pathBinDir}/bun`.quiet();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", "bun", "run", "--bun", "fake-pkg"],
      cwd: dirStr,
      env: { ...bunEnv, PATH: `${pathBinDir}:${bunEnv.PATH ?? process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Buggy versions emit "env: 'node': Too many levels of symbolic links"
    // and exit 126; the fixed version runs the script cleanly.
    expect({ stderr, stdout, exitCode }).toEqual({
      stderr: expect.not.stringContaining("Too many levels of symbolic links"),
      stdout: expect.stringContaining("nested --bun ok"),
      exitCode: 0,
    });
  });

  it.if(isWindows)("--shell=system refuses a passthrough argument containing a cmd.exe special character", async () => {
    using dir = tempDir("bun-run-system-shell-metachar", {
      "package.json": JSON.stringify({ name: "system-shell-metachar", scripts: { say: "echo" } }),
    });

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--shell=system", "say", "hello"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("hello");
      expect(exitCode).toBe(0);
    }

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--shell=system", "say", 'x" & echo marker & "'],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(
        'error: Failed to run script say: argument "x\\" & echo marker & \\"" contains a cmd.exe special character and cannot be passed to the system shell',
      );
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--shell=system", "say", "%PATH%"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(
        'error: Failed to run script say: argument "%PATH%" contains a cmd.exe special character and cannot be passed to the system shell',
      );
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    }
  });

  // The node/bun shims live in one directory shared by every bun process of
  // the same build (and, for debug builds, by all debug builds). A bun that is
  // starting up may add the links but must never remove ones that already
  // point at it: a script spawned by an earlier process can exec them at any
  // moment and would fail with `node: not found` or fall through to a real
  // node. (Debug builds used to wipe the whole directory on every start.)
  it("concurrent --bun runs do not remove the node shim other scripts are using", async () => {
    using dir = tempDir("bun-run-shim-race", {
      "package.json": JSON.stringify({
        name: "shim-race",
        scripts: {
          watch: "node watch.js",
          probe: "node probe.js",
        },
      }),
      // Runs as `node` through the shim, reports what `node` resolves to, then
      // keeps re-resolving it (what a script's PATH lookup does) until the test
      // writes `stop`. A busy loop on purpose: a process that removes and
      // recreates the shim leaves it missing for only a few syscalls, so sample
      // as fast as possible. Deliberately import-free: in debug builds, loading
      // node:fs alone takes most of a second. (`await using` below kills this
      // process if the test fails before writing `stop`.)
      "watch.js": `
        const shim = Bun.which("node");
        console.log(shim);
        while (Bun.file("stop").size === 0) {
          if (Bun.which("node") !== shim) {
            console.log("missing");
            process.exit(1);
          }
        }
        console.log("ok");
      `,
      "probe.js": `process.exit(typeof Bun === "object" ? 0 : 3);`,
    });
    const dirStr = String(dir);

    await using watcher = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", "watch"],
      cwd: dirStr,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const watcherLines = forEachLine(watcher.stdout);
    const { value: shim } = await watcherLines.next();
    expect(shim).toMatch(/[\\/]bun-node[^\\/]*[\\/]node(\.exe)?$/);

    // Every sibling sets up the shim directory on startup and then runs
    // `node` through it, all while the watcher's script is still using it.
    const siblings = await Promise.all(
      Array.from({ length: 4 }, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", "--bun", "probe"],
          cwd: dirStr,
          env: bunEnv,
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      }),
    );

    await Bun.write(join(dirStr, "stop"), "stop");
    const [stdout, stderr, exitCode] = await Promise.all([
      Array.fromAsync(watcherLines),
      watcher.stderr.text(),
      watcher.exited,
    ]);

    expect(siblings.filter(({ exitCode }) => exitCode !== 0)).toEqual([]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: ["ok"], stderr: "$ node watch.js\n", exitCode: 0 });
  });

  // https://github.com/oven-sh/bun/issues/44033
  // Without a node in PATH, scripts get a `node.exe` that is a hard link to bun. A hard link cannot
  // cross volumes, so with %TEMP% on another drive it goes beside bun.exe.
  it.if(isWindows)("scripts find node when %TEMP% is on another drive than bun.exe", async () => {
    using dir = tempDir("bun-run-node-shim", {
      "package.json": JSON.stringify({
        name: "shim",
        scripts: { v: `node -e "console.log(process.execPath)"` },
      }),
      "bin/.keep": "",
      // Takes the name of the directory.
      "blocked/bun-node": "not a directory",
    });
    // Uses its own copy of bun.exe, so that nothing is written next to the one being tested.
    const ownBun = (folder: string) => {
      const exe = join(String(dir), folder, "bun.exe");
      try {
        linkSync(bunExe(), exe);
      } catch {
        copyFileSync(bunExe(), exe);
      }
      return exe;
    };
    // No node anywhere: Windows env keys are case-insensitive, and an outer `bun run` exports NODE.
    const env = Object.fromEntries(
      Object.entries(bunEnv).filter(
        ([k]) => !["PATH", "NODE", "NPM_NODE_EXECPATH", "TEMP", "TMP"].includes(k.toUpperCase()),
      ),
    );
    env.PATH = (process.env.PATH ?? "")
      .split(";")
      .filter(p => p && !existsSync(join(p, "node.exe")) && !existsSync(join(p, "node.cmd")))
      .join(";");
    // The drive need not exist: nothing is created there.
    env.TEMP = env.TMP = `${String(dir)[0].toUpperCase() === "Q" ? "R" : "Q"}:\\Temp`;
    const run = async (...cmd: string[]) => {
      await using proc = Bun.spawn({ cmd, cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim().toLowerCase(), stderr, exitCode };
    };

    const bun = ownBun("bin");
    for (const flag of [[], ["--bun"]]) {
      expect(await run(bun, ...flag, "run", "v")).toEqual({
        stdout: join(String(dir), "bin", "bun-node", "node.exe").toLowerCase(),
        stderr: '$ node -e "console.log(process.execPath)"\n',
        exitCode: 0,
      });
    }

    const blocked = await run(ownBun("blocked"), "run", "v");
    expect(blocked.stderr).toContain("warn: failed to create node alias in ");
    expect(blocked.stderr).toContain("command not found: node");
    expect(blocked).toMatchObject({ stdout: "", exitCode: 1 });
  });

  // Windows runs a .cmd or .bat file through cmd.exe, which reads the arguments a second time: it
  // replaces `%NAME%` with the value of the environment variable, even inside quotes.
  it.if(isWindows)("the node_modules/.bin launcher of a batch file refuses cmd.exe special characters", async () => {
    const printFirstArgument = "@echo off\r\necho arg=%1\r\n";
    using dir = tempDir("bun-run-bin-launcher-metachar", {
      "package.json": JSON.stringify({
        name: "consumer",
        version: "0.0.0",
        dependencies: { "cmd-tool-pkg": "file:./cmd-tool-pkg" },
      }),
      "cmd-tool-pkg": {
        "package.json": JSON.stringify({
          name: "cmd-tool-pkg",
          version: "0.0.0",
          bin: {
            "cmd-tool": "./tool.cmd",
            "bat-tool": "./tool.bat",
            "upper-tool": "./upper.CMD",
            "mixed-tool": "./mixed.Bat",
          },
        }),
        "tool.cmd": printFirstArgument,
        "tool.bat": printFirstArgument,
        "upper.CMD": printFirstArgument,
        "mixed.Bat": printFirstArgument,
      },
    });
    const run = async (...cmd: string[]) => {
      await using proc = Bun.spawn({
        cmd,
        cwd: String(dir),
        env: { ...bunEnv, CMD_METACHAR_PROBE: "read-by-cmd" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const launcher = (name: string) => join(String(dir), "node_modules", ".bin", `${name}.exe`);
    const refused = {
      stdout: "",
      stderr: expect.stringContaining("error: cannot pass an argument containing % & | < > ^ to a .cmd or .bat file"),
      exitCode: 255,
    };

    expect(await run(bunExe(), "install")).toMatchObject({ exitCode: 0 });

    expect(await run(launcher("cmd-tool"), "hello")).toEqual({ stdout: "arg=hello\r\n", stderr: "", exitCode: 0 });
    for (const arg of ["%CMD_METACHAR_PROBE%", "a&b", "a|b", "a<b", "a>b", "a^b", 'x" & echo marker & "']) {
      expect({ arg, ...(await run(launcher("cmd-tool"), arg)) }).toEqual({ arg, ...refused });
    }
    expect(await run(launcher("bat-tool"), "%CMD_METACHAR_PROBE%")).toEqual(refused);
    // Windows takes any spelling of the extension for a batch file.
    for (const name of ["upper-tool", "mixed-tool"]) {
      expect(await run(launcher(name), "hello")).toEqual({ stdout: "arg=hello\r\n", stderr: "", exitCode: 0 });
      expect({ name, ...(await run(launcher(name), "%CMD_METACHAR_PROBE%")) }).toEqual({ name, ...refused });
    }
    // The same launcher runs inside bun.exe.
    expect(await run(bunExe(), "run", "cmd-tool", "%CMD_METACHAR_PROBE%")).toEqual(refused);
  });

  // https://github.com/oven-sh/bun/issues/7504: `/tmp/bun-node-<sha>` was one directory for
  // all users. The first user to run `--bun` owned it (mode 0700), and every other user's
  // `--bun` silently got the real `node`.
  it.skipIf(isWindows)("--bun creates a per-user node shim directory", async () => {
    using dir = tempDir("bun-run-node-shim-uid", {
      "package.json": JSON.stringify({
        name: "shim-uid",
        scripts: {
          go: `node -e 'console.log(process.env.PATH.split(":").find(e => /bun-node/.test(e))); console.log(typeof Bun);'`,
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", "go"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const [shimDir, bunType] = stdout.trim().split("\n");

    expect(stderr).not.toContain("error");
    expect({ shimDir, bunType, exitCode }).toEqual({
      shimDir: expect.stringMatching(new RegExp(`/bun-node-${process.getuid!()}(-|$)`)),
      bunType: "object",
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/44761
  // On POSIX, a bin link whose target was deleted is a dangling symlink, and a PATH search skips it. On Windows the
  // link is two files: the launcher `<name>.exe`, and `<name>.bunx`, which has the target's path. The launcher is still
  // there after the target is deleted. It prints "bin executable does not exist on disk" and exits with 255.
  describe("a bin link for bun, bunx or node whose target is gone", () => {
    const exe = isWindows ? ".exe" : "";
    // A script that prints the path of the program that `word` ran. See `program`.
    const printPath = (word: string) => `${word} -e "console.log(process.execPath)"`;
    const echoed = (word: string) => `$ ${printPath(word)}\n`;
    type Bins = Record<string, string>;
    const bins = (...names: string[]): Bins => Object.fromEntries(names.map(name => [name, `bin/${name}${exe}`]));

    // `outer` depends on a package that has the bins in `bin`, and `outer/project` has `scripts`.
    const files = (bin: Bins, scripts: Record<string, string>) => ({
      "tools/.keep": "",
      outer: {
        "package.json": JSON.stringify({
          name: "outer",
          version: "0.0.0",
          dependencies: { "runtime-pkg": "file:./runtime-pkg" },
        }),
        "runtime-pkg": {
          "package.json": JSON.stringify({ name: "runtime-pkg", version: "0.0.0", bin }),
          "bin/.keep": "",
        },
        "project/package.json": JSON.stringify({ name: "project", scripts }),
      },
    });

    // Creates a program that prints its own path. A launcher can only start a native executable, so on Windows the
    // program is a copy of bun.
    function program(to: string) {
      if (!isWindows) {
        writeFileSync(to, '#!/bin/sh\necho "$0"\n');
        return chmodSync(to, 0o755);
      }
      try {
        linkSync(bunExe(), to);
      } catch {
        copyFileSync(bunExe(), to);
      }
    }
    // Returns what the program at `file` prints, in the form that `run` returns it.
    const ran = (file: string) => realpathSync.native(file).toLowerCase();

    function prepare(root: string, bin: Bins, shell = "bun") {
      const tools = join(root, "tools");
      const outer = join(root, "outer");
      // `tools` has the bun, bunx and node that are in PATH. It needs a node, because without one in PATH, `bun run`
      // puts its own `bun` and `node` in front of every `node_modules/.bin`.
      for (const name of ["bun", "bunx", "node"]) program(join(tools, name + exe));
      for (const target of Object.values(bin)) program(join(outer, "runtime-pkg", target));
      // Environment variable names are case-insensitive on Windows, and an outer `bun run` sets NODE.
      const env = Object.fromEntries(
        Object.entries(bunEnv).filter(([k]) => !["PATH", "NODE", "NPM_NODE_EXECPATH"].includes(k.toUpperCase())),
      );
      env.PATH = tools + delimiter + (process.env.PATH ?? "");
      const run = async (cwd: string, ...cmd: string[]) => {
        await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const text = stdout.trim();
        return { stdout: existsSync(text) ? ran(text) : text.toLowerCase(), stderr, exitCode };
      };
      const script = (cwd: string, name: string) => run(cwd, bunExe(), "run", `--shell=${shell}`, name);
      const binDir = (dir: string) => join(dir, "node_modules", ".bin");
      const install = async (cwd: string, linker = "hoisted") => {
        expect(await run(cwd, bunExe(), "install", `--linker=${linker}`)).toMatchObject({ exitCode: 0 });
        for (const name of Object.keys(bin)) {
          if (isWindows) expect(existsSync(join(binDir(cwd), `${name}.bunx`))).toBe(true);
          else expect(lstatSync(join(binDir(cwd), name)).isSymbolicLink()).toBe(true);
        }
      };
      // Returns the file that the bin link `name` in `dir` points to.
      const targetOf = (dir: string, name: string) => {
        if (!isWindows) return realpathSync(join(binDir(dir), name));
        const link = readFileSync(join(binDir(dir), `${name}.bunx`)).toString("utf16le");
        return join(dir, "node_modules", link.slice(0, link.indexOf('"')));
      };
      // Moves the target away and keeps the package folder, like an install script that moves the file. Returns a
      // function that moves it back.
      const removeTarget = (dir: string, name: string) => {
        const target = targetOf(dir, name);
        renameSync(target, target + ".moved");
        return () => renameSync(target + ".moved", target);
      };
      return { tools, outer, run, script, install, binDir, targetOf, removeTarget };
    }

    // On POSIX this already passes, with the Bun shell and with the system shell. It's the behavior that Windows
    // should match. The tests after it are about the Windows launcher.
    const cases = [["bun", "hoisted"], isWindows ? ["bun", "isolated"] : ["system", "hoisted"]];
    it.each(cases)(
      "a script that starts with bun runs the next bun in PATH (--shell=%s, %s linker)",
      async (shell, linker) => {
        using dir = tempDir("bun-run-dead-bin-link", files(bins("bun"), { path: printPath("bun") }));
        const { tools, outer, script, install, targetOf, removeTarget } = prepare(String(dir), bins("bun"), shell);
        const project = join(outer, "project");
        await install(outer, linker);
        const linked = ran(targetOf(outer, "bun"));

        const restore = removeTarget(outer, "bun");
        expect(await script(project, "path")).toEqual({
          stdout: ran(join(tools, "bun" + exe)),
          stderr: echoed("bun"),
          exitCode: 0,
        });
        // Once the target is back, the link is used again without another install.
        restore();
        expect(await script(project, "path")).toEqual({ stdout: linked, stderr: echoed("bun"), exitCode: 0 });
      },
    );

    describe.if(isWindows)("the Windows launcher and its .bunx file", () => {
      // The state in #44761: the `bun` and `bunx` links of a package that's gone, in a `.bin` above the project.
      it("runs the next bun and bunx in PATH when the package's folder is gone", async () => {
        const scripts = { path: printPath("bun"), bunx: "bunx --version" };
        using dir = tempDir("bun-run-dead-bin-link-folder", files(bins("bun", "bunx"), scripts));
        const { tools, outer, script, install } = prepare(String(dir), bins("bun", "bunx"));
        const project = join(outer, "project");
        await install(outer);

        // `bun remove` left this state behind before #44968.
        rmSync(join(outer, "node_modules", "runtime-pkg"), { recursive: true, force: true });
        expect(await script(project, "path")).toEqual({
          stdout: ran(join(tools, "bun" + exe)),
          stderr: echoed("bun"),
          exitCode: 0,
        });
        expect(await script(project, "bunx")).toEqual({
          stdout: expect.stringMatching(/^\d+\.\d+\.\d+/),
          stderr: "$ bunx --version\n",
          exitCode: 0,
        });
      });

      it("keeps searching and uses a bin link farther up whose target exists", async () => {
        using dir = tempDir("bun-run-dead-bin-link-nearer", {
          ...files(bins("bun"), {}),
          "outer/mid/package.json": JSON.stringify({
            name: "mid",
            version: "0.0.0",
            dependencies: { "runtime-pkg": "file:../runtime-pkg" },
          }),
          "outer/mid/project/package.json": JSON.stringify({ name: "project", scripts: { path: printPath("bun") } }),
        });
        const { outer, script, install, targetOf, removeTarget } = prepare(String(dir), bins("bun"));
        const mid = join(outer, "mid");
        await install(outer);
        await install(mid);

        removeTarget(mid, "bun");
        expect(await script(join(mid, "project"), "path")).toEqual({
          stdout: ran(targetOf(outer, "bun")),
          stderr: echoed("bun"),
          exitCode: 0,
        });
      });

      it("a script that starts with node or bunx runs the next one in PATH", async () => {
        const scripts = {
          node: printPath("node"),
          spelled: printPath("Node.EXE"),
          // `bunx` has no option that prints its own path.
          bunx: "bunx --version",
          postinstall: `node -e "require('fs').writeFileSync('postinstall.txt', process.execPath)"`,
        };
        using dir = tempDir("bun-run-dead-bin-link-node", files(bins("node", "bunx"), scripts));
        const { tools, outer, run, script, install, removeTarget } = prepare(String(dir), bins("node", "bunx"));
        const project = join(outer, "project");
        await install(outer);

        removeTarget(outer, "node");
        removeTarget(outer, "bunx");
        const inTools = ran(join(tools, "node.exe"));
        expect(await script(project, "node")).toEqual({ stdout: inTools, stderr: echoed("node"), exitCode: 0 });
        expect(await script(project, "spelled")).toEqual({ stdout: inTools, stderr: echoed("Node.EXE"), exitCode: 0 });
        expect(await script(project, "bunx")).toEqual({
          stdout: expect.stringMatching(/^\d+\.\d+\.\d+/),
          stderr: "$ bunx --version\n",
          exitCode: 0,
        });
        // Lifecycle scripts are run by the same shell.
        expect(await run(project, bunExe(), "install")).toMatchObject({ exitCode: 0 });
        expect(ran(readFileSync(join(project, "postinstall.txt"), "utf8"))).toBe(inTools);
      });

      it("`bun.exe`, `BUN`, `which bun` and `npm run` all resolve to the same bun", async () => {
        const scripts: Record<string, string> = {
          path: printPath("bun"),
          spelled: printPath("bun.exe"),
          upper: printPath("BUN"),
          which: "which bun",
          npm: "npm run path",
        };
        using dir = tempDir("bun-run-dead-bin-link-words", files(bins("bun"), scripts));
        const { tools, outer, script, install, binDir, removeTarget } = prepare(String(dir), bins("bun"));
        const project = join(outer, "project");
        await install(outer);

        removeTarget(outer, "bun");
        // npm writes a `bun.cmd` for the same link. The second file is a stale `.bunx` next to a real program.
        writeFileSync(join(binDir(outer), "bun.cmd"), "@echo off\r\necho bun.cmd\r\n");
        copyFileSync(join(binDir(outer), "bun.bunx"), join(tools, "bun.bunx"));

        const inTools = ran(join(tools, "bun.exe"));
        for (const name of ["path", "spelled", "upper", "which"]) {
          expect({ name, ...(await script(project, name)) }).toEqual({
            name,
            stdout: inTools,
            stderr: `$ ${scripts[name]}\n`,
            exitCode: 0,
          });
        }
        // `npm run` in a script runs as `bun run`.
        expect(await script(project, "npm")).toEqual({
          stdout: inTools,
          stderr: expect.stringContaining(` run path\n$ ${scripts.path}\n`),
          exitCode: 0,
        });
      });

      it("a command that isn't bun, bunx or node still gets its launcher's error", async () => {
        using dir = tempDir("bun-run-dead-bin-link-other-word", files(bins("mytool"), { path: printPath("mytool") }));
        const { outer, script, install, removeTarget } = prepare(String(dir), bins("mytool"));
        const project = join(outer, "project");
        await install(outer);
        const dead = {
          stdout: "",
          stderr: expect.stringContaining("error: bin executable does not exist on disk"),
          exitCode: 255,
        };

        removeTarget(outer, "mytool");
        expect(await script(project, "path")).toEqual(dead);
        rmSync(join(outer, "node_modules", "runtime-pkg"), { recursive: true, force: true });
        expect(await script(project, "path")).toEqual(dead);
      });

      it("uses a bin link whose target exists", async () => {
        using dir = tempDir("bun-run-live-bin-link", files(bins("bun"), { path: printPath("bun") }));
        const { outer, script, install, binDir, targetOf } = prepare(String(dir), bins("bun"));
        const project = join(outer, "project");
        await install(outer);
        const linked = { stdout: ran(targetOf(outer, "bun")), stderr: echoed("bun"), exitCode: 0 };
        expect(await script(project, "path")).toEqual(linked);

        // A target outside the link's `node_modules` is written with `..`, which Windows resolves.
        const bunx = join(binDir(outer), "bun.bunx");
        const link = readFileSync(bunx).toString("utf16le");
        expect(link).toStartWith('runtime-pkg\\bin\\bun.exe"');
        writeFileSync(bunx, Buffer.from(link.replace("\\bin\\", "\\bin\\..\\bin\\"), "utf16le"));
        expect(await script(project, "path")).toEqual(linked);
      });

      it("uses a real program that replaced the launcher", async () => {
        using dir = tempDir("bun-run-bin-link-real-program", files(bins("bun"), { path: printPath("bun") }));
        const { outer, script, install, binDir, removeTarget } = prepare(String(dir), bins("bun"));
        await install(outer);

        // The `.bunx` next to it still has a target that's gone, but `bun.exe` is no longer a launcher.
        removeTarget(outer, "bun");
        const replaced = join(binDir(outer), "bun.exe");
        rmSync(replaced);
        program(replaced);
        expect(await script(join(outer, "project"), "path")).toEqual({
          stdout: ran(replaced),
          stderr: echoed("bun"),
          exitCode: 0,
        });
      });

      it("only skips a link that the launcher can't start", async () => {
        using dir = tempDir("bun-run-bin-link-metadata", files(bins("bun"), { path: printPath("bun") }));
        const { tools, outer, script, install, binDir, targetOf } = prepare(String(dir), bins("bun"));
        const project = join(outer, "project");
        await install(outer);
        const bunx = join(binDir(outer), "bun.bunx");
        const written = readFileSync(bunx);
        const flags = written.readUInt16LE(written.length - 2);
        const relative = written.toString("utf16le").split('"')[0];
        const target = targetOf(outer, "bun");
        const linked = ran(target);
        // A link without a shebang is the path, `"`, a NUL, and then the flags.
        const write = (binPath: string, flags: number) => {
          const tail = Buffer.alloc(2);
          tail.writeUInt16LE(flags);
          writeFileSync(bunx, Buffer.concat([Buffer.from(`${binPath}"\0`, "utf16le"), tail]));
        };
        const results: Record<string, unknown> = {};

        // Bit 3 means that the path is absolute, like for a package on another drive.
        write(target, flags | 0b1000);
        results.absolute = await script(project, "path");
        renameSync(target, target + ".moved");
        results.absoluteGone = await script(project, "path");
        write(relative, flags);
        results.relativeGone = await script(project, "path");
        // Bit 2 means that there's a shebang. The launcher starts an interpreter and never opens the target.
        write(relative, flags | 0b100);
        results.shebang = await script(project, "path");
        // The bits above bit 3 are the format's version.
        write(relative, flags ^ 0b10000);
        results.otherVersion = await script(project, "path");

        const skipped = { stdout: ran(join(tools, "bun.exe")), stderr: echoed("bun"), exitCode: 0 };
        const started = {
          stdout: "",
          stderr: expect.stringContaining("error: bin metadata is corrupt"),
          exitCode: 255,
        };
        expect(results).toEqual({
          absolute: { stdout: linked, stderr: echoed("bun"), exitCode: 0 },
          absoluteGone: skipped,
          relativeGone: skipped,
          shebang: started,
          otherVersion: started,
        });
      });

      // The npm package `node` has the bin `bin/node`, which is a text file on Windows, next to `bin/node.exe`.
      it("a target without an extension exists if the same name with .exe exists", async () => {
        using dir = tempDir("bun-run-bin-link-no-extension", files({ node: "bin/node" }, { path: printPath("node") }));
        const { tools, outer, script, install, binDir } = prepare(String(dir), {});
        const project = join(outer, "project");
        writeFileSync(join(outer, "runtime-pkg", "bin", "node"), "This file intentionally left blank\n");
        program(join(outer, "runtime-pkg", "bin", "node.exe"));
        await install(outer);
        expect(readFileSync(join(binDir(outer), "node.bunx")).toString("utf16le")).toStartWith(
          'runtime-pkg\\bin\\node"',
        );
        const bin = join(outer, "node_modules", "runtime-pkg", "bin");
        const nodeExe = ran(join(bin, "node.exe"));
        const results: Record<string, unknown> = {};

        results.both = await script(project, "path");
        renameSync(join(bin, "node"), join(bin, "node.moved"));
        results.onlyExe = await script(project, "path");
        renameSync(join(bin, "node.exe"), join(bin, "node.exe.moved"));
        results.neither = await script(project, "path");

        expect(results).toEqual({
          // The launcher tries to start the text file.
          both: { stdout: "", stderr: expect.stringContaining("error: could not create process"), exitCode: 255 },
          onlyExe: { stdout: nodeExe, stderr: echoed("node"), exitCode: 0 },
          neither: { stdout: ran(join(tools, "node.exe")), stderr: echoed("node"), exitCode: 0 },
        });
      });

      // This case still fails. A package bin's launcher searches for `node` itself, starting in its own folder, so the
      // shell's search isn't involved.
      it("a package bin with a node shebang still starts a node link whose target is gone", async () => {
        using dir = tempDir("bun-run-dead-bin-link-shebang", {
          ...files({ ...bins("node"), mytool: "bin/mytool.js" }, { path: "mytool" }),
          "outer/runtime-pkg/bin/mytool.js": "#!/usr/bin/env node\nconsole.log(process.execPath);\n",
        });
        const { outer, script, install, targetOf, removeTarget } = prepare(String(dir), bins("node"));
        const project = join(outer, "project");
        await install(outer);
        expect(await script(project, "path")).toEqual({
          stdout: ran(targetOf(outer, "node")),
          stderr: "$ mytool\n",
          exitCode: 0,
        });

        removeTarget(outer, "node");
        expect(await script(project, "path")).toEqual({
          stdout: "",
          stderr: expect.stringContaining("error: bin executable does not exist on disk"),
          exitCode: 255,
        });
      });
    });
  });
});
