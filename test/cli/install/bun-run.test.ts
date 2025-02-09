import { $, file, spawn, spawnSync } from "bun";
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
import { chmodSync } from "fs";

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
      stderr: /error: Script not found "no_run_json"|EACCES/,
      exitCode: 1,
    },
    {
      command: ["no_run_json.json"],
      stdout: "",
      stderr: /error: Module not found "no_run_json\.json"|EACCES/,
      exitCode: 1,
    },
    {
      command: ["./no_run_json"],
      stdout: "",
      stderr: /error: Module not found "\.(\/|\\|\\\\)no_run_json"|EACCES/,
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
        it("bun " + full_command.join(" "), () => {
          const { stdout, stderr, exitCode } = spawnSync({
            cmd: [bunExe(), ...full_command],
            cwd: dir,
            env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
          });

          if (cmd.stderr != null && typeof cmd.stderr !== "string") expect(stderr.toString()).toMatch(cmd.stderr);
          expect({
            ...(cmd.stderr != null && typeof cmd.stderr === "string" ? { stderr: stderr.toString().trim() } : {}),
            stdout: stdout.toString().trim(),
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

  it("outside", () => {
    const run_outside = spawnSync({
      cmd: [bunExe(), "run", "sample"],
      cwd: dir + "/run_here",
      env: bunEnv,
    });
    expect(run_outside.stdout.toString()).toContain("run_here");
    expect(run_outside.stdout.toString()).not.toContain("dont_run_in_here");
    expect(run_outside.exitCode).toBe(0);
  });

  it("inside", () => {
    const run_inside = spawnSync({
      cmd: [bunExe(), "run", "sample"],
      cwd: dir + "/run_here/dont_run_in_here",
      env: bunEnv,
    });
    expect(run_inside.stdout.toString()).toContain("run_here");
    expect(run_inside.stdout.toString()).not.toContain("dont_run_in_here");
    expect(run_inside.exitCode).toBe(0);
  });

  it("inside --shell=bun", () => {
    const run_inside = spawnSync({
      cmd: [bunExe(), "--shell=bun", "run", "sample"],
      cwd: dir + "/run_here/dont_run_in_here",
      env: bunEnv,
    });
    expect(run_inside.stdout.toString()).toContain("run_here");
    expect(run_inside.stdout.toString()).not.toContain("dont_run_in_here");
    expect(run_inside.exitCode).toBe(0);
  });

  it("inside script", () => {
    const run_inside = spawnSync({
      cmd: [bunExe(), "run", "runme.ts"],
      cwd: dir + "/run_here/dont_run_in_here",
      env: bunEnv,
    });
    expect(run_inside.stdout.toString()).toContain("do run this script");
    expect(run_inside.exitCode).toBe(0);
  });

  it("inside wrong script", () => {
    const run_inside = spawnSync({
      cmd: [bunExe(), "run", "myscript.ts"],
      cwd: dir + "/run_here/dont_run_in_here",
      env: bunEnv,
    });
    const stderr = run_inside.stderr.toString();
    if (stderr.includes("myscript.ts") && stderr.includes("EACCES")) {
      // for some reason on musl, the run_here folder is in $PATH
      // 'error: Failed to run "myscript.ts" due to:\nEACCES: run_here/myscript.ts: Permission denied (posix_spawn())'
    } else {
      expect(stderr).toBe('error: Module not found "myscript.ts"\n');
    }
    expect(run_inside.exitCode).toBe(1);
  });

  it("outside 2", () => {
    const run_outside_script = spawnSync({
      cmd: [bunExe(), "runscript"],
      cwd: dir + "/run_here",
      env: bunEnv,
    });
    expect(run_outside_script.stdout.toString()).toBe("successful run\n");
    expect(run_outside_script.exitCode).toBe(0);
  });

  it("inside 2", () => {
    const run_inside_script = spawnSync({
      cmd: [bunExe(), "runscript"],
      cwd: dir + "/run_here/dont_run_in_here",
      env: bunEnv,
    });
    expect(run_inside_script.stdout.toString()).toBe("successful run\n");
    expect(run_inside_script.exitCode).toBe(0);
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

  it("should run main from monorepo root", () => {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "."],
      cwd: dir,
      env: bunEnv,
    });
    expect(stdout.toString()).toBe("monorepo_root\n");
    expect(exitCode).toBe(0);
  });

  it("should run package_a from package_a", () => {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "."],
      cwd: dir + "/packages/package_a",
      env: bunEnv,
    });
    expect(stdout.toString()).toBe("package_a\n");
    expect(exitCode).toBe(0);
  });

  it("should fail from package_b", () => {
    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "."],
      cwd: dir + "/packages/package_b",
      env: bunEnv,
    });
    expect(exitCode).toBe(1);
  });
});
