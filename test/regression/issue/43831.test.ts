import { expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
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

    // The unfixed install never exits, so the test runner's timeout fails it.
    async function install(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: proj,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const first = await install();
    expect(first.stderr).not.toContain("error");
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("1.0.0");

    const held = join(nodeModules, "dep", isWindows ? "held.exe" : "held");
    let heldProc: Bun.Subprocess | undefined;
    try {
      if (isWindows) {
        // A copy has one hard link. While it runs, NTFS refuses to delete it.
        // `pause` blocks on stdin until the pipe closes.
        copyFileSync(process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", held);
        heldProc = Bun.spawn({
          cmd: [held, "/c", "pause"],
          cwd: String(dir),
          env: bunEnv,
          stdin: "pipe",
          stdout: "ignore",
          stderr: "ignore",
        });
      } else {
        writeFileSync(held, "locked");
        expect(spawnSync("chflags", ["uchg", held]).status).toBe(0);
      }

      await Bun.write(
        join(proj, "package.json"),
        JSON.stringify({ name: "proj", dependencies: { dep: "file:../dep-v2" } }),
      );

      const second = await install();
      if (heldProc) expect(heldProc.exitCode).toBeNull();
      expect(second.stderr).not.toContain("error");
      expect(second.stdout).toContain("dep@../dep-v2");
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(join(nodeModules, "dep", "package.json"), "utf8")).version).toBe("2.0.0");
      expect(readFileSync(join(proj, "bun.lock"), "utf8")).toContain("dep-v2");
      // The removal stopped at the locked file instead of spinning on it.
      const old = readdirSync(nodeModules).filter(name => name.startsWith(".old-"));
      expect(old).toHaveLength(1);
      expect(existsSync(join(nodeModules, old[0], isWindows ? "held.exe" : "held"))).toBe(true);
    } finally {
      if (heldProc) {
        heldProc.kill();
        await heldProc.exited;
      }
      if (isMacOS) {
        // Unlock the file wherever it ended up, so the temp dir can be removed.
        for (const name of readdirSync(nodeModules)) {
          if (name === "dep" || name.startsWith(".old-")) {
            spawnSync("chflags", ["nouchg", join(nodeModules, name, "held")]);
          }
        }
      }
    }
  },
);
