import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always), "disable" (never).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", async () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force", "--install=disable"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto" || install === "--install=disable") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        if (install === "--install=disable") {
          should_install = false;
        } else {
          should_install = true;
        }
      }

      const dir = tmpdirSync();
      mkdirSync(dir, { recursive: true });
      await Bun.write(
        join(dir, "index.js"),
        "import isEven from 'is-even'; console.log(isEven(2)); console.log((await import('is-odd')).default(2));",
      );

      if (has_node_modules) {
        mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\nfalse\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
        }
      });
    }
  }
});

// test that falllback prefers node_modules and force prefers its own cache
// https://bun.sh/docs/runtime/autoimport#version-specifiers
describe("autoinstall fallback and force", () => {
  for (const install of ["--install=fallback", "--install=force"]) {
    test(`${install} to install missing packages`, async () => {
      const dir = tmpdirSync();
      mkdirSync(dir, { recursive: true });
      await Promise.all([
        Bun.write(
          join(dir, "index.js"),
          "import {version as cowsayVersion} from 'cowsay/package.json'; import isOdd from 'is-odd'; console.log(cowsayVersion, isOdd(2));",
        ),
        Bun.write(
          join(dir, "package.json"),
          JSON.stringify({
            name: "test",
            dependencies: {
              "cowsay": "1.5.0", // latest is >=1.6.0
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
        cmd: [bunExe(), install, join(dir, "index.js")],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (install === "--install=fallback") {
        expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
        expect(stdout?.toString("utf8")).toBe("1.5.0 false\n");
      } else {
        // latest should be >1.6.0
        expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
        expect(stdout?.toString("utf8")).not.toBe("1.5.0 false\n");
        expect(stdout?.toString("utf8")).toEndWith("false\n");
      }
    });
  }
});

// test that version specifiers are respected
test("version specifiers are respected", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Bun.write(
    join(dir, "index.js"),
    `
import { version as version1 } from "cowsay@1.5.0/package.json";
import { version as version2 } from "cowsay@latest/package.json";
import { version as version3 } from "cowsay@^1.5.0/package.json";

console.log(version1, version2, version3);
`,
  );

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  console.log(stderr?.toString("utf8"));

  const [version1, version2, version3] = stdout?.toString("utf8").split(" ");

  expect(version1).toBe("1.5.0");
  expect(Bun.semver.satisfies(version2, ">=1.6.0")).toBeTrue();
  expect(Bun.semver.satisfies(version3, ">=1.6.0")).toBeTrue();
});

// test that version is fetched from package.json or bun.lock
// https://bun.sh/docs/runtime/autoimport#version-resolution

// ======= currently it doesn't appear to being used,
// but will still have it here for now =========
describe.todo("version is fetched from", () => {
  for (const install of ["package.json", "bun.lock", "bun.lock (with package.json)"]) {
    // latest `true` is 0.0.4 at time of writing
    const bunLock = {
      "lockfileVersion": 1,
      "workspaces": {
        "": {
          "dependencies": {
            "true": "0.0.3",
          },
        },
      },
      "packages": {
        "true": [
          "true@0.0.3",
          "",
          { "bin": { "true": "bin/cli.js" } },
          "sha512-X8PXKLAGnpaJUMJj9LqE2MNSIgNNDHzYmC8lBU6StSV9SGVHDuViHMZ8tUKDqDXhx3KRlPGAgLbh8lYKpHvBiQ==",
        ],
      },
    };
    const packageJson = {
      "dependencies": {
        "true": "0.0.2",
      },
    };

    test(`${install}`, async () => {
      const dir = tmpdirSync();
      mkdirSync(dir, { recursive: true });

      if (install === "package.json") {
        await Bun.write(join(dir, "package.json"), JSON.stringify(packageJson));
      } else if (install === "bun.lock") {
        await Bun.write(join(dir, "bun.lockb"), JSON.stringify(bunLock));
      } else if (install === "bun.lock (with package.json)") {
        await Bun.write(join(dir, "bun.lockb"), JSON.stringify(bunLock));
        await Bun.write(join(dir, "package.json"), JSON.stringify(packageJson));
      }

      await Bun.write(join(dir, "index.js"), "import { version } from 'true/package.json'; console.log(version);");

      const { stdout, stderr } = Bun.spawnSync({
        cmd: [bunExe(), join(dir, "index.js")],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'true'");

      if (install === "package.json") {
        expect(stdout?.toString("utf8")).toBe("0.0.2\n");
      } else if (install === "bun.lock") {
        expect(stdout?.toString("utf8")).toBe("0.0.3\n");
      } else if (install === "bun.lock (with package.json)") {
        expect(stdout?.toString("utf8")).toBe("0.0.3\n");
      }
    });
  }
});
