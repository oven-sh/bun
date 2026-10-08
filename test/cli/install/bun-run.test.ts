import { $ } from "bun";
import { describe, expect, it } from "bun:test";
import { chmodSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { bunEnv as bunEnv_, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { basename, join } from "path";

const bunEnv = {
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

  // `bun install` links a .cmd or .bat bin as `<name>.exe` plus `<name>.bunx`
  // in node_modules/.bin. The launcher runs the file through cmd.exe, which
  // has its own rule for the quotes of the line it receives.
  const printTwoArguments = "@echo off\r\necho arg1=%1 arg2=%2\r\n";
  const batchBinsProject = {
    "package.json": JSON.stringify({
      name: "consumer",
      version: "0.0.0",
      dependencies: { "batch-bins": "file:./batch-bins" },
    }),
    "batch-bins": {
      "package.json": JSON.stringify({
        name: "batch-bins",
        version: "0.0.0",
        bin: {
          "cmd-tool": "./tool.cmd",
          "bat-tool": "./tool.bat",
          "spaced-tool": "./sub dir/tool.cmd",
          "parens-tool": "./sub dir (x86)/tool.cmd",
        },
      }),
      "tool.cmd": printTwoArguments,
      "tool.bat": printTwoArguments,
      "sub dir": { "tool.cmd": printTwoArguments },
      "sub dir (x86)": { "tool.cmd": printTwoArguments },
    },
  };
  const batchBins = ["cmd-tool", "bat-tool", "spaced-tool", "parens-tool"];
  // The arguments of one run, and the line the batch file prints for them.
  const batchBinCases: [args: string[], printed: string][] = [
    [[], "arg1= arg2="],
    [["hello"], "arg1=hello arg2="],
    [["hello world"], 'arg1="hello world" arg2='],
    [["a b", "c d"], 'arg1="a b" arg2="c d"'],
    [[""], 'arg1="" arg2='],
  ];

  async function installBatchBins(cwd: string) {
    await using install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
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

  async function runAll(cwd: string, runs: { via: string; args: string[]; cmd: string[]; verbatim?: boolean }[]) {
    const results: { via: string; args: string[]; stdout: string; stderr: string; exitCode: number }[] = [];
    // Eight at a time keeps the number of live processes small.
    for (let i = 0; i < runs.length; i += 8) {
      results.push(
        ...(await Promise.all(
          runs.slice(i, i + 8).map(async ({ via, args, cmd, verbatim }) => {
            await using proc = Bun.spawn({
              cmd,
              cwd,
              env: bunEnv,
              stdout: "pipe",
              stderr: "pipe",
              windowsVerbatimArguments: verbatim,
            });
            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            return { via, args, stdout: stdout.trim(), stderr, exitCode };
          }),
        )),
      );
    }
    return results;
  }

  it.if(isWindows)(
    "the node_modules/.bin launcher passes an argument containing a space to a .cmd or .bat bin",
    async () => {
      using dir = tempDir("bun-run-batch-bins", batchBinsProject);
      await installBatchBins(String(dir));
      const binDir = join(String(dir), "node_modules", ".bin");

      // The launcher runs on its own as node_modules\.bin\<name>.exe, and
      // inside bun.exe for `bun run <name>`.
      const runs = batchBins.flatMap(bin =>
        batchBinCases.flatMap(([args, printed]) => [
          { via: `${bin}.exe`, args, cmd: [join(binDir, `${bin}.exe`), ...args], printed },
          { via: `bun run ${bin}`, args, cmd: [bunExe(), "run", bin, ...args], printed },
        ]),
      );

      expect(await runAll(String(dir), runs)).toEqual(
        runs.map(({ via, args, printed }) => ({ via, args, stdout: printed, stderr: "", exitCode: 0 })),
      );
    },
  );

  // Temporary, removed together with the fix: the two tests below check on
  // Windows CI the command lines a fix can use, before the launcher changes.

  // Writes `direct-<bin>.exe`, a copy of the launcher whose .bunx file records
  // no `cmd /c`. It passes `"<bin>" <arguments>` to CreateProcessW, which
  // starts cmd.exe for a batch file itself. Returns the path of the bin.
  function makeDirectLauncher(dir: string, bin: string) {
    const binDir = join(dir, "node_modules", ".bin");
    // .bunx layout with a launcher string: bin path, `"`, NUL, the string,
    // two u32 lengths in bytes (bin path, string), u16 flags.
    const bunx = readFileSync(join(binDir, `${bin}.bunx`));
    const flags = bunx.readUInt16LE(bunx.length - 2);
    const binPathBytes = bunx.readUInt32LE(bunx.length - 10);
    const noLauncherString = Buffer.alloc(binPathBytes + 4 + 2);
    bunx.copy(noLauncherString, 0, 0, binPathBytes + 4);
    noLauncherString.writeUInt16LE(flags & ~0b100, binPathBytes + 4);
    writeFileSync(join(binDir, `direct-${bin}.bunx`), noLauncherString);
    copyFileSync(join(binDir, `${bin}.exe`), join(binDir, `direct-${bin}.exe`));
    return join(dir, "node_modules", bunx.subarray(0, binPathBytes).toString("utf16le"));
  }

  it.if(isWindows)("probe: command lines that keep a quoted argument of a .cmd bin intact", async () => {
    using dir = tempDir("bun-run-batch-bins-probe", batchBinsProject);
    await installBatchBins(String(dir));
    const binDir = join(String(dir), "node_modules", ".bin");

    const runs: { via: string; args: string[]; cmd: string[]; verbatim?: boolean; printed: string }[] = [];
    for (const bin of batchBins) {
      const target = makeDirectLauncher(String(dir), bin);

      for (const [args, printed] of batchBinCases) {
        runs.push(
          { via: `direct-${bin}.exe`, args, cmd: [join(binDir, `direct-${bin}.exe`), ...args], printed },
          { via: `bun run direct-${bin}`, args, cmd: [bunExe(), "run", `direct-${bin}`, ...args], printed },
        );

        // The line of the launcher with one more pair of quotes around
        // everything after /c.
        const tail = args.map(arg => (arg === "" || arg.includes(" ") ? ` "${arg}"` : ` ${arg}`)).join("");
        const wrapped = `""${target}"${tail}"`;
        runs.push(
          { via: `cmd /c ""${bin}" <tail>"`, args, cmd: ["cmd.exe", "/c", wrapped], verbatim: true, printed },
          {
            via: `cmd /d /s /c ""${bin}" <tail>"`,
            args,
            cmd: ["cmd.exe", "/d", "/s", "/c", wrapped],
            verbatim: true,
            printed,
          },
        );
      }
    }

    expect(await runAll(String(dir), runs)).toEqual(
      runs.map(({ via, args, printed }) => ({ via, args, stdout: printed, stderr: "", exitCode: 0 })),
    );
  });

  it.if(isWindows)("probe: the command line cmd.exe receives for a .cmd bin", async () => {
    using dir = tempDir("bun-run-batch-bins-line", batchBinsProject);
    await installBatchBins(String(dir));
    const binDir = join(String(dir), "node_modules", ".bin");
    const target = makeDirectLauncher(String(dir), "cmd-tool");
    // %CMDCMDLINE% is the command line cmd.exe started with.
    writeFileSync(target, "@echo off\r\necho %CMDCMDLINE%\r\n");

    const results = await runAll(String(dir), [
      { via: "cmd-tool.exe", args: ["hello"], cmd: [join(binDir, "cmd-tool.exe"), "hello"] },
      { via: "bun run cmd-tool", args: ["hello"], cmd: [bunExe(), "run", "cmd-tool", "hello"] },
      { via: "direct-cmd-tool.exe", args: [], cmd: [join(binDir, "direct-cmd-tool.exe")] },
      { via: "direct-cmd-tool.exe", args: ["hello"], cmd: [join(binDir, "direct-cmd-tool.exe"), "hello"] },
      { via: "direct-cmd-tool.exe", args: ["hello world"], cmd: [join(binDir, "direct-cmd-tool.exe"), "hello world"] },
      {
        via: "bun run direct-cmd-tool",
        args: ["hello world"],
        cmd: [bunExe(), "run", "direct-cmd-tool", "hello world"],
      },
    ]);

    // A guess at what CreateProcessW builds. The diff of a wrong guess shows the real line.
    const system32 = join(process.env.SystemRoot ?? "C:\\WINDOWS", "system32", "cmd.exe");
    expect(results).toEqual(
      [
        { via: "cmd-tool.exe", args: ["hello"], stdout: `cmd /c "${target}" hello` },
        { via: "bun run cmd-tool", args: ["hello"], stdout: `cmd /c "${target}" hello` },
        { via: "direct-cmd-tool.exe", args: [], stdout: `${system32} /c ""${target}""` },
        { via: "direct-cmd-tool.exe", args: ["hello"], stdout: `${system32} /c ""${target}" hello"` },
        { via: "direct-cmd-tool.exe", args: ["hello world"], stdout: `${system32} /c ""${target}" "hello world""` },
        { via: "bun run direct-cmd-tool", args: ["hello world"], stdout: `${system32} /c ""${target}" "hello world""` },
      ].map(guess => ({ ...guess, stderr: "", exitCode: 0 })),
    );
  });

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
});
