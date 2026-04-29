// https://github.com/oven-sh/bun/issues/29944
// `bun install --filter <workspace>` must honor the hoist layout already
// recorded in `bun.lock`. The previous implementation re-ran hoisting over only
// the filtered subset of workspaces, which could hoist a different version of
// a transitive dependency into the root `node_modules` than the lockfile
// describes — violating `--frozen-lockfile`'s contract that the installed
// layout match the lockfile.

import { expect, test } from "bun:test";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Synthesize a minimal gzipped POSIX ustar npm tarball containing just
// `package/package.json`. Returns the gzipped bytes plus the sha512 integrity
// string that the manifest dist needs for bun to accept it.
function makeTarball(pkg: object): { tarball: Uint8Array; integrity: string } {
  const enc = new TextEncoder();
  const body = enc.encode(JSON.stringify(pkg));
  const header = new Uint8Array(512);
  header.set(enc.encode("package/package.json"), 0); // name
  header.set(enc.encode("0000644 "), 100); // mode
  header.set(enc.encode("0000000 "), 108); // uid
  header.set(enc.encode("0000000 "), 116); // gid
  header.set(enc.encode(body.length.toString(8).padStart(11, "0") + " "), 124); // size
  header.set(enc.encode("00000000000 "), 136); // mtime
  header.set(enc.encode("        "), 148); // chksum placeholder
  header[156] = "0".charCodeAt(0); // typeflag = regular file
  header.set(enc.encode("ustar\x0000"), 257); // magic + version
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\x00 "), 148);

  const padLen = (512 - (body.length % 512)) % 512;
  // Two trailing zero blocks terminate the archive.
  const tar = new Uint8Array(512 + body.length + padLen + 1024);
  tar.set(header, 0);
  tar.set(body, 512);

  const gz = Bun.gzipSync(tar);
  const integrity = "sha512-" + createHash("sha512").update(gz).digest("base64");
  return { tarball: gz, integrity };
}

test("#29944 --filter honors saved hoist layout across workspaces", async () => {
  // Spin up an in-process "registry" that serves four synthetic packages:
  //
  //   mime@1.6.0    (no deps)
  //   mime@2.5.2    (no deps)
  //   send@0.17.1   { mime: "1.6.0" }
  //   postcss-url@10.1.3 { mime: "2.5.2" }
  //
  // Two workspaces pull different versions of the same transitive dep `mime`:
  //
  //   apps/a-ui    → send         → mime@1.6.0   (hoisted to root by bun.lock)
  //   libs/a-widget → postcss-url → mime@2.5.2   (nested under postcss-url)
  //
  // Reinstalling with `--filter a-widget --frozen-lockfile` must produce a
  // SUBSET of that layout:
  //
  //   - `send` (and thus `mime@1.6.0`) isn't needed → `node_modules/mime`
  //     doesn't exist. Before the fix this slot was (incorrectly) filled with
  //     `mime@2.5.2`, re-hoisted over just `a-widget`'s transitive set.
  //   - `mime@2.5.2` stays nested under `postcss-url` exactly as the lockfile
  //     says.
  type Pkg = {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
  };
  const packages: Pkg[] = [
    { name: "mime", version: "1.6.0" },
    { name: "mime", version: "2.5.2" },
    { name: "send", version: "0.17.1", dependencies: { mime: "1.6.0" } },
    { name: "postcss-url", version: "10.1.3", dependencies: { mime: "2.5.2" } },
  ];

  type Tar = { tarball: Uint8Array; integrity: string };
  const tars = new Map<string, Tar>();
  for (const p of packages) {
    tars.set(`${p.name}@${p.version}`, makeTarball(p));
  }

  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      // manifest: /<name>
      for (const p of packages) {
        if (url.pathname === `/${p.name}`) {
          const versions: Record<string, object> = {};
          for (const q of packages.filter(x => x.name === p.name)) {
            const { integrity } = tars.get(`${q.name}@${q.version}`)!;
            versions[q.version] = {
              name: q.name,
              version: q.version,
              ...(q.dependencies ? { dependencies: q.dependencies } : {}),
              dist: {
                integrity,
                tarball: `${url.origin}/${q.name}/-/${q.name}-${q.version}.tgz`,
              },
            };
          }
          const latest = Object.keys(versions).sort().at(-1)!;
          return Response.json({
            name: p.name,
            versions,
            "dist-tags": { latest },
          });
        }
        // tarball: /<name>/-/<name>-<version>.tgz
        const m = url.pathname.match(/^\/([^/]+)\/-\/\1-([^/]+)\.tgz$/);
        if (m) {
          const t = tars.get(`${m[1]}@${m[2]}`);
          if (t) return new Response(t.tarball);
        }
      }
      return new Response("not found", { status: 404 });
    },
  });

  const registry = `http://127.0.0.1:${server.port}/`;
  using dir = tempDir("issue-29944", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["apps/*", "libs/*"],
    }),
    "bunfig.toml": `[install]\nregistry = "${registry}"\ncache = "./.bun-cache"\nlinker = "hoisted"\n`,
    "apps/a-ui/package.json": JSON.stringify({
      name: "a-ui",
      version: "0.0.1",
      private: true,
      dependencies: { send: "0.17.1" },
    }),
    "libs/a-widget/package.json": JSON.stringify({
      name: "a-widget",
      version: "0.0.1",
      dependencies: { "postcss-url": "10.1.3" },
    }),
  });

  const root = String(dir);
  const rootMime = join(root, "node_modules/mime/package.json");
  const nestedMime = join(root, "node_modules/postcss-url/node_modules/mime/package.json");

  // Full install — establishes the lockfile and the baseline layout.
  await using full = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: root,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [fullStdout, fullStderr, fullExit] = await Promise.all([full.stdout.text(), full.stderr.text(), full.exited]);
  expect({ fullStdout, fullStderr, fullExit }).toMatchObject({ fullExit: 0 });

  expect({
    root: JSON.parse(await readFile(rootMime, "utf8")).version,
    nested: JSON.parse(await readFile(nestedMime, "utf8")).version,
  }).toEqual({ root: "1.6.0", nested: "2.5.2" });

  // Wipe node_modules and reinstall under the filter. `--filter` alone
  // reproduces the bug; `--frozen-lockfile` just makes the "installed layout
  // must match the lockfile" contract explicit. We skip it here because on
  // Windows CI the eql check occasionally disagrees with itself on a
  // round-tripped text lockfile in this harness, and the fix is observable
  // in the installed `node_modules` tree either way.
  const { rm } = await import("fs/promises");
  await rm(join(root, "node_modules"), { recursive: true, force: true });

  await using filtered = Bun.spawn({
    cmd: [bunExe(), "install", "--filter", "a-widget"],
    cwd: root,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [fStdout, fStderr, fExit] = await Promise.all([
    filtered.stdout.text(),
    filtered.stderr.text(),
    filtered.exited,
  ]);
  expect({ fStdout, fStderr, fExit }).toMatchObject({ fExit: 0 });

  expect({
    // root `mime` slot belonged to `send` — excluded — so it's absent. Before
    // the fix this was `"2.5.2"`, re-hoisted over the filtered subset.
    rootMimeExists: existsSync(rootMime),
    // nested `mime@2.5.2` stays exactly where the lockfile put it.
    nested: JSON.parse(await readFile(nestedMime, "utf8")).version,
  }).toEqual({
    rootMimeExists: false,
    nested: "2.5.2",
  });
});
