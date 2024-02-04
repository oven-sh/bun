// @known-failing-on-windows: 1 failing
import { file, spawn, spawnSync } from "bun";
import { afterEach, beforeEach, expect, it, describe } from "bun:test";
import { bunEnv, bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let run_dir: string;

beforeEach(async () => {
  run_dir = await realpath(
    await mkdtemp(join(tmpdir(), "bun-run.test." + Math.trunc(Math.random() * 9999999).toString(32))),
  );
});
afterEach(async () => {
  // await rm(run_dir, { force: true, recursive: true });
});

for (let withRun of [false, true]) {
  describe(withRun ? "bun run" : "bun", () => {
    describe("should work with .", () => {
      it("respecting 'main' field", async () => {
        await writeFile(join(run_dir, "test.js"), "console.log('Hello, world!');");
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            name: "test",
            version: "0.0.0",
            main: "test.js",
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
        const exe = process.platform === "win32" ? "bun.exe" : "bun";
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
        const exe = process.platform === "win32" ? "bun.exe" : "bun";
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", exe, "doesnotexist"],
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toEndWith(`error: "${exe}" exited with code 1\n`);
        expect(exitCode).toBe(1);
      });

      it.skipIf(process.platform === "win32")("exit code message works above 128", async () => {
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), "run", "bash", "-c", "exit 200"],
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toStartWith('error: "bash" exited with code 200');
        expect(exitCode).toBe(200);
      });

      it("exit signal works", async () => {
        {
          let signalCode: any;
          let exitCode: any;
          const { stdout, stderr } = spawnSync({
            cmd: [bunExe(), "run", "bash", "-c", "kill -4 $$"],
            cwd: run_dir,
            env: bunEnv,
            onExit(subprocess, exitCode2, signalCode2, error) {
              exitCode = exitCode2;
              signalCode = signalCode2;
            },
          });

          expect(stderr.toString()).toBe("");
          expect(signalCode).toBe("SIGILL");
          expect(exitCode).toBe(null);
        }
        {
          let signalCode: any;
          let exitCode: any;
          const { stdout, stderr } = spawnSync({
            cmd: [bunExe(), "run", "bash", "-c", "kill -9 $$"],
            cwd: run_dir,
            env: bunEnv,
            onExit(subprocess, exitCode2, signalCode2, error) {
              exitCode = exitCode2;
              signalCode = signalCode2;
            },
          });

          expect(stderr.toString()).toBe("");
          expect(signalCode).toBe("SIGKILL");
          expect(exitCode).toBe(null);
        }
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
            console.log(run_dir);
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4"]);
  expect(stdout1).toBeDefined();
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4"]);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited2).toBe(0);
});

it("should download dependencies to run local file", async () => {
  await writeFile(
    join(run_dir, "test.js"),
    `
import { file } from "bun";
import decompress from "decompress@4.2.1";

const buffer = await file("${join(import.meta.dir, "baz-0.0.3.tgz")}").arrayBuffer();
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1"]);
  expect(await readdirSorted(join(run_dir, ".cache", "decompress", "4.2.1"))).toEqual([
    "index.js",
    "license",
    "package.json",
    "readme.md",
  ]);
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1", "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  expect(stdout1).toBeDefined();
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  if (err2) throw new Error(err2);
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1"]);
  expect(await readdirSorted(join(run_dir, ".cache", "decompress", "4.2.1"))).toEqual([
    "index.js",
    "license",
    "package.json",
    "readme.md",
  ]);
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1", "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  expect(stdout2).toBeDefined();
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
