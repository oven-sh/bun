// An install killed while it is linking a package out of the cache must not
// leave a partial copy at the package's final path: both linkers treat an
// installed package.json as "this package is installed", so a truncated
// directory that already received its package.json is reported as up to date
// by every later `bun install`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Enough files that the kill below lands long before linking finishes, even
// when the test process is slow to notice that linking has started.
const DIR_COUNT = 32;
const FILES_PER_DIR = 64;

const archiveEntries: Record<string, string> = {
  "package/package.json": JSON.stringify({ name: "many-files", version: "1.0.0" }),
};
for (let dir = 0; dir < DIR_COUNT; dir++) {
  for (let file = 0; file < FILES_PER_DIR; file++) {
    archiveEntries[`package/d${dir}/f${file}.js`] = `module.exports = ${dir * FILES_PER_DIR + file};\n`;
  }
}

const expectedTree = new Set<string>();
for (const entry of Object.keys(archiveEntries)) {
  const relative = entry.slice("package/".length);
  const slash = relative.indexOf("/");
  if (slash !== -1) expectedTree.add(relative.slice(0, slash));
  expectedTree.add(relative);
}

// Summarized rather than compared entry by entry so a failure reads as a few
// lines instead of a diff of thousands of paths.
function compareWithExpectedTree(packageDir: string) {
  const actual = new Set((readdirSync(packageDir, { recursive: true }) as string[]).map(p => p.replaceAll("\\", "/")));
  const missing = [...expectedTree].filter(entry => !actual.has(entry));
  const unexpected = [...actual].filter(entry => !expectedTree.has(entry));
  return {
    entries: actual.size,
    missing: missing.length,
    firstMissing: missing.slice(0, 3),
    unexpected,
  };
}
const completeTree = { entries: expectedTree.size, missing: 0, firstMissing: [], unexpected: [] };

function serveRegistry(tgz: Uint8Array) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      switch (pathname) {
        case "/many-files":
          return Response.json({
            name: "many-files",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "many-files",
                version: "1.0.0",
                dist: { tarball: `${origin}/many-files-1.0.0.tgz` },
              },
            },
          });
        case "/many-files-1.0.0.tgz":
          return new Response(tgz);
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
}

async function install(cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Kills `bun install` as soon as anything for the package shows up in the
// directory the package is installed into, i.e. while its files are being
// linked out of the cache.
async function installAndKillWhileLinking(cwd: string, packageParentDir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  let exited = false;
  proc.exited.then(() => (exited = true));
  let killed = false;
  while (!exited && !killed) {
    if (existsSync(packageParentDir) && readdirSync(packageParentDir).some(name => name.includes("many-files"))) {
      proc.kill("SIGKILL");
      killed = true;
    } else {
      await Bun.sleep(0);
    }
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  // Without a kill the install finished (or died) before anything showed up;
  // a finished install is still a valid starting point, a failed one is not.
  if (!killed) {
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  }
}

const packageDirs = {
  hoisted: (root: string) => join(root, "node_modules", "many-files"),
  isolated: (root: string) => join(root, "node_modules", ".bun", "many-files@1.0.0", "node_modules", "many-files"),
};

// Not concurrent: the kill has to land while the package is still being
// linked, which a poll loop sharing the event loop with another test's
// assertions cannot guarantee.
for (const [linker, packageDir] of Object.entries(packageDirs)) {
  test(`${linker} linker: a package whose install was interrupted is installed again`, async () => {
    const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
    using registry = serveRegistry(tgz);
    using dir = tempDir(`interrupted-install-${linker}`, {
      "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
    });
    const root = String(dir);
    const installed = packageDir(root);
    const installedParent = join(installed, "..");

    // Warm the cache and record what a finished install looks like.
    const warm = await install(root);
    expect(warm.stderr).not.toContain("error");
    expect(warm.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    const finishedParentListing = readdirSync(installedParent).sort();
    rmSync(join(root, "node_modules"), { recursive: true });

    await installAndKillWhileLinking(root, installedParent);
    // Either the package is not at its final path yet, or all of it is.
    if (existsSync(installed)) {
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    }

    const repaired = await install(root);
    expect(repaired.stderr).not.toContain("error");
    expect(repaired.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    expect(readdirSync(installedParent).sort()).toEqual(finishedParentListing);
  });
}
