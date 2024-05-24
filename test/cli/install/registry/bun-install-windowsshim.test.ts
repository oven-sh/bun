import { spawn } from "bun";
import { bunExe, bunEnv as env, isWindows, mergeWindowEnvs, tmpdirSync } from "harness";
import { join } from "path";
import { copyFileSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { test, expect, describe } from "bun:test";

// This test is to verify that BinLinkingShim.zig creates correct shim files as
// well as bun_shim_impl.exe works in various edge cases. There are many fast
// paths for many many cases.
describe("windows bin linking shim should work", async () => {
  if (!isWindows) return;

  const packageDir = tmpdirSync();
  const port = 4873;

  await writeFile(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${port}/"
`,
  );

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "bunx-bins": "*",
      },
    }),
  );
  console.log(packageDir);

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--dev"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  console.log(err);
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(err).not.toContain("not found");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ bunx-bins@1.0.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);

  const temp_bin_dir = join(packageDir, "temp");
  mkdirSync(temp_bin_dir);

  for (let i = 1; i <= 7; i++) {
    const target = join(temp_bin_dir, "a".repeat(i) + ".exe");
    copyFileSync(bunExe(), target);
  }

  copyFileSync(join(packageDir, "node_modules\\bunx-bins\\native.exe"), join(temp_bin_dir, "native.exe"));

  const PATH = process.env.PATH + ";" + temp_bin_dir;

  const bins = [
    { bin: "bin1", name: "bin1" },
    { bin: "bin2", name: "bin2" },
    { bin: "bin3", name: "bin3" },
    { bin: "bin4", name: "bin4" },
    { bin: "bin5", name: "bin5" },
    { bin: "bin6", name: "bin6" },
    { bin: "bin7", name: "bin7" },
    { bin: "bin-node", name: "bin-node" },
    { bin: "bin-bun", name: "bin-bun" },
    { bin: "native", name: "exe" },
    { bin: "uses-native", name: `exe ${packageDir}\\node_modules\\bunx-bins\\uses-native.ts` },
  ];

  for (const { bin, name } of bins) {
    test(`bun run ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "run", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`bun --bun run ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "--bun", "run", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`bun --bun x ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "--bun", "x", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", bin + ".exe"), "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }
});
