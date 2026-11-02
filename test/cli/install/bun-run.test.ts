import { $ } from "bun";
import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import {
  bunEnv as bunEnv_,
  bunExe,
  forEachLine,
  isASAN,
  isDebug,
  isWindows,
  substDrive,
  tempDir,
  tempDirWithFiles,
} from "harness";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "path";

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
                cmd: [
                  bunExe(),
                  ...(withRun ? ["run"] : []),
                  ...(withLogLevel ? ["-c=" + join(String(dir), "bunfig.toml")] : []),
                  "./index.js",
                ],
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

  // The node/bun shims live in one directory shared by every bun process that
  // runs the same executable. A bun that is starting up may add the links but
  // must never remove ones that already point at it: a script spawned by an
  // earlier process can exec them at any moment and would fail with
  // `node: not found` or fall through to a real node. (Debug builds used to
  // wipe the whole directory on every start.)
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

  // `--bun` puts a directory with `node` and `bun` links to the executable first in PATH. The
  // directory was one for each build. A second executable of that build (a copy, a moved binary,
  // another debug build, a compiled executable that runs as bun) made the links point to itself
  // while the scripts of the first executable used them.
  describe("the directory of the node alias", () => {
    const exe = isWindows ? ".exe" : "";
    const files = {
      "package.json": JSON.stringify({ name: "alias", scripts: { alias: "node alias.js", wait: "node wait.mjs" } }),
      // What a script gets for the word `node`.
      "alias.js": `console.log(Bun.which("node"));`,
      // Prints its `node`, waits until stdin ends, and then starts that `node`.
      "wait.mjs": `
        console.log(Bun.which("node"));
        await Bun.stdin.text();
        const { stdout } = Bun.spawnSync({ cmd: ["node", "-p", "typeof Bun"] });
        console.log(JSON.stringify({ node: Bun.which("node"), typeofBun: stdout.toString().trim() }));
      `,
    };
    const run = async (cmd: string[], cwd: string, env: NodeJS.Dict<string> = bunEnv) => {
      await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    };
    // What a link is when it starts `executable`: a symlink names its path, a hard link (Windows)
    // is the file.
    const linkTo = (executable: string) => {
      if (!isWindows) return realpathSync(executable);
      const { dev, ino } = statSync(executable, { bigint: true });
      return `${dev}:${ino}`;
    };
    const linkOf = (alias: string) => {
      const stat = lstatSync(alias, { bigint: true, throwIfNoEntry: false });
      if (!stat) return undefined;
      if (isWindows) return `${stat.dev}:${stat.ino}`;
      return stat.isSymbolicLink() ? readlinkSync(alias) : undefined;
    };
    const startsExecutable = (alias: string, executable: string) => linkOf(alias) === linkTo(executable);
    const build = isDebug ? "debug-" : Bun.revision.slice(0, 9);
    // The name of the directory on POSIX, where the key is `Bun.hash` of the path that the links
    // point to. On Windows the key is of the image path, which has more than one spelling.
    const aliasDirName = (target: string) =>
      `bun-node-${process.getuid!()}-${build}${Bun.hash(target).toString(16).padStart(16, "0")}`;
    const windowsTempDirName = new RegExp(`^bun-node-${build}[0-9a-f]{16}$`);
    // Whether only `executable` uses the directory of its `alias`. If not, the next executable of
    // the build takes the links: a test stops before it starts one.
    const hasOwnDirectory = (alias: string, executable: string) => {
      const directory = basename(dirname(alias));
      if (!isWindows) return directory === aliasDirName(linkTo(executable));
      const beside = resolve(dirname(alias), "..").toLowerCase() === resolve(dirname(executable)).toLowerCase();
      return beside || windowsTempDirName.test(directory);
    };
    // `alias` is the output of a script: it can be any text, and also a `node` that is no alias.
    // This removes it only as the alias of an executable that the test made (`own`): two links
    // in the directory that has the name for that executable. It never removes a directory that
    // has content, and never the alias of the bun under test, which other tests use.
    const removeOwnAlias = (alias: string, own: string) => {
      const directory = basename(dirname(alias));
      if (!isAbsolute(alias) || !(isWindows ? windowsTempDirName.test(directory) : directory === aliasDirName(own))) {
        return;
      }
      if (linkOf(alias) !== own || own === linkTo(bunExe())) return;
      for (const name of ["node", "bun"]) rmSync(join(dirname(alias), name + exe), { force: true });
      rmdirSync(dirname(alias));
    };
    // The alias of `executable`. With `cleanup`, the executable is this test's own, and the test
    // removes the directory of its alias.
    const aliasOf = async (
      executable: string,
      cwd: string,
      env: NodeJS.Dict<string> = bunEnv,
      cleanup?: DisposableStack,
    ) => {
      // Now: the test can move the executable later.
      const own = linkTo(executable);
      const result = await run([executable, "run", "--bun", "alias"], cwd, env);
      cleanup?.defer(() => removeOwnAlias(result.stdout, own));
      expect(result).toEqual({
        stdout: expect.stringMatching(/[\\/]bun-node[^\\/]*[\\/]node(\.exe)?$/),
        stderr: "$ node alias.js\n",
        exitCode: 0,
      });
      if (!isWindows) expect(basename(dirname(result.stdout))).toBe(aliasDirName(own));
      return result.stdout;
    };
    // A second executable of the build under test. On Windows it has to be another file.
    const secondBun = (path: string) => {
      mkdirSync(dirname(path), { recursive: true });
      try {
        if (isWindows) throw new Error("a hard link is the same file");
        linkSync(bunExe(), path);
      } catch {
        copyFileSync(bunExe(), path);
      }
      return path;
    };
    // A script of the bun under test that is in progress: `alias()` is its `node`, and `finish()`
    // lets it start that `node` and end.
    const waitingScript = (cwd: string) => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "run", "--bun", "wait"],
        cwd,
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const lines = forEachLine(proc.stdout);
      return {
        alias: async () => (await lines.next()).value ?? "",
        finish: async () => {
          proc.stdin.end();
          const [rest, stderr, exitCode] = await Promise.all([Array.fromAsync(lines), proc.stderr.text(), proc.exited]);
          return { rest, stderr, exitCode };
        },
        [Symbol.asyncDispose]: () => proc[Symbol.asyncDispose](),
      };
    };
    const finished = (alias: string) => ({
      rest: [JSON.stringify({ node: alias, typeofBun: "object" })],
      stderr: "$ node wait.mjs\n",
      exitCode: 0,
    });

    it("a second executable of the same build gets its own directory", async () => {
      using dir = tempDir("bun-run-node-alias-second", files);
      using cleanup = new DisposableStack();
      await using waiting = waitingScript(String(dir));
      const alias = await waiting.alias();
      expect({ alias, ownDirectory: hasOwnDirectory(alias, bunExe()) }).toEqual({ alias, ownDirectory: true });

      // The script of the first executable still runs when the second one makes its links.
      const second = secondBun(join(String(dir), "second", "bun" + exe));
      const secondAlias = await aliasOf(second, String(dir), bunEnv, cleanup);
      expect({
        sameDirectory: dirname(secondAlias) === dirname(alias),
        first: startsExecutable(alias, bunExe()),
        second: startsExecutable(secondAlias, second),
      }).toEqual({ sameDirectory: false, first: true, second: true });

      // https://github.com/oven-sh/bun/issues/4690, https://github.com/oven-sh/bun/issues/27722:
      // the links of a moved executable are no use.
      const moved = join(String(dir), "moved", "bun" + exe);
      mkdirSync(dirname(moved));
      renameSync(second, moved);
      const [movedAlias, script] = await Promise.all([aliasOf(moved, String(dir), bunEnv, cleanup), waiting.finish()]);
      expect({ moved: startsExecutable(movedAlias, moved), script }).toEqual({
        moved: true,
        script: finished(alias),
      });
    });

    // https://github.com/oven-sh/bun/issues/30711: in a nested run, `argv[0]` is the `bun` link.
    it.skipIf(isWindows)("an executable has one directory, however it is started", async () => {
      using dir = tempDir("bun-run-node-alias-started", files);
      const link = join(String(dir), "link", "bun");
      mkdirSync(dirname(link));
      symlinkSync(bunExe(), link);

      const [alias, nested, symlink] = await Promise.all([
        aliasOf(bunExe(), String(dir)),
        run([bunExe(), "run", "--bun", "bun", "run", "--bun", "alias"], String(dir)),
        aliasOf(link, String(dir)),
      ]);
      expect({ nested, symlink }).toEqual({
        nested: { stdout: alias, stderr: "$ node alias.js\n", exitCode: 0 },
        symlink: alias,
      });
    });

    it.skipIf(isWindows)(
      "a link to another file in the directory stays, and PATH does not get the directory",
      async () => {
        using dir = tempDir("bun-run-node-alias-foreign", {
          ...files,
          "package.json": JSON.stringify({ name: "alias", scripts: { alias: "node alias.js", path: 'echo "$PATH"' } }),
          "not-bun": "",
        });
        using cleanup = new DisposableStack();

        const alias = await aliasOf(bunExe(), String(dir));
        const second = secondBun(join(String(dir), "second", "bun"));
        const secondAlias = await aliasOf(second, String(dir), bunEnv, cleanup);
        // Only a directory of this test's own executable is changed below.
        expect({
          sameDirectory: dirname(secondAlias) === dirname(alias),
          second: startsExecutable(secondAlias, second),
        }).toEqual({ sameDirectory: false, second: true });

        const foreign = join(String(dir), "not-bun");
        const bunLink = join(dirname(secondAlias), "bun");
        unlinkSync(bunLink);
        symlinkSync(foreign, bunLink);

        const { stdout, stderr, exitCode } = await run([second, "run", "--bun", "path"], String(dir));
        expect({
          link: readlinkSync(bunLink),
          inPath: stdout.split(delimiter).includes(dirname(secondAlias)),
          stderr,
          exitCode,
        }).toEqual({ link: foreign, inPath: false, stderr: '$ echo "$PATH"\n', exitCode: 0 });
      },
    );

    // `bun build --compile` output runs as bun while BUN_BE_BUN is set. A script of another bun does
    // not have that variable: through a `node` link to the app it starts the program of the app.
    // Not on a debug or ASAN build: the app is a copy of the executable, which is over 1 GB there.
    it.skipIf(isDebug || isASAN)("a compiled executable that runs as bun gets its own directory", async () => {
      using dir = tempDir("bun-run-node-alias-compiled", {
        ...files,
        "app.ts": `console.log("entry:" + process.argv[2]); process.exit(3);`,
      });
      using cleanup = new DisposableStack();
      await using waiting = waitingScript(String(dir));
      const alias = await waiting.alias();
      expect({ alias, ownDirectory: hasOwnDirectory(alias, bunExe()) }).toEqual({ alias, ownDirectory: true });

      const app = join(String(dir), "app" + exe);
      const built = await run([bunExe(), "build", "--compile", "app.ts", "--outfile", app], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const appAlias = await aliasOf(app, String(dir), { ...bunEnv, BUN_BE_BUN: "1" }, cleanup);

      expect({
        sameDirectory: dirname(appAlias) === dirname(alias),
        app: startsExecutable(appAlias, app),
        script: await waiting.finish(),
      }).toEqual({ sameDirectory: false, app: true, script: finished(alias) });
    });

    // The links are hard links, and the directory is under %TEMP% only when that is the drive of
    // the executable. A nested `bun run` runs as the `bun.exe` link, which has no path back to the
    // executable: it must find that it is in the directory already.
    describe.if(isWindows)("on Windows", () => {
      const nestedFiles = {
        ...files,
        "package.json": JSON.stringify({
          name: "alias",
          scripts: { alias: "node alias.js", nested: "bun run --bun alias" },
        }),
        "bin/.keep": "",
        "tmp/.keep": "",
      };
      // `bunEnv` with another temp directory. Windows env keys are case-insensitive.
      const envWithTemp = (temp: string) => ({
        ...Object.fromEntries(Object.entries(bunEnv).filter(([key]) => !["TEMP", "TMP"].includes(key.toUpperCase()))),
        TEMP: temp,
        TMP: temp,
      });
      // A drive that need not exist: nothing is created there.
      const otherDrive = (dir: string) => `${dir[0].toUpperCase() === "Q" ? "R" : "Q"}:\\Temp`;
      const nested = async (executable: string, cwd: string, env: NodeJS.Dict<string>) => {
        const result = await run([executable, "run", "--bun", "nested"], cwd, env);
        expect(result).toMatchObject({ stderr: "$ bun run --bun alias\n$ node alias.js\n", exitCode: 0 });
        return result.stdout.toLowerCase();
      };
      const lowerAliasOf = async (executable: string, cwd: string, env: NodeJS.Dict<string>) =>
        (await aliasOf(executable, cwd, env)).toLowerCase();
      // The key of the directory ignores the case of ASCII letters only.
      const upperCase = (path: string) => path.replace(/[a-z]/g, letter => letter.toUpperCase());

      it("beside the executable, each executable of a folder has its own directory", async () => {
        using dir = tempDir("bun-run-node-alias-beside", nestedFiles);
        const bin = join(String(dir), "bin");
        const bun = secondBun(join(bin, "bun.exe"));
        const other = secondBun(join(bin, "other.exe"));
        const env = envWithTemp(otherDrive(String(dir)));

        const alias = await aliasOf(bun, String(dir), env);
        const otherAlias = await aliasOf(other, String(dir), env);
        expect({
          alias: alias.toLowerCase(),
          otherDirectory: basename(dirname(otherAlias)),
          otherParent: dirname(dirname(otherAlias)).toLowerCase(),
          bun: startsExecutable(alias, bun),
          other: startsExecutable(otherAlias, other),
        }).toEqual({
          alias: join(bin, "bun-node", "node.exe").toLowerCase(),
          otherDirectory: expect.stringMatching(/^bun-node-[0-9a-f]{16}$/),
          otherParent: bin.toLowerCase(),
          bun: true,
          other: true,
        });

        // A nested run, and another spelling of the path, get the same directories.
        expect({
          nestedBun: await nested(bun, String(dir), env),
          nestedOther: await nested(other, String(dir), env),
          upperCaseOther: await lowerAliasOf(upperCase(other), String(dir), env),
        }).toEqual({
          nestedBun: alias.toLowerCase(),
          nestedOther: otherAlias.toLowerCase(),
          upperCaseOther: otherAlias.toLowerCase(),
        });
        expect({
          bin: readdirSync(bin).sort(),
          bun: readdirSync(dirname(alias)).sort(),
          other: readdirSync(dirname(otherAlias)).sort(),
        }).toEqual({
          bin: [".keep", "bun-node", basename(dirname(otherAlias)), "bun.exe", "other.exe"].sort(),
          bun: ["bun.exe", "node.exe"],
          other: ["bun.exe", "node.exe"],
        });
      });

      // `bunx.exe` is a hard link to `bun.exe`: one file that has two paths.
      it("under %TEMP%, each path of one file has its own directory", async () => {
        using dir = tempDir("bun-run-node-alias-temp", { ...nestedFiles, "bin2/.keep": "" });
        const temp = join(String(dir), "tmp");
        const bun = secondBun(join(String(dir), "bin", "bun.exe"));
        const other = join(String(dir), "bin2", "bun.exe");
        linkSync(bun, other);
        const env = envWithTemp(temp);

        const alias = await aliasOf(bun, String(dir), env);
        const otherAlias = await aliasOf(other, String(dir), env);
        expect({
          directory: basename(dirname(alias)),
          otherDirectory: basename(dirname(otherAlias)),
          sameDirectory: dirname(otherAlias) === dirname(alias),
          parents: [alias, otherAlias].map(link => dirname(dirname(link)).toLowerCase()),
          bun: startsExecutable(alias, bun),
          other: startsExecutable(otherAlias, other),
        }).toEqual({
          directory: expect.stringMatching(windowsTempDirName),
          otherDirectory: expect.stringMatching(windowsTempDirName),
          sameDirectory: false,
          parents: [temp.toLowerCase(), temp.toLowerCase()],
          bun: true,
          other: true,
        });

        // A nested run, and another spelling of the path, get the same directories.
        expect({
          nestedBun: await nested(bun, String(dir), env),
          nestedOther: await nested(other, String(dir), env),
          upperCaseBun: await lowerAliasOf(upperCase(bun), String(dir), env),
        }).toEqual({
          nestedBun: alias.toLowerCase(),
          nestedOther: otherAlias.toLowerCase(),
          upperCaseBun: alias.toLowerCase(),
        });
        expect({
          temp: readdirSync(temp).sort(),
          bun: readdirSync(dirname(alias)).sort(),
        }).toEqual({
          temp: [".keep", basename(dirname(alias)), basename(dirname(otherAlias))].sort(),
          bun: ["bun.exe", "node.exe"],
        });
      });

      // Only the two links make a folder the directory of the alias. Its name does not: a file of
      // the user in a folder with that name was replaced with a link to bun.
      it("a folder that has the name of the directory keeps its node.exe", async () => {
        using dir = tempDir("bun-run-node-alias-name", { ...files, "bun-node/node.exe": "not bun" });
        const folder = join(String(dir), "bun-node");
        const bun = secondBun(join(folder, "bun.exe"));

        const alias = await aliasOf(bun, String(dir), envWithTemp(otherDrive(String(dir))));
        expect({
          alias: alias.toLowerCase(),
          nodeSize: statSync(join(folder, "node.exe")).size,
        }).toEqual({ alias: join(folder, "bun-node", "node.exe").toLowerCase(), nodeSize: "not bun".length });
      });
    });
  });
});
