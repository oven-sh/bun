// Some filesystems (FUSE, NFS, XFS formatted with ftype=0) do not fill in
// d_type, so every readdir entry comes back as DT_UNKNOWN. The package manager
// commands must behave as they do elsewhere; `dtUnknownReaddir` (harness)
// simulates such a filesystem with an LD_PRELOAD shim.
import { readTarball } from "bun:internal-for-testing";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunExe, dtUnknownReaddir, tempDir } from "harness";
import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

let env: NodeJS.Dict<string>;

// Compiles the shim; a C compiler on a busy CI machine can take longer than the
// default hook timeout.
beforeAll(async () => {
  if (dtUnknownReaddir.available) env = await dtUnknownReaddir.env();
}, 30_000);

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(dtUnknownReaddir.marker);
  expect({ stdout, stderr, exitCode }).toMatchObject({ stderr: expect.not.stringContaining("error:"), exitCode: 0 });
}

function packedPaths(tarball: string): string[] {
  return readTarball(tarball)
    .entries.map((entry: { pathname: string }) => entry.pathname)
    .sort();
}

describe.skipIf(!dtUnknownReaddir.available)("pack on a filesystem whose readdir reports DT_UNKNOWN", () => {
  test.concurrent("packs the project tree", async () => {
    using dir = tempDir("dt-unknown-tree", {
      "package.json": JSON.stringify({ name: "dt-unknown-tree", version: "1.0.0" }),
      "index.js": "",
      "lib/a.js": "",
      "lib/nested/b.js": "",
      // `out/` only ignores directories, so it needs the entry's kind: the
      // `out` directory is ignored, the `lib/out` file is not.
      ".npmignore": "out/\n",
      "out/c.js": "",
      "lib/out": "",
    });
    // Symlinks are never packed; resolving the kind with lstat has to keep that.
    await symlink("index.js", join(String(dir), "link.js"));

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-tree-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/lib/a.js",
      "package/lib/nested/b.js",
      "package/lib/out",
      "package/package.json",
    ]);
  });

  test.concurrent('packs what "files" selects', async () => {
    using dir = tempDir("dt-unknown-files", {
      "package.json": JSON.stringify({
        name: "dt-unknown-files",
        version: "1.0.0",
        files: ["index.js", "lib", "!lib/internal/"],
      }),
      "index.js": "",
      "excluded.js": "",
      "lib/a.js": "",
      "lib/nested/b.js": "",
      "lib/internal/c.js": "",
    });
    await symlink("a.js", join(String(dir), "lib", "link.js"));

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-files-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/lib/a.js",
      "package/lib/nested/b.js",
      "package/package.json",
    ]);
  });

  test.concurrent("packs bundledDependencies", async () => {
    using dir = tempDir("dt-unknown-bundled", {
      "package.json": JSON.stringify({
        name: "dt-unknown-bundled",
        version: "1.0.0",
        dependencies: { "dep": "1.0.0", "@scope/dep": "1.0.0", "not-bundled": "1.0.0" },
        bundledDependencies: ["dep", "@scope/dep"],
      }),
      "index.js": "",
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/lib/index.js": "",
      "node_modules/@scope/dep/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }),
      "node_modules/@scope/dep/index.js": "",
      "node_modules/not-bundled/package.json": JSON.stringify({ name: "not-bundled", version: "1.0.0" }),
    });

    await run(String(dir), "pm", "pack");

    expect(packedPaths(join(String(dir), "dt-unknown-bundled-1.0.0.tgz"))).toEqual([
      "package/index.js",
      "package/node_modules/@scope/dep/index.js",
      "package/node_modules/@scope/dep/package.json",
      "package/node_modules/dep/lib/index.js",
      "package/node_modules/dep/package.json",
      "package/package.json",
    ]);
  });

  test.concurrent('publish packs the tree, walks "directories.bin" and finds the readme', async () => {
    let captured: any;
    using registry = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "PUT") captured = await req.json();
        return new Response("OK");
      },
    });
    using dir = tempDir("dt-unknown-publish", {
      "bunfig.toml": `[install]\ncache = false\nregistry = { url = "http://localhost:${registry.port}", token = "unused" }\n`,
      "package.json": JSON.stringify({
        name: "dt-unknown-publish",
        version: "1.0.0",
        directories: { bin: "bins" },
      }),
      "README.md": "# dt-unknown-publish",
      "index.js": "",
      "bins/a.js": "",
      "bins/more/b.js": "",
    });

    await run(String(dir), "publish");

    expect(captured.versions["1.0.0"]).toMatchObject({
      bin: { "a.js": "bins/a.js", "more": "bins/more", "b.js": "bins/more/b.js" },
      readme: "# dt-unknown-publish",
      readmeFilename: "README.md",
    });

    const attachment: { data: string } = Object.values(captured._attachments)[0] as any;
    const tarball = join(String(dir), "published.tgz");
    await writeFile(tarball, Buffer.from(attachment.data, "base64"));
    expect(packedPaths(tarball)).toEqual([
      "package/README.md",
      "package/bins/a.js",
      "package/bins/more/b.js",
      "package/index.js",
      "package/package.json",
    ]);
  });
});
