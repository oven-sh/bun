import { test, expect } from "bun:test";
import path from "node:path";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("doesn't error when the migration is out of sync", async () => {
  const cwd = tempDirWithFiles("out-of-sync-1", {
    "package.json": JSON.stringify({
      "devDependencies": {
        "lodash": "4.17.20",
      },
    }),
    "package-lock.json": JSON.stringify({
      "name": "reproo",
      "lockfileVersion": 3,
      "requires": true,
      "packages": {
        "": {
          "dependencies": {
            "lodash": "4.17.21",
          },
          "devDependencies": {
            "lodash": "4.17.20",
          },
        },
        "node_modules/lodash": {
          "version": "4.17.20",
          "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz",
          "integrity":
            "sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA==",
          "dev": true,
        },
      },
    }),
  });

  const subprocess = Bun.spawn([bunExe(), "install"], {
    env: bunEnv,
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
  });

  await subprocess.exited;

  expect(subprocess.exitCode).toBe(0);

  let { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "pm", "ls"],
    env: bunEnv,
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = stdout.toString().trim();
  expect(out).toContain("lodash@4.17.20");
  // only one lodash is installed
  expect(out.lastIndexOf("lodash")).toEqual(out.indexOf("lodash"));
  expect(exitCode).toBe(0);

  expect(await Bun.file(path.join(cwd, "node_modules/lodash/package.json")).json()).toMatchObject({
    version: "4.17.20",
    name: "lodash",
  });
});
