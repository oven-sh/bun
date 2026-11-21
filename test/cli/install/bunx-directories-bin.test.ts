import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function run(cwd: string, args: string[], env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The bins are shell scripts, which the bin links cannot run on Windows.
test.concurrent.skipIf(isWindows)("bunx runs the bin of a directories.bin package", async () => {
  using dir = tempDir("bunx-directories-bin", {
    "package.json": JSON.stringify({ name: "app", dependencies: { tool: "file:./tool" } }),
    "tool/package.json": JSON.stringify({ name: "tool", version: "1.0.0", directories: { bin: "bins" } }),
    "tool/bins/tool-cli": "#!/bin/sh\necho tool-cli ran\n",
    "tool/bins/nested/not-a-bin": "",
  });
  chmodSync(join(String(dir), "tool", "bins", "tool-cli"), 0o755);
  const env = { BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };
  expect(await run(String(dir), ["install"], env)).toMatchObject({ exitCode: 0 });

  // The bin is not named after the package, so bunx has to read the package's
  // `directories.bin` (relative to the package, not to the project) to learn
  // its name. --no-install: failing to do so must not fall through to
  // installing the package from the registry.
  expect(await run(String(dir), ["x", "--no-install", "tool"], env)).toEqual({
    stdout: "tool-cli ran\n",
    stderr: "",
    exitCode: 0,
  });
});

// `bun install` links nothing for these values; bunx must not take a bin name
// from the directory they point at either. `picked` is the entry bunx would
// find there (and then run from node_modules/.bin) if it did.
const rejected: [label: string, value: (dir: string) => string, picked: string][] = [
  ["a relative path that leaves the package", () => "../../outside", "planted"],
  ["an absolute path", dir => join(dir, "outside"), "planted"],
  ["an empty string (the package directory itself)", () => "", "package.json"],
];

for (const [label, value, picked] of rejected) {
  test.concurrent.skipIf(isWindows)(`bunx ignores a directories.bin that is ${label}`, async () => {
    using dir = tempDir("bunx-directories-bin-rejected", {
      "package.json": JSON.stringify({ name: "app", dependencies: { tool: "file:./tool" } }),
      "tool/package.json": "",
      "outside/planted": "",
    });
    // Written afterwards because the value may depend on the directory's path.
    writeFileSync(
      join(String(dir), "tool", "package.json"),
      JSON.stringify({ name: "tool", version: "1.0.0", directories: { bin: value(String(dir)) } }),
    );
    const env = { BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };
    expect(await run(String(dir), ["install"], env)).toMatchObject({ exitCode: 0 });
    const binDir = join(String(dir), "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, picked), "#!/bin/sh\necho planted ran\n", { mode: 0o755 });

    const { stdout, stderr, exitCode } = await run(String(dir), ["x", "--no-install", "tool"], env);

    expect(stdout).toBe("");
    expect(stderr).toContain("could not determine executable to run for package tool");
    expect(exitCode).toBe(1);
  });
}
