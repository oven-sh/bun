// Which version `bun install` picks from a registry manifest for a given
// range. The expected picks are what npm (npm-pick-manifest) installs from the
// same manifest: the `latest` dist-tag if it satisfies the range, a bare `*`
// means `latest`, otherwise the highest satisfying version with prereleases
// and releases ordered together.
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

type VersionSet = { versions: string[]; latest: string };

// Every package named `<set>-<anything>` serves the version list of `<set>`,
// so one install can resolve several ranges against the same manifest without
// the picks deduplicating against each other.
const sets: Record<string, VersionSet> = {
  // `latest` is behind the highest version (a maintained older line).
  latestlow: { versions: ["1.0.0", "1.5.0", "1.9.0", "2.0.0", "2.5.0", "3.0.0"], latest: "1.5.0" },
  // releases and prereleases interleaved.
  mixed: {
    versions: ["1.0.0", "1.0.1", "1.1.0", "1.2.0-alpha.1", "2.0.0-0", "2.0.0", "2.1.0-beta.3"],
    latest: "2.0.0",
  },
  // `latest` points at a prerelease.
  latestpre: { versions: ["1.0.0", "1.2.0", "2.0.0-beta.1"], latest: "2.0.0-beta.1" },
  // only prereleases were ever published.
  onlypre: { versions: ["1.0.0-alpha.1", "1.0.0-beta.1"], latest: "1.0.0-beta.1" },
};

function tarEntry(path: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(path, 0, 100);
  header.write("0000644\0", 100, 8);
  header.write("0000000\0", 108, 8);
  header.write("0000000\0", 116, 8);
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  header.write("00000000000\0", 136, 12);
  header.write("        ", 148, 8);
  header.write("0", 156, 1);
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  const padding = (512 - (body.length % 512)) % 512;
  return Buffer.concat([header, body, Buffer.alloc(padding)]);
}

function tarball(name: string, version: string): Buffer {
  const packageJson = Buffer.from(JSON.stringify({ name, version }));
  return Buffer.from(Bun.gzipSync(Buffer.concat([tarEntry("package/package.json", packageJson), Buffer.alloc(1024)])));
}

let server: Server;
let registryUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname);

      const tgz = pathname.match(/^\/([^/]+)\/-\/\1-(.+)\.tgz$/);
      if (tgz) {
        const [, name, version] = tgz;
        return new Response(tarball(name, version));
      }

      const name = pathname.slice(1);
      const set = sets[name.split("-")[0]];
      if (!set || name.includes("/")) {
        return new Response("{}", { status: 404 });
      }
      const versions: Record<string, object> = {};
      for (const version of set.versions) {
        versions[version] = {
          name,
          version,
          dist: { tarball: `${registryUrl}${name}/-/${name}-${version}.tgz` },
        };
      }
      return Response.json({ name, "dist-tags": { latest: set.latest }, versions });
    },
  });
  registryUrl = `http://localhost:${server.port}/`;
});

afterAll(() => {
  server.stop(true);
});

/**
 * Installs every `name: range` pair in one `bun install` and returns the
 * version that landed in node_modules for each name.
 */
async function install(dependencies: Record<string, string>) {
  using dir = tempDir("pick-version", {
    "package.json": JSON.stringify({ name: "app", version: "0.0.0", dependencies }),
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registryUrl}"\nsaveTextLockfile = false\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const picked: Record<string, string> = {};
  for (const name of Object.keys(dependencies)) {
    try {
      picked[name] = JSON.parse(readFileSync(join(String(dir), "node_modules", name, "package.json"), "utf8")).version;
    } catch {
      picked[name] = "(not installed)";
    }
  }
  return { picked, stderr, exitCode };
}

describe.concurrent("bun install picks the same version as npm", () => {
  test("latest dist-tag wins whenever it satisfies the range, prerelease ranges included", async () => {
    const { picked, stderr, exitCode } = await install({
      "latestlow-caret": "^1.0.0",
      "latestlow-caret-0": "^1.0.0-0",
      "latestlow-rc-floor": ">=1.0.0-rc.0 <2",
      "latestlow-union": "^1.0.0 || ^2.0.0",
      "latestlow-union-0": "^1.0.0 || ^2.0.0-0",
      "latestlow-gte-0": ">=1.0.0-0",
      // `latest` (1.5.0) does not satisfy these, so the highest satisfying version wins.
      "latestlow-caret-2": "^2.0.0",
      "latestlow-caret-2-0": "^2.0.0-0",
      "latestlow-exact-union": "1.0.0 || 2.0.0",
    });

    expect(picked).toEqual({
      "latestlow-caret": "1.5.0",
      "latestlow-caret-0": "1.5.0",
      "latestlow-rc-floor": "1.5.0",
      "latestlow-union": "1.5.0",
      "latestlow-union-0": "1.5.0",
      "latestlow-gte-0": "1.5.0",
      "latestlow-caret-2": "2.5.0",
      "latestlow-caret-2-0": "2.5.0",
      "latestlow-exact-union": "2.0.0",
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("highest satisfying version wins across releases and prereleases", async () => {
    const { picked, stderr, exitCode } = await install({
      "mixed-next-beta": "^1.0.0 || 2.1.0-beta.3",
      "mixed-next-beta-caret": "~1.0.0 || ^2.1.0-beta",
      "mixed-lte-pre": "<=2.0.0-0",
      "mixed-pre-ceiling": ">=1.0.0 <=1.2.0-beta.1",
      // no release satisfies: prerelease, same as before.
      "mixed-only-pre": ">1.1.0 <=2.0.0-0",
      // no prerelease in the range: releases only, `latest` (2.0.0) does not satisfy.
      "mixed-caret-1": "^1.0.0",
    });

    expect(picked).toEqual({
      "mixed-next-beta": "2.1.0-beta.3",
      "mixed-next-beta-caret": "2.1.0-beta.3",
      "mixed-lte-pre": "2.0.0-0",
      "mixed-pre-ceiling": "1.2.0-alpha.1",
      "mixed-only-pre": "2.0.0-0",
      "mixed-caret-1": "1.1.0",
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("a bare `*` resolves to the latest dist-tag, even a prerelease one", async () => {
    const { picked, stderr, exitCode } = await install({
      "latestpre-star": "*",
      "latestpre-empty": "",
      "latestpre-tag": "latest",
      // npm only special-cases the literal `*`; `x` stays a plain range that
      // excludes prereleases.
      "latestpre-x": "x",
      "onlypre-star": "*",
    });

    expect(picked).toEqual({
      "latestpre-star": "2.0.0-beta.1",
      "latestpre-empty": "2.0.0-beta.1",
      "latestpre-tag": "2.0.0-beta.1",
      "latestpre-x": "1.2.0",
      "onlypre-star": "1.0.0-beta.1",
    });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });
});
