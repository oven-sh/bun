import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
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

// Minimal ustar + gzip so the local registry can serve real tarballs without
// a binary fixture. All entry names stay under the 100-byte ustar limit.
function tarEntry(name: string, body: Buffer): Buffer[] {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";
  header.write(octal(0o644, 8), 100); // mode
  header.write(octal(0, 8), 108); // uid
  header.write(octal(0, 8), 116); // gid
  header.write(octal(body.length, 12), 124); // size
  header.write(octal(0, 12), 136); // mtime
  header.fill(" ", 148, 156); // checksum placeholder
  header.write("0", 156); // regular file
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(octal(sum, 8), 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return [header, body, pad];
}

function buildTarball(files: Record<string, string>): { tgz: Buffer; shasum: string; integrity: string } {
  const blocks: Buffer[] = [];
  for (const [path, body] of Object.entries(files)) {
    blocks.push(...tarEntry(`package/${path}`, Buffer.from(body)));
  }
  blocks.push(Buffer.alloc(1024, 0)); // end-of-archive
  const tgz = gzipSync(Buffer.concat(blocks));
  return {
    tgz,
    shasum: createHash("sha1").update(tgz).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(tgz).digest("base64"),
  };
}

// Prebuilt native addons locate sibling shared libraries with
// $ORIGIN-relative RPATH entries such as "$ORIGIN/../../lib-pkg/lib", which
// assume a node_modules layout. Auto-install runs packages out of flat cache
// dirs ("name@version@@@N"), so every candidate used to miss (#40269).
// Packages with a .node file must resolve to a node_modules-shaped view
// whose siblings link to their dependencies' cache dirs.
//
// The scoped case mirrors sharp's real shape: @img/sharp-linux-x64 reaches
// @img/sharp-libvips-linux-x64 through optionalDependencies, and its RPATH
// walk lands in the scope dir (node_modules/@img).
for (const { label, addonName, libName, depField } of [
  { label: "unscoped dependency", addonName: "addon-pkg", libName: "lib-pkg", depField: "dependencies" },
  {
    label: "scoped optionalDependency",
    addonName: "@img/addon-pkg",
    libName: "@img/lib-pkg",
    depField: "optionalDependencies",
  },
]) {
  test.skipIf(isWindows)(
    `auto-install native addon packages resolve $ORIGIN-shaped RPATH siblings (${label})`,
    async () => {
      // The RPATH sibling lookup uses the last path component: from the addon's
      // lib dir, "$ORIGIN/../.." is node_modules (or node_modules/@scope), and
      // the sibling sits there under its unscoped basename.
      const libBase = libName.split("/").pop()!;
      const tarballs: Record<string, { tgz: Buffer; shasum: string; integrity: string }> = {
        [libName]: buildTarball({
          "package.json": JSON.stringify({ name: libName, version: "1.2.3" }),
          "lib/libfake.so": "not really a shared library\n",
        }),
        [addonName]: buildTarball({
          "package.json": JSON.stringify({
            name: addonName,
            version: "1.0.0",
            main: "index.js",
            [depField]: { [libName]: "^1.2.0" },
          }),
          "index.js": "module.exports = require.resolve('./lib/fake.node');\n",
          "lib/fake.node": "not really a native addon\n",
        }),
      };
      const versions: Record<string, string> = { [libName]: "1.2.3", [addonName]: "1.0.0" };

      using registry = Bun.serve({
        port: 0,
        fetch(req) {
          const pathname = decodeURIComponent(new URL(req.url).pathname);
          const tgz = pathname.match(/^\/tarballs\/(.+)\.tgz$/);
          if (tgz) {
            const name = tgz[1];
            if (!tarballs[name]) return new Response("not found", { status: 404 });
            return new Response(tarballs[name].tgz, {
              headers: { "content-type": "application/octet-stream" },
            });
          }
          const name = pathname.slice(1);
          if (!tarballs[name]) return new Response("not found", { status: 404 });
          const version = versions[name];
          const pkg: Record<string, unknown> = { name, version };
          if (name === addonName) pkg[depField] = { [libName]: "^1.2.0" };
          pkg.dist = {
            shasum: tarballs[name].shasum,
            integrity: tarballs[name].integrity,
            tarball: `http://127.0.0.1:${registry.port}/tarballs/${name}.tgz`,
          };
          return Response.json({
            name,
            "dist-tags": { latest: version },
            versions: { [version]: pkg },
          });
        },
      });

      using dir = tempDir("autoinstall-addon-links", {
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
        "check.js": `
        const fs = require("fs");
        const path = require("path");
        const addonPath = require(${JSON.stringify(addonName)});
        const origin = path.dirname(fs.realpathSync(addonPath));
        // The same walk the dynamic linker does for the RPATH entry
        // "$ORIGIN/../../${libBase}/lib": plain string concatenation, so the
        // kernel resolves ".." through the real parent dirs, exactly like
        // dlopen. No path.join, which would collapse ".." textually.
        const found = fs.existsSync(origin + "/../../${libBase}/lib/libfake.so");
        const shaped = origin.includes("/node_modules/" + ${JSON.stringify(addonName)} + "/");
        console.log(JSON.stringify({ found, shaped }));
      `,
      });
      const env = {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
      };

      async function runCheck(script: string): Promise<{ found: boolean; shaped: boolean }> {
        await using proc = Bun.spawn({
          cmd: [bunExe(), script],
          cwd: String(dir),
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        return JSON.parse(stdout);
      }

      // First run populates the cache through the local registry. The addon view
      // is built during the addon's own resolve, so `shaped` is deterministic.
      // `found` is not asserted here: the library's extraction is asynchronous
      // and nothing in check.js awaits it.
      expect((await runCheck("check.js")).shaped).toBe(true);

      // Second run resolves from the warm cache with no lockfile edge for the
      // library (the layout every pre-existing cache has), which exercises the
      // disk-cache fallback for the sibling symlink.
      expect(await runCheck("check.js")).toEqual({ found: true, shaped: true });

      // Third run: drop the view. A warm cache must rebuild it and recreate the
      // sibling symlink from scratch, with no leftover state from the first run.
      rmSync(join(String(dir), ".bun-cache", ".addon-links"), { recursive: true, force: true });
      expect(await runCheck("check.js")).toEqual({ found: true, shaped: true });

      // A skip marker on the addon would disable the view permanently, so the
      // detection must never write one for a package with a .node file.
      const markerDir = join(String(dir), ".bun-cache", ".addon-links", ...addonName.split("/").slice(0, -1));
      const addonBase = addonName.split("/").pop()!;
      const storeEntries = readdirSync(markerDir);
      expect(storeEntries.some(f => f.startsWith(`${addonBase}@`) && f.endsWith(".skip"))).toBe(false);
    },
  );
}

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
