import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        should_install = true;
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const dir = tmpdirSync();
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.js"), "import isEven from 'is-even'; console.log(isEven(2));");
        const env = bunEnv;
        env.BUN_INSTALL = install;
        if (has_node_modules) {
          mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
        }
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
        }
      });
    }
  }
});

test("--install=fallback to install missing packages", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "index.js"),
      "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    ),
    Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
    ),
  ]);

  Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--install=fallback", join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
  expect(stdout?.toString("utf8")).toBe("true false\n");
});

// dirInfoForResolution previously stored DirInfo.abs_path as a slice into the threadlocal
// bufs(.path_in_global_disk_cache) buffer. After auto-installing a second package, that
// buffer is overwritten and any cached DirInfo.abs_path from the first package points at
// stale bytes. Re-importing the first package by a different subpath re-enters the
// dir_cache and relies on that abs_path. In debug builds an assertion now guards that the
// stored path is never a threadlocal-buffer slice.
test("auto-install multiple packages with repeated subpath imports keeps DirInfo.abs_path stable", async () => {
  using dir = tempDir("autoinstall-abs-path", {
    "index.js": `
      const isOdd = require("is-odd");
      const leftPad = require("left-pad");
      const isOddPkg = require("is-odd/package.json");
      console.log(isOdd(3), leftPad("x", 3, "0"), isOddPkg.name);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-i", "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL: join(String(dir), ".bun") },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(stdout.trim()).toBe("true 00x is-odd");
  expect(exitCode).toBe(0);
}, 30_000);
