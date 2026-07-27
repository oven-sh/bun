import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Only meaningful on a case-sensitive filesystem (Linux ext4 etc). On a
// case-insensitive filesystem the two writes below land on the same file, so
// detect that at runtime and skip rather than hard-coding the platform.
using probeDir = tempDir("resolve-case-probe", {
  "probe.txt": "lower",
  "Probe.txt": "UPPER",
});
const isCaseSensitiveFS = readFileSync(join(String(probeDir), "probe.txt"), "utf8") === "lower";

describe.concurrent.skipIf(!isCaseSensitiveFS)("resolver on case-sensitive filesystem", () => {
  test("import of two files differing only in case loads each distinctly", async () => {
    using dir = tempDir("resolve-case-esm", {
      "mod.mjs": `export const who = "lower";`,
      "Mod.mjs": `export const who = "UPPER";`,
      "entry.mjs": `
        import { who as L } from "./mod.mjs";
        import { who as U } from "./Mod.mjs";
        console.log(JSON.stringify({ L, U }));
        console.log(Bun.resolveSync("./mod.mjs", import.meta.dir));
        console.log(Bun.resolveSync("./Mod.mjs", import.meta.dir));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual({ L: "lower", U: "UPPER" });
    expect(lines[1]).toBe(join(String(dir), "mod.mjs"));
    expect(lines[2]).toBe(join(String(dir), "Mod.mjs"));
    expect(exitCode).toBe(0);
  });

  test("require of two files differing only in case loads each distinctly", async () => {
    using dir = tempDir("resolve-case-cjs", {
      "readme.js": `module.exports = "lower";`,
      "README.js": `module.exports = "UPPER";`,
      "entry.js": `
        const a = require("./readme.js");
        const b = require("./README.js");
        console.log(JSON.stringify({ a, b }));
        console.log(require.resolve("./readme.js"));
        console.log(require.resolve("./README.js"));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual({ a: "lower", b: "UPPER" });
    expect(lines[1]).toBe(join(String(dir), "readme.js"));
    expect(lines[2]).toBe(join(String(dir), "README.js"));
    expect(exitCode).toBe(0);
  });

  test("extensionless import picks the exact-case file", async () => {
    using dir = tempDir("resolve-case-ext", {
      "util.ts": `export const who = "lower";`,
      "Util.ts": `export const who = "UPPER";`,
      "entry.ts": `
        import { who as L } from "./util";
        import { who as U } from "./Util";
        console.log(JSON.stringify({ L, U }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ L: "lower", U: "UPPER" });
    expect(exitCode).toBe(0);
  });

  test("case-mismatched specifier fails when only the other case exists", async () => {
    using dir = tempDir("resolve-case-miss", {
      "Mod.mjs": `export const who = "UPPER";`,
      "entry.mjs": `import { who } from "./mod.mjs"; console.log(who);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module './mod.mjs'");
    expect(stderr).toContain("Mod.mjs");
    expect(stderr.toLowerCase()).toContain("case-sensitive");
    expect(exitCode).not.toBe(0);
  });

  test("case-mismatched extension fails", async () => {
    using dir = tempDir("resolve-case-extcase", {
      "mod.js": `export const who = "lower";`,
      "entry.mjs": `import { who } from "./mod.JS"; console.log(who);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("mod.JS");
    expect(exitCode).not.toBe(0);
  });

  test("nonexistent case variant fails when case-colliding siblings exist", async () => {
    using dir = tempDir("resolve-case-phantom", {
      "mod.mjs": `export const who = "lower";`,
      "Mod.mjs": `export const who = "UPPER";`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `Bun.resolveSync("./MOD.mjs", ${JSON.stringify(String(dir))})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("MOD.mjs");
    expect(exitCode).not.toBe(0);
  });

  test("directory-component case is not folded (control: unchanged from before)", async () => {
    using dir = tempDir("resolve-case-dirseg", {
      "Dir/x.js": `module.exports = 1;`,
      "entry.js": `require("./dir/x.js");`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("dir/x.js");
    expect(exitCode).not.toBe(0);
  });
});
