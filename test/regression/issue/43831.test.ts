import { expect, test } from "bun:test";
import { copyFileSync, readdirSync, readFileSync, spawnSync } from "fs";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "path";

// When `bun install` replaces a package, it renames node_modules/<pkg> to
// .old-<hex> and removes that directory on a worker thread. A file in it that
// unlink cannot remove (EPERM) must fail the removal, not hang the install.
// Windows: the last hard link of a running executable. macOS: a `uchg` file.
// Linux needs root or another user to get EPERM from unlink, so it is skipped.
test.skipIf(!isWindows && !isMacOS)(
  "bun install finishes when the replaced package holds a file that cannot be unlinked",
  async () => {
    using dir = tempDir("issue-43831", {
      "dep-v1/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "dep-v2/package.json": JSON.stringify({ name: "dep", version: "2.0.0" }),
      "proj/package.json": JSON.stringify({ name: "proj", dependencies: { dep: "file:../dep-v1" } }),
    });
    const proj = join(String(dir), "proj");
    const nodeModules = join(proj, "node_modules");

    async function install(): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: proj,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      // The unfixed install never exits. Bound the wait so the failure is a
      // clear assertion and the cleanup below still runs.
      const exited = await Promise.race([proc.exited, Bun.sleep(30_000).then(() => null)]);
      if (exited === null) proc.kill();
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
      return { stdout, stderr, exitCode: exited };
    }

    const first = await install();
    expect(first.stderr).not.toContain("error");
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("1.0.0");

    const held = join(nodeModules, "dep", isWindows ? "held.exe" : "held");
    copyFileSync(bunExe(), held);
    let heldProc: Bun.Subprocess | undefined;
    try {
      if (isWindows) {
        // A copy has one hard link. While it runs, NTFS refuses to delete it.
        heldProc = Bun.spawn({
          cmd: [held, "-e", "setInterval(() => {}, 1000)"],
          cwd: String(dir),
          env: bunEnv,
          stdout: "ignore",
          stderr: "ignore",
        });
      } else {
        expect(spawnSync("chflags", ["uchg", held]).status).toBe(0);
      }

      await Bun.write(
        join(proj, "package.json"),
        JSON.stringify({ name: "proj", dependencies: { dep: "file:../dep-v2" } }),
      );

      const second = await install();
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("2.0.0");
      expect(readFileSync(join(proj, "bun.lock"), "utf8")).toContain("dep-v2");
    } finally {
      if (heldProc) {
        heldProc.kill();
        await heldProc.exited;
      }
      if (isMacOS) {
        for (const name of readdirSync(nodeModules)) {
          if (name.startsWith(".old-")) spawnSync("chflags", ["nouchg", join(nodeModules, name, "held")]);
        }
      }
    }
  },
);
