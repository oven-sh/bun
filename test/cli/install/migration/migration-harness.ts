import fs from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir, tls } from "harness";
import net from "net";
import { dirname, join } from "path";
import { fixturePackages } from "registry";

/**
 * A YAML sequence under `key` in which each `&a` holds the one before it. No line is deep, but whoever follows the
 * last `*a` goes down `lines * levels` levels. Debug and ASAN builds have the stack for fewer levels in one line.
 * `sibling` is a flow node that follows the deep one inside each `&a`.
 */
export function yamlAliasChain(key: string, sibling?: string) {
  const [levels, lines] = isDebug || isASAN ? [300, 74] : [4000, 40];
  const deep = `${Buffer.alloc(levels, "[")}*a${Buffer.alloc(levels, "]")}`;
  const line = `  - &a ${sibling === undefined ? deep : `[${deep}, ${sibling}]`}\n`;
  return `${key}:\n  - &a [1]\n${Buffer.alloc(lines * line.length, line)}`;
}

export const ARBORIST = join(import.meta.dir, "npm-arborist");
export const arboristFixtures: { name: string; root?: string }[] = JSON.parse(
  fs.readFileSync(join(ARBORIST, "fixtures.json"), "utf8"),
);
// Port 1 refuses connections, so any accidental registry access fails the test.
export const OFFLINE_REGISTRY = "http://localhost:1/";

// pnpm-lock.yaml only says `hasBin`, so a migration asks the registry for the `bin` of each package.
// These are the ones registry.npmjs.org has for the versions in the pnpm fixtures.
const tsc = { tsc: "bin/tsc", tsserver: "bin/tsserver" };
const publishedBins: Record<string, Record<string, Record<string, string>>> = {
  eslint: { "8.56.0": { eslint: "bin/eslint.js" } },
  "loose-envify": { "1.4.0": { "loose-envify": "cli.js" } },
  next: { "14.0.4": { next: "dist/bin/next" } },
  nodemon: { "3.0.2": { nodemon: "bin/nodemon.js" } },
  prettier: { "3.1.1": { prettier: "bin/prettier.cjs" } },
  turbo: { "1.11.2": { turbo: "bin/turbo" } },
  typescript: { "4.9.5": tsc, "5.3.3": tsc },
  vitest: { "1.1.3": { vitest: "vitest.mjs" } },
};

/**
 * Stands in for https://registry.npmjs.org/. bun.lock leaves out the tarball URLs of that registry alone, so with a
 * registry at another URL the fixtures would migrate to other bytes. With `env`, bun sends every https request through
 * a tunnel that ends at a local server, whatever host it asks for. The server has the manifests of `publishedBins`,
 * the tarballs of the test registry's fixtures, and 404 for everything else.
 */
export async function startNpmjs() {
  const server = Bun.serve({
    port: 0,
    tls,
    async fetch(request) {
      const [name, tarball] = decodeURIComponent(new URL(request.url).pathname.slice(1)).split("/-/");
      if (tarball !== undefined) {
        const fixture = Bun.file(join(fixturePackages, name, tarball));
        if (await fixture.exists()) return new Response(fixture);
      } else if (Object.hasOwn(publishedBins, name)) {
        const versions = Object.entries(publishedBins[name]).map(([version, bin]) => [
          version,
          { name, version, bin, dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` } },
        ]);
        return Response.json({ name, versions: Object.fromEntries(versions) });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const tunnel = net.createServer(client => {
    client.on("error", () => client.destroy());
    // The first packet is the whole `CONNECT host:443` request.
    client.once("data", () => {
      const upstream = net.connect(server.port!, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream).pipe(client);
      });
      upstream.on("error", () => client.destroy());
    });
  });
  const { promise: listening, resolve } = Promise.withResolvers<void>();
  tunnel.listen(0, "127.0.0.1", resolve);
  await listening;
  const proxy = `http://127.0.0.1:${(tunnel.address() as net.AddressInfo).port}`;
  return {
    env: { HTTPS_PROXY: proxy, https_proxy: proxy, NO_PROXY: "", no_proxy: "", NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    stop() {
      tunnel.close();
      server.stop(true);
    },
  };
}

export function writeExtra(dir: string, extra: Record<string, string>, registry = OFFLINE_REGISTRY) {
  fs.writeFileSync(join(dir, "bunfig.toml"), `[install]\nregistry = "${registry}"\n`);
  for (const [name, contents] of Object.entries(extra)) {
    fs.mkdirSync(dirname(join(dir, name)), { recursive: true });
    fs.writeFileSync(join(dir, name), contents);
  }
}

// The project dir of a fixture copy; disposing removes the whole copy, including out-of-tree link targets.
class FixtureDir extends String {
  constructor(
    dir: string,
    private copy: Disposable,
  ) {
    super(dir);
  }
  [Symbol.dispose]() {
    this.copy[Symbol.dispose]();
  }
}

export function fixture(name: string, extra: Record<string, string> = {}) {
  const entry = arboristFixtures.find(f => f.name === name);
  if (!entry) throw new Error(`${name} is not listed in npm-arborist/fixtures.json`);
  const copy = tempDir("npm-migrate-" + name, join(ARBORIST, name));
  const dir = entry.root ? join(String(copy), entry.root) : String(copy);
  writeExtra(dir, extra);
  return new FixtureDir(dir, copy) as unknown as string & Disposable;
}

export async function run(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

export async function readLock(dir: string) {
  const text = await Bun.file(join(String(dir), "bun.lock")).text();
  return { text, lock: Bun.JSONC.parse(text) as any };
}
