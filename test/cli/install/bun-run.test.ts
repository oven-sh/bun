import { $ } from "bun";
import { describe, expect, it } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv as bunEnv_, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

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
});
