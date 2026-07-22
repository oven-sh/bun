import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// The hoisted linker used to put every hoisted package's `bin` entries into
// the root `node_modules/.bin`, which `bun run` prepends to PATH. An untrusted
// transitive dependency could plant a `git`/`sh`/... bin there and have it run
// the next time a project script shells out to that tool, bypassing the
// default no-scripts trust model. These tests cover the trust gate applied to
// hoisted bin linking.

// --- tiny in-process npm registry -----------------------------------------

const enc = new TextEncoder();
function tarHeader(name: string, size: number, mode = "0000755") {
  const h = new Uint8Array(512);
  const put = (s: string, o: number) => h.set(enc.encode(s), o);
  put(name, 0);
  put(mode + "\0", 100);
  put("0000000\0", 108);
  put("0000000\0", 116);
  put(size.toString(8).padStart(11, "0") + "\0", 124);
  put("00000000000\0", 136);
  h.fill(0x20, 148, 156);
  h[156] = 0x30;
  put("ustar\0", 257);
  put("00", 263);
  let s = 0;
  for (let i = 0; i < 512; i++) s += h[i];
  put(s.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function tgz(files: Record<string, string>) {
  const parts: Uint8Array[] = [];
  for (const [name, body] of Object.entries(files)) {
    const b = enc.encode(body);
    parts.push(tarHeader(`package/${name}`, b.length), b, new Uint8Array((512 - (b.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return Bun.gzipSync(out);
}
function integrity(gz: Uint8Array) {
  const h = new Bun.CryptoHasher("sha512");
  h.update(gz);
  return "sha512-" + h.digest("base64");
}

const shadowScript = `#!/usr/bin/env node\nconsole.log("SHADOW-EXECUTED");\n`;

type Pkg = { pj: any; gz: Uint8Array };
const pkgs: Record<string, Pkg> = {};
function addPkg(pj: any, files: Record<string, string>) {
  pkgs[pj.name] = { pj, gz: tgz({ "package.json": JSON.stringify(pj), ...files }) };
}
addPkg(
  { name: "shadow-bin", version: "1.0.0", bin: { git: "./shadow.js", "shadow-bin-tool": "./shadow.js" } },
  { "shadow.js": shadowScript },
);
addPkg({ name: "dep-on-shadow-bin", version: "1.0.0", dependencies: { "shadow-bin": "1.0.0" } }, { "index.js": "0" });

let server: ReturnType<typeof Bun.serve>;
let registryUrl: string;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const parts = new URL(req.url).pathname.split("/").filter(Boolean);
      if (parts.length === 1) {
        const p = pkgs[decodeURIComponent(parts[0])];
        if (!p) return new Response("not found", { status: 404 });
        return Response.json({
          name: p.pj.name,
          "dist-tags": { latest: p.pj.version },
          versions: {
            [p.pj.version]: {
              ...p.pj,
              dist: { tarball: `${registryUrl}t/${p.pj.name}-${p.pj.version}.tgz`, integrity: integrity(p.gz) },
            },
          },
        });
      }
      const m = /^t\/(.+)-\d+\.\d+\.\d+\.tgz$/.exec(parts.join("/"));
      const p = m && pkgs[m[1]];
      return p ? new Response(p.gz) : new Response("not found", { status: 404 });
    },
  });
  registryUrl = `http://127.0.0.1:${server.port}/`;
});

afterAll(() => {
  server?.stop(true);
});

// --- helpers ---------------------------------------------------------------

async function install(packageDir: string, extraEnv: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
      TMPDIR: join(packageDir, ".bun-tmp"),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return { stdout, stderr };
}

function binEntries(dir: string): string[] {
  const binDir = join(dir, "node_modules", ".bin");
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .map(name => name.replace(/\.(bunx|exe)$/i, ""))
    .filter((name, i, arr) => arr.indexOf(name) === i)
    .sort();
}

async function setup(packageJson: any) {
  const dir = tempDir("bin-trust-", {
    "bunfig.toml": `[install]\nregistry = "${registryUrl}"\ncache = false\nlinker = "hoisted"\n`,
    "package.json": JSON.stringify(packageJson),
  });
  return String(dir);
}

// --- tests ----------------------------------------------------------------

describe.concurrent("hoisted linker bin trust gate", () => {
  test("untrusted transitive dependency bins are not linked into root .bin", async () => {
    const packageDir = await setup({
      name: "app",
      version: "1.0.0",
      dependencies: { "dep-on-shadow-bin": "1.0.0" },
    });

    await install(packageDir);

    // shadow-bin is installed (hoisted to root node_modules) but its bin
    // entries must not appear in root .bin because it is neither a direct
    // dependency nor trusted.
    expect(existsSync(join(packageDir, "node_modules", "shadow-bin", "shadow.js"))).toBeTrue();
    expect(binEntries(packageDir)).toEqual([]);
    expect(existsSync(join(packageDir, "node_modules", ".bin", "git"))).toBeFalse();
    expect(existsSync(join(packageDir, "node_modules", ".bin", "shadow-bin-tool"))).toBeFalse();

    // Same result after a reinstall from the lockfile (exercises the
    // already-on-disk enqueue path).
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await install(packageDir);
    expect(binEntries(packageDir)).toEqual([]);
  });

  test("direct dependency bins are linked regardless of trust", async () => {
    const packageDir = await setup({
      name: "app",
      version: "1.0.0",
      dependencies: { "shadow-bin": "1.0.0" },
    });

    await install(packageDir);

    expect(binEntries(packageDir)).toEqual(["git", "shadow-bin-tool"]);
  });

  test("transitive dependency bins are linked when their declaring package is trusted", async () => {
    const packageDir = await setup({
      name: "app",
      version: "1.0.0",
      dependencies: { "dep-on-shadow-bin": "1.0.0" },
      trustedDependencies: ["dep-on-shadow-bin"],
    });

    await install(packageDir);

    // dep-on-shadow-bin is trusted, so its direct dependency shadow-bin's bins
    // are available for dep-on-shadow-bin's (hypothetical) install script.
    expect(binEntries(packageDir)).toEqual(["git", "shadow-bin-tool"]);
  });

  test("transitive dependency bins are linked when trusted via trustedDependencies", async () => {
    const packageDir = await setup({
      name: "app",
      version: "1.0.0",
      dependencies: { "dep-on-shadow-bin": "1.0.0" },
      trustedDependencies: ["shadow-bin"],
    });

    await install(packageDir);

    expect(binEntries(packageDir)).toEqual(["git", "shadow-bin-tool"]);
  });

  test("workspace direct dependency bins are linked into root .bin", async () => {
    const dir = tempDir("bin-trust-ws-", {
      "bunfig.toml": `[install]\nregistry = "${registryUrl}"\ncache = false\nlinker = "hoisted"\n`,
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "packages/pkg1/package.json": JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: { "shadow-bin": "1.0.0" },
      }),
    });
    const packageDir = String(dir);

    await install(packageDir);

    // shadow-bin is a direct dependency of workspace pkg1, so its bins link
    // into root .bin (where it was hoisted).
    expect(binEntries(packageDir)).toEqual(["git", "shadow-bin-tool"]);
  });

  test.skipIf(isWindows)(
    "bun run does not execute a shadowed tool from an untrusted transitive dependency",
    async () => {
      const packageDir = await setup({
        name: "app",
        version: "1.0.0",
        dependencies: { "dep-on-shadow-bin": "1.0.0" },
        scripts: { rev: "git --version" },
      });

      await install(packageDir);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "rev"],
        cwd: packageDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("SHADOW-EXECUTED");
      expect(stdout).not.toContain("SHADOW-EXECUTED");
      // git from $PATH ran, not the planted shadow.
      expect(stdout).toContain("git version");
      expect(exitCode).toBe(0);
    },
  );
});
