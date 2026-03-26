import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { existsSync, readlinkSync } from "fs";

// Regression test for https://github.com/oven-sh/bun/issues/28597
// When a package has bin entries pointing into node_modules/ (e.g. a wrapper
// package), and the dependency gets hoisted, global bin shims must still be created.

test("global bin shims are created when bin target points into hoisted node_modules", async () => {
  using dir = tempDir("issue-28597", {});
  const dirStr = String(dir);

  // Create inner package tarball content
  const innerPkgJson = JSON.stringify({
    name: "@inner-scope/inner-bin",
    version: "1.0.0",
    bin: { "inner-bin": "bin.js" },
  });
  const innerBinJs = '#!/usr/bin/env node\nconsole.log("inner-bin");';

  // Create wrapper package tarball content
  // Key: bin entries point into node_modules/ subdirectory
  const wrapperPkgJson = JSON.stringify({
    name: "wrapper-bin",
    version: "1.0.0",
    dependencies: { "@inner-scope/inner-bin": "1.0.0" },
    bin: {
      "wrapper-tool": "node_modules/@inner-scope/inner-bin/bin.js",
      "wrapper-alias": "node_modules/@inner-scope/inner-bin/bin.js",
    },
  });

  // Build tarballs in-memory using Bun.spawn + tar
  const innerTarDir = join(dirStr, "inner-tar", "package");
  const wrapperTarDir = join(dirStr, "wrapper-tar", "package");

  const fs = await import("fs");
  fs.mkdirSync(innerTarDir, { recursive: true });
  fs.writeFileSync(join(innerTarDir, "package.json"), innerPkgJson);
  fs.writeFileSync(join(innerTarDir, "bin.js"), innerBinJs);
  fs.chmodSync(join(innerTarDir, "bin.js"), 0o755);

  fs.mkdirSync(wrapperTarDir, { recursive: true });
  fs.writeFileSync(join(wrapperTarDir, "package.json"), wrapperPkgJson);

  // Create tarballs
  await Bun.spawn({ cmd: ["tar", "czf", join(dirStr, "inner-bin-1.0.0.tgz"), "-C", join(dirStr, "inner-tar"), "package"], stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn({ cmd: ["tar", "czf", join(dirStr, "wrapper-bin-1.0.0.tgz"), "-C", join(dirStr, "wrapper-tar"), "package"], stdout: "ignore", stderr: "ignore" }).exited;

  // Compute real checksums for the tarballs
  const crypto = await import("crypto");
  const innerTgz = fs.readFileSync(join(dirStr, "inner-bin-1.0.0.tgz"));
  const wrapperTgz = fs.readFileSync(join(dirStr, "wrapper-bin-1.0.0.tgz"));
  const innerShasum = crypto.createHash("sha1").update(innerTgz).digest("hex");
  const wrapperShasum = crypto.createHash("sha1").update(wrapperTgz).digest("hex");

  // Serve packages via a simple HTTP registry
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname === "/wrapper-bin") {
        return Response.json({
          name: "wrapper-bin",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "wrapper-bin",
              version: "1.0.0",
              dependencies: { "@inner-scope/inner-bin": "1.0.0" },
              bin: {
                "wrapper-tool": "node_modules/@inner-scope/inner-bin/bin.js",
                "wrapper-alias": "node_modules/@inner-scope/inner-bin/bin.js",
              },
              dist: {
                tarball: `http://localhost:${server.port}/wrapper-bin-1.0.0.tgz`,
                shasum: wrapperShasum,
              },
            },
          },
        });
      }

      if (pathname === "/@inner-scope%2finner-bin" || pathname === "/@inner-scope/inner-bin") {
        return Response.json({
          name: "@inner-scope/inner-bin",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "@inner-scope/inner-bin",
              version: "1.0.0",
              bin: { "inner-bin": "bin.js" },
              dist: {
                tarball: `http://localhost:${server.port}/inner-bin-1.0.0.tgz`,
                shasum: innerShasum,
              },
            },
          },
        });
      }

      if (pathname.endsWith(".tgz")) {
        const filename = pathname.slice(1); // strip leading /
        const filepath = join(dirStr, filename);
        if (existsSync(filepath)) {
          return new Response(Bun.file(filepath));
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const globalDir = join(dirStr, "global-install");
  const globalBinDir = join(dirStr, "global-bin");
  fs.mkdirSync(globalBinDir, { recursive: true });

  const bunfig = join(dirStr, "bunfig.toml");
  fs.writeFileSync(
    bunfig,
    `[install]\ncache = false\nregistry = "http://localhost:${server.port}/"\nglobalBinDir = "${globalBinDir.replace(/\\/g, "\\\\")}"\n`,
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "-g", `--config=${bunfig}`, "wrapper-bin"],
    cwd: dirStr,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      BUN_INSTALL: globalDir,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(stdout).toContain("wrapper-bin");
  expect(exitCode).toBe(0);

  // The global bin shims should exist despite the bin targets pointing
  // into node_modules/ (hoisted dependency)
  if (process.platform === "win32") {
    expect(existsSync(join(globalBinDir, "wrapper-tool.exe"))).toBeTrue();
    expect(existsSync(join(globalBinDir, "wrapper-alias.exe"))).toBeTrue();
  } else {
    expect(existsSync(join(globalBinDir, "wrapper-tool"))).toBeTrue();
    expect(existsSync(join(globalBinDir, "wrapper-alias"))).toBeTrue();

    // Verify symlinks resolve to the hoisted location
    const target = readlinkSync(join(globalBinDir, "wrapper-tool"));
    expect(target).toContain(join("@inner-scope", "inner-bin", "bin.js"));
  }
});
