import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readFileSync, realpathSync } from "fs";
import { bunExe, bunEnv as env, tempDir } from "harness";
import { join } from "path";

// `link:./some/dir` (a path, as written by yarn and pnpm) is a folder dependency of the
// declaring package, installed as a symlink — the target does not have to be registered
// with `bun link` and does not even need a package.json. Bare `link:<name>` keeps its
// meaning (a globally linked package) and is covered by bun-link.test.ts.

async function install(cwd: string, args: string[] = []) {
  await using proc = spawn({ cmd: [bunExe(), "install", ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

describe.each(["hoisted", "isolated"])("link:./path dependencies (%s linker)", linker => {
  it("root and workspace link: paths resolve relative to the declaring package.json", async () => {
    using dir = tempDir("link-path", {
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({
        name: "root",
        private: true,
        workspaces: ["packages/*"],
        dependencies: {
          "with-manifest": "link:./vendor/with-manifest",
          "no-manifest": "link:./vendor/no-manifest",
          odd: "link:./vendor/~",
        },
      }),
      // a target with its own package.json (name comes from there)
      "vendor/with-manifest/package.json": JSON.stringify({ name: "with-manifest", version: "1.2.3" }),
      "vendor/with-manifest/index.js": "module.exports = 'with';",
      // a plain directory without a package.json (yarn's link: allows this)
      "vendor/no-manifest/index.js": "module.exports = 'without';",
      // …whose directory name has nothing usable for a package name
      "vendor/~/index.js": "module.exports = 'tilde';",
      // a workspace declaring a link: relative to *its* directory
      "packages/app/package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { local: "link:../../vendor/with-manifest" },
      }),
    });
    const root = String(dir);
    const r = await install(root);
    expect(r.err).not.toContain("error:");
    expect(r.err).toContain("Saved lockfile");
    expect(r.code).toBe(0);

    const nm = join(root, "node_modules");
    expect(lstatSync(join(nm, "with-manifest")).isSymbolicLink()).toBeTrue();
    expect(realpathSync(join(nm, "with-manifest"))).toBe(realpathSync(join(root, "vendor", "with-manifest")));
    expect(readFileSync(join(nm, "no-manifest", "index.js"), "utf8")).toContain("without");
    expect(realpathSync(join(nm, "no-manifest"))).toBe(realpathSync(join(root, "vendor", "no-manifest")));
    expect(readFileSync(join(nm, "odd", "index.js"), "utf8")).toContain("tilde");
    // the workspace's link resolves relative to packages/app (not the root); with the
    // hoisted linker it is hoisted to the root node_modules like any other dependency
    const localLink = linker === "hoisted" ? join(nm, "local") : join(root, "packages", "app", "node_modules", "local");
    expect(realpathSync(localLink)).toBe(realpathSync(join(root, "vendor", "with-manifest")));

    const lock = await Bun.file(join(root, "bun.lock")).text();
    expect(lock).toContain("link:./vendor/with-manifest");
    expect(lock).toContain("link:../../vendor/with-manifest");

    // a second install from the lockfile is stable
    const again = await install(root, ["--frozen-lockfile"]);
    expect(again.err).not.toContain("error:");
    expect(again.code).toBe(0);
  });

  it("a link: path whose target directory does not exist fails at resolve time and writes nothing", async () => {
    using dir = tempDir("link-path-missing", {
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
      "package.json": JSON.stringify({ name: "root", dependencies: { later: "link:./vendor/later" } }),
    });
    const root = String(dir);
    const r = await install(root);
    // reported as a missing directory (not as an unknown `bun link` registration)…
    expect(r.err).toContain('error: Could not find directory "./vendor/later" for linked dependency "later"');
    expect(r.err).not.toContain("is not linked");
    expect(r.err).not.toContain("Saved lockfile");
    expect(r.code).toBe(1);
    // …before anything is written: no lockfile and no dangling symlink under either linker
    expect(existsSync(join(root, "bun.lock"))).toBeFalse();
    expect(existsSync(join(root, "node_modules"))).toBeFalse();
  });
});
