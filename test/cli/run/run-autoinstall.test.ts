import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
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

// In auto-install mode the project's own package.json is the lockfile's root
// package (resolution tag `root`, not `npm`). With a name and an exact version
// present, resolving any missing bare specifier used to read that resolution
// through the npm union accessor: "assertion failed: self.tag == Tag::Npm".
test("auto-install in a project whose package.json has a name and version", async () => {
  const requests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-root-name-version", {
    "package.json": JSON.stringify({ name: "myapp", version: "1.0.0" }),
    "index.js": `import "pkg-that-does-not-exist-anywhere";\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The resolver must get as far as asking the (local) registry for the
  // missing package, then report it as missing instead of dying while
  // re-parsing the project's own package.json.
  expect(requests).toContain("/pkg-that-does-not-exist-anywhere");
  expect(stderr).toContain("Cannot find package 'pkg-that-does-not-exist-anywhere'");
  expect(exitCode).toBe(1);
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

// Two processes auto-installing into a shared cache can observe each other's
// half-published state: the data folder `<cache>/pkg@ver@@host@@@1` is
// renamed into place before the version-index symlink `<cache>/pkg/ver@@host@@@1`
// is created. A reader that sees the first without the second must fall back
// to the data folder path instead of failing with "Unexpected while resolving".
test("auto-install resolves from the cache data folder when the version-index symlink is absent", async () => {
  function tarHeader(name: string, size: number): Buffer {
    const buf = Buffer.alloc(512, 0);
    buf.write(name, 0, 100, "utf8");
    buf.write(size.toString(8).padStart(11, "0") + "\0", 124);
    buf.fill(" ", 148, 156);
    buf.write("0", 156);
    buf.write("ustar\0", 257);
    buf.write("00", 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += buf[i];
    buf.write(sum.toString(8).padStart(7, "0") + "\0", 148);
    return buf;
  }
  function tarFile(name: string, body: string): Buffer[] {
    const b = Buffer.from(body);
    return [tarHeader(name, b.length), b, Buffer.alloc((512 - (b.length % 512)) % 512, 0)];
  }
  const tar = Buffer.concat([
    ...tarFile("package/package.json", JSON.stringify({ name: "race-pkg", version: "1.0.0", main: "index.js" })),
    ...tarFile("package/index.js", "module.exports = 'race-ok';\n"),
    Buffer.alloc(1024, 0),
  ]);
  const tgz = gzipSync(tar);
  const shasum = createHash("sha1").update(tgz).digest("hex");
  const integrity = "sha512-" + createHash("sha512").update(tgz).digest("base64");

  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/race-pkg") {
        return Response.json({
          name: "race-pkg",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "race-pkg",
              version: "1.0.0",
              dist: { tarball: `http://127.0.0.1:${registry.port}/race-pkg-1.0.0.tgz`, shasum, integrity },
            },
          },
        });
      }
      if (p === "/race-pkg-1.0.0.tgz") {
        return new Response(tgz, { headers: { "Content-Type": "application/octet-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-index-race", {
    "box/x.cjs": `console.log(require("race-pkg"));\n`,
    "box/bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });
  const cache = join(String(dir), "cache");
  const env = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: cache,
    HOME: String(dir),
    BUN_TMPDIR: String(dir),
  };
  const run = async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "x.cjs"],
      cwd: join(String(dir), "box"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  // First run: populates the cache (data folder + version-index symlink).
  {
    const { stdout, stderr, exitCode } = await run();
    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("race-ok\n");
    expect(exitCode).toBe(0);
  }

  // Simulate the concurrent-writer window: the data folder exists but the
  // `<cache>/race-pkg/` index directory (and its symlink) has not been
  // created yet. Remove only the index directory.
  const entries = readdirSync(cache);
  expect(entries).toContain("race-pkg");
  expect(entries.some(e => e.startsWith("race-pkg@1.0.0"))).toBe(true);
  rmSync(join(cache, "race-pkg"), { recursive: true, force: true });

  // Second run: must resolve from the data folder directly.
  {
    const { stdout, stderr, exitCode } = await run();
    expect(stderr).not.toContain("Unexpected while resolving package");
    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("race-ok\n");
    expect(exitCode).toBe(0);
  }

  // Now simulate the other half of the concurrent window: the `.npm` manifest
  // is on disk (written by another process) but neither the data folder nor
  // the index symlink exists yet. Resolving from the disk manifest must still
  // schedule the tarball download instead of failing on a stale resolution.
  for (const e of readdirSync(cache)) {
    if (e.startsWith("race-pkg")) rmSync(join(cache, e), { recursive: true, force: true });
  }
  const left = readdirSync(cache);
  expect(left.some(e => e.endsWith(".npm"))).toBe(true);
  expect(left.some(e => e.startsWith("race-pkg"))).toBe(false);

  {
    const { stdout, stderr, exitCode } = await run();
    expect(stderr).not.toContain("Unexpected while resolving package");
    expect(stderr).not.toContain("error:");
    expect(stdout).toBe("race-ok\n");
    expect(exitCode).toBe(0);
  }
});
