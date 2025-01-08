import { file, spawn, spawnSync } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { exists, mkdir, rm, writeFile } from "fs/promises";
import {
  bunEnv,
  bunExe,
  bunEnv as env,
  isWindows,
  tempDirWithFiles,
  tmpdirSync,
  stderrForInstall,
  readdirSorted,
} from "harness";
import { join } from "path";

let run_dir: string;

beforeEach(async () => {
  run_dir = tmpdirSync();
});

for (let withRun of [false, true]) {
  describe(withRun ? "bun run" : "bun", () => {
    describe("should work with .", () => {
      it("respecting 'main' field and allowing trailing commas/comments in package.json", async () => {
        await writeFile(join(run_dir, "test.js"), "console.log('Hello, world!');");
        await writeFile(
          join(run_dir, "package.json"),
          `{
            // single-line comment
            "name": "test",
            /** even multi-line comment!! 
             * such feature much compatible very ecosystem 
             */
            "version": "0.0.0",
            "main": "test.js",
          }`,
        );
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });

      it("falling back to index", async () => {
        await writeFile(join(run_dir, "index.ts"), "console.log('Hello, world!');");
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            name: "test",
            version: "0.0.0",
          }),
        );

        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });

      it("invalid tsconfig.json is ignored", async () => {
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            name: "test",
            version: "0.0.0",
            scripts: {
              "boop": "echo hi",
            },
          }),
        );

        await writeFile(join(run_dir, "tsconfig.json"), "!!!bad!!!");

        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "--silent", withRun ? "run" : "", "boop"].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString().replaceAll("\r\n", "\n")).toBe("hi\n");
        expect(exitCode).toBe(0);
      });

      it("--silent omits error messages", async () => {
        const exe = isWindows ? "bun.exe" : "bun";
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", "--silent", exe, "doesnotexist"],
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).not.toEndWith(`error: "${exe}" exited with code 1\n`);
        expect(stdout.toString()).toBe("");
        expect(exitCode).toBe(1);
      });

      it("no --silent includes error messages", async () => {
        const exe = isWindows ? "bun.exe" : "bun";
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", exe, "doesnotexist"],
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toEndWith(`error: "${exe}" exited with code 1\n`);
        expect(exitCode).toBe(1);
      });

      it.skipIf(isWindows)("exit code message works above 128", async () => {
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", "bash", "-c", "exit 200"],
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toStartWith('error: "bash" exited with code 200');
        expect(exitCode).toBe(200);
      });

      describe.each(["--silent", "not silent"])("%s", silentOption => {
        const silent = silentOption === "--silent";
        it.skipIf(isWindows)("exit signal works", async () => {
          {
            const { stdout, stderr, exitCode, signalCode } = spawnSync({
              cmd: [bunExe(), silent ? "--silent" : "", "run", "bash", "-c", "kill -4 $$"].filter(Boolean),
              cwd: run_dir,
              env: bunEnv,
            });

            if (silent) {
              expect(stderr.toString()).toBe("");
            } else {
              expect(stderr.toString()).toContain("bash");
              expect(stderr.toString()).toContain("SIGILL");
            }

            expect(signalCode).toBe("SIGILL");
            expect(exitCode).toBe(null);
          }
          {
            const { stdout, stderr, exitCode, signalCode } = spawnSync({
              cmd: [bunExe(), silent ? "--silent" : "", "run", "bash", "-c", "kill -9 $$"],
              cwd: run_dir,
              env: bunEnv,
            });

            if (silent) {
              expect(stderr.toString()).toBe("");
            } else {
              expect(stderr.toString()).toContain("bash");
              expect(stderr.toString()).toContain("SIGKILL");
            }
            expect(signalCode).toBe("SIGKILL");
            expect(exitCode).toBe(null);
          }
        });
      });

      for (let withLogLevel of [true, false]) {
        it(
          "valid tsconfig.json with invalid extends doesn't crash" + (withLogLevel ? " (log level debug)" : ""),
          async () => {
            await writeFile(
              join(run_dir, "package.json"),
              JSON.stringify({
                name: "test",
                version: "0.0.0",
                scripts: {},
              }),
            );
            if (withLogLevel)
              await writeFile(
                join(run_dir, "bunfig.toml"),
                `
logLevel = "debug"
          `,
              );

            await writeFile(
              join(run_dir, "tsconfig.json"),
              JSON.stringify(
                {
                  extends: "!!!bad!!!",
                },
                null,
                2,
              ),
            );

            await writeFile(join(run_dir, "index.js"), "console.log('hi')");

            const { stdout, stderr, exitCode } = spawnSync({
              // TODO: figure out why -c is necessary here.
              cmd: [bunExe(), withRun ? "run" : "", "-c=" + join(run_dir, "bunfig.toml"), "./index.js"].filter(Boolean),
              cwd: run_dir,
              env: bunEnv,
            });
            if (withLogLevel) {
              expect(stderr.toString().trim()).toContain("ENOENT loading tsconfig.json extends");
            } else {
              expect(stderr.toString().trim()).not.toContain("ENOENT loading tsconfig.json extends");
            }

            expect(stdout.toString()).toBe("hi\n");
            expect(exitCode).toBe(0);
            await rm(join(run_dir, "bunfig.toml"), { force: true });
          },
        );
      }

      it("falling back to index with no package.json", async () => {
        await writeFile(join(run_dir, "index.ts"), "console.log('Hello, world!');");

        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });

      it("should not passthrough script arguments to pre- or post- scripts", async () => {
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            scripts: {
              premyscript: "echo pre",
              myscript: "echo main",
              postmyscript: "echo post",
            },
          }),
        );
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", "--silent", "myscript", "-a", "-b", "-c"].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString().replaceAll("\r\n", "\n")).toBe("pre\n" + "main -a -b -c\n" + "post\n");
        expect(exitCode).toBe(0);
      });
    });
  });
}

it("should download dependency to run local file", async () => {
  await writeFile(
    join(run_dir, "test.js"),
    `
const { minify } = require("uglify-js@3.17.4");

console.log(minify("print(6 * 7)").code);
  `,
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4@@@1"]);
  expect(await exists(join(run_dir, ".cache", "uglify-js", "3.17.4@@@1", "package.json"))).toBeTrue();
  const out1 = await new Response(stdout1).text();
  expect(out1.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited1).toBe(0);
  // Perform `bun test.js` with cached dependencies
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err2 = stderrForInstall(await new Response(stderr2).text());
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4@@@1"]);
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited2).toBe(0);
});

it("should download dependencies to run local file", async () => {
  const filePath = join(import.meta.dir, "baz-0.0.3.tgz").replace(/\\/g, "\\\\");
  await writeFile(
    join(run_dir, "test.js"),
    `
import { file } from "bun";
import decompress from "decompress@4.2.1";

const buffer = await file("${filePath}").arrayBuffer();
for (const entry of await decompress(Buffer.from(buffer))) {
  console.log(\`\${entry.type}: \${entry.path}\`);
}
  `,
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1@@@1"]);
  expect(await exists(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  const out1 = await new Response(stdout1).text();
  expect(out1.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited1).toBe(0);
  // Perform `bun run test.js` with cached dependencies
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err2 = await new Response(stderr2).text();
  if (err2) throw new Error(err2);
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1@@@1"]);
  expect(await exists(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited2).toBe(0);
});

it("should not crash when downloading a non-existent module, issue#4240", async () => {
  await writeFile(
    join(run_dir, "test.js"),
    `
import { prueba } from "pruebadfasdfasdkafasdyuif.js";
  `,
  );
  const { exited: exited } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  // The exit code will not be 1 if it panics.
  expect(await exited).toBe(1);
});

it("should show the correct working directory when run with --cwd", async () => {
  await mkdir(join(run_dir, "subdir"));
  await writeFile(
    join(run_dir, "subdir", "test.js"),
    `
    console.log(process.cwd());
  `,
  );
  const res = Bun.spawn({
    cmd: [bunExe(), "run", "--cwd", "subdir", "test.js"],
    cwd: run_dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });

  // The exit code will not be 1 if it panics.
  expect(await res.exited).toBe(0);
  expect(await Bun.readableStreamToText(res.stdout)).toMatch(/subdir/);
});

it("DCE annotations are respected", () => {
  const dir = tempDirWithFiles("test", {
    "index.ts": `
      /* @__PURE__ */ console.log("Hello, world!");
    `,
  });

  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: dir,
    env: bunEnv,
  });

  expect(exitCode).toBe(0);

  expect(stderr.toString()).toBe("");
  expect(stdout.toString()).toBe("");
});

it("--ignore-dce-annotations ignores DCE annotations", () => {
  const dir = tempDirWithFiles("test", {
    "index.ts": `
      /* @__PURE__ */ console.log("Hello, world!");
    `,
  });

  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "--ignore-dce-annotations", "run", "index.ts"],
    cwd: dir,
    env: bunEnv,
  });

  expect(exitCode).toBe(0);

  expect(stderr.toString()).toBe("");
  expect(stdout.toString()).toBe("Hello, world!\n");
});

it("$npm_command is accurate", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    `{
      "scripts": {
        "sample": "echo $npm_command",
      },
    }
    `,
  );
  const p = spawn({
    cmd: [bunExe(), "run", "sample"],
    cwd: run_dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stderr).text()).toBe(`$ echo $npm_command\n`);
  expect(await new Response(p.stdout).text()).toBe(`run-script\n`);
});

it("$npm_lifecycle_event is accurate", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    `{
      "scripts": {
        "presample": "echo $npm_lifecycle_event",
        "sample": "echo $npm_lifecycle_event",
        "postsample": "echo $npm_lifecycle_event",
      },
    }
    `,
  );
  const p = spawn({
    cmd: [bunExe(), "run", "sample"],
    cwd: run_dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(await p.exited).toBe(0);
  // prettier-ignore
  expect(await new Response(p.stderr).text()).toBe(`$ echo $npm_lifecycle_event\n$ echo $npm_lifecycle_event\n$ echo $npm_lifecycle_event\n`,);
  expect(await new Response(p.stdout).text()).toBe(`presample\nsample\npostsample\n`);
});

it("$npm_package_config_* works", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    `{
      "config": {
        "foo": "bar"
      },
      "scripts": {
        "sample": "echo $npm_package_config_foo",
      },
    }
    `,
  );
  const p = spawn({
    cmd: [bunExe(), "run", "sample"],
    cwd: run_dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stderr).text()).toBe(`$ echo $npm_package_config_foo\n`);
  expect(await new Response(p.stdout).text()).toBe(`bar\n`);
});

it("should pass arguments correctly in scripts", async () => {
  const dir = tempDirWithFiles("test", {
    "package.json": JSON.stringify({
      workspaces: ["a", "b"],
      scripts: { "root_script": "bun index.ts" },
    }),
    "index.ts": `for(const arg of Bun.argv) console.log(arg);`,
    "a/package.json": JSON.stringify({ name: "a", scripts: { echo2: "echo" } }),
    "b/package.json": JSON.stringify({ name: "b", scripts: { echo2: "npm run echo3", echo3: "echo" } }),
  });

  {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "run", "root_script", "$HOME (!)", "argument two"].filter(Boolean),
      cwd: dir,
      env: bunEnv,
    });

    expect(stderr.toString()).toBe('$ bun index.ts "\\$HOME (!)" "argument two"\n');
    expect(stdout.toString()).toEndWith("\n$HOME (!)\nargument two\n");
    expect(exitCode).toBe(0);
  }
  {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "--filter", "*", "echo2", "$HOME (!)", "argument two"].filter(Boolean),
      cwd: dir,
      env: bunEnv,
    });

    expect(stderr.toString()).toBe("");
    expect(stdout.toString().split("\n").sort().join("\n")).toBe(
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
      const dir = tempDirWithFiles("test", {
        "package.json": JSON.stringify({
          scripts: {
            "root_script": `   ${ccase[0]} target_script%    `,
            "target_script%": "   echo target_script    ",
          },
        }),
      });
      {
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "root_script"],
          cwd: dir,
          env: bunEnv,
        });

        if (ccase[1] === "run") {
          expect(stderr.toString()).toMatch(
            /^\$    bun(-debug)? run target_script%    \n\$    echo target_script    \n/,
          );
          expect(stdout.toString()).toEndWith("target_script\n");
          expect(exitCode).toBe(0);
        } else if (ccase[1] === "x") {
          expect(stderr.toString()).toMatch(
            /^\$    bun(-debug)? x target_script%    \nerror: unrecognised dependency format: target_script%/,
          );
          expect(exitCode).toBe(1);
        } else {
          expect(stderr.toString()).toStartWith(`$    ${ccase[0]} target_script%    \n`);
        }
      }
    });
  }
});
