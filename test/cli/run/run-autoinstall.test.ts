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

// dirInfoForResolution stored DirInfo.abs_path as a slice into the threadlocal
// bufs(.path_in_global_disk_cache) buffer. After auto-installing a second package, that
// buffer is overwritten and the first package's cached DirInfo.abs_path points at stale
// bytes. When a module inside the first package then resolves its own name (package
// self-reference), loadNodeModules reads dir_info.abs_path directly and looks up a
// garbage path. With global_cache=.auto the auto-install fallback is skipped because
// any_node_modules_folder was set by the self-reference branch, so resolution fails with
// "Cannot find module". With the fix, abs_path is interned in DirnameStore and stays
// valid. A debug assertion in dirInfoUncached additionally guards the invariant.
test("auto-install: DirInfo.abs_path survives threadlocal buffer reuse across resolutions", async () => {
  using dir = tempDir("autoinstall-abs-path", {
    // No package.json / node_modules so global_cache defaults to .auto (line 4414 canUse).
    // nanoid has `exports` with a `./non-secure` subpath, enabling the self-reference
    // branch at resolver.zig:1807. left-pad's cache folder name is longer than nanoid's,
    // so nanoid's cached abs_path slice becomes a truncated prefix of left-pad's path.
    "index.js": `
      const path = require("path");
      const { createRequire } = require("module");

      const nanoidPath = require.resolve("nanoid");
      require.resolve("left-pad");

      const innerRequire = createRequire(nanoidPath);
      const nonSecure = innerRequire.resolve("nanoid/non-secure");
      console.log("non-secure:" + path.basename(path.dirname(nonSecure)));
    `,
  });

  await using proc = Bun.spawn({
    // Deliberately no -i / --install flag: default .auto prevents the auto-install
    // fallback from masking the corrupted abs_path.
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout.trim()).toBe("non-secure:non-secure");
  expect(exitCode).toBe(0);
});
