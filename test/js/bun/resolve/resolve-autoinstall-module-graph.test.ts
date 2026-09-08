import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// An ES module imports a node builtin and then a bare package that auto-install
// has to fetch (no node_modules up the tree, cold install cache). The builtin's
// fetch settles at once, so its load steps are queued microtasks while the
// resolver waits on the registry for the bare specifier. If that wait runs
// them, the builtin's edge of the importer completes underneath JSC's
// HostLoadImportedModule call for the package. JSC reads that growth of the
// importer's [[LoadedModules]] as "the package loaded synchronously" and does
// not watch the package's load for errors: debug builds assert in
// JSModuleLoader::innerModuleLoading ("needsErrorReaction != ..."), release
// builds lose a later load error of the package and the entry never runs.
async function runWithAutoInstalledPackage(files: Record<string, string>, entry: string) {
  const name = "autoinstalled-pkg";
  const tarball = await new Bun.Archive(
    {
      "package/package.json": JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }),
      ...Object.fromEntries(Object.entries(files).map(([file, contents]) => [`package/${file}`, contents])),
    },
    { compress: "gzip" },
  ).bytes();

  const requests: string[] = [];
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { origin, pathname } = new URL(req.url);
      requests.push(pathname);
      if (pathname === `/${name}-1.0.0.tgz`) return new Response(tarball);
      if (pathname !== `/${name}`) return new Response("not found", { status: 404 });
      // Make sure the resolver actually parks in its wait loop at least once.
      await Bun.sleep(50);
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: `${origin}/${name}-1.0.0.tgz` } } },
      });
    },
  });

  using dir = tempDir("resolve-autoinstall-module-graph", { "entry.mjs": entry });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=auto", "entry.mjs"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
      BUN_CONFIG_REGISTRY: server.url.href,
      NPM_CONFIG_REGISTRY: server.url.href,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(requests).toEqual([`/${name}`, `/${name}-1.0.0.tgz`]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent("auto-installed package imported after a builtin loads", async () => {
  const { stdout, stderr, exitCode } = await runWithAutoInstalledPackage(
    { "index.js": `export const value = 42;\n` },
    `import "node:http2";\nimport { value } from "autoinstalled-pkg";\nconsole.log("value", value);\n`,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("value 42\n");
  expect(exitCode).toBe(0);
});

test.concurrent("load error of an auto-installed package imported after a builtin is reported", async () => {
  const { stdout, stderr, exitCode, signalCode } = await runWithAutoInstalledPackage(
    { "index.js": `export const value = ;\n` },
    `import "node:http2";\nimport { value } from "autoinstalled-pkg";\nconsole.log("value", value);\n`,
  );
  expect(stdout).toBe("");
  expect(stderr).toContain("error: Unexpected ;");
  expect(stderr).toContain("index.js:1:22");
  expect(signalCode).toBeNull();
  expect(exitCode).toBe(1);
});
