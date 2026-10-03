import { bunEnv } from "harness";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

function tarEntry(name: string, body: Buffer) {
  const buf = Buffer.alloc(512 + ((body.length + 511) & ~511));
  const header = buf.subarray(0, 512);
  header.write(name);
  header.write("0000755", 100);
  header.write("0000000", 108);
  header.write("0000000", 116);
  header.write(body.length.toString(8).padStart(11, "0"), 124);
  header.write("00000000000", 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  body.copy(buf, 512);
  return buf;
}

function binName(pkg: string) {
  return pkg.slice(pkg.lastIndexOf("/") + 1);
}

function packageTarball(pkg: string, version: string, cli: string) {
  const manifest = { name: pkg, version, bin: { [binName(pkg)]: "cli.js" } };
  return gzipSync(
    Buffer.concat([
      tarEntry("package/package.json", Buffer.from(JSON.stringify(manifest))),
      tarEntry("package/cli.js", Buffer.from(`#!/usr/bin/env node\n${cli}\n`)),
      Buffer.alloc(1024),
    ]),
  );
}

export type RegistryRequest = { prefix: string; authorization: string | null };

export type PrefixRegistryOptions = {
  /** `time` of the only version, for `minimumReleaseAge`. */
  published?: Date;
  /** Body of the package's bin. Receives the prefix and the version that served it. */
  cli?: (prefix: string, version: string) => string;
  /** Bun.serve TLS options. */
  tls?: { cert: string; key: string };
};

/**
 * One server that is a registry under every first path segment.
 * `<origin>/<PREFIX>/<pkg>` serves one version of `<pkg>` (`version`, 1.0.0 at
 * first), and its bin prints `SERVED-BY-<PREFIX>`. So a test names several
 * registries (USER, PROJECT, ...) with one port and reads from `requests`
 * which of them an install used.
 */
export function prefixRegistry(options: PrefixRegistryOptions = {}) {
  const requests: RegistryRequest[] = [];
  const cli = options.cli ?? (prefix => `console.log("SERVED-BY-${prefix}");`);
  let version = "1.0.0";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: options.tls,
    fetch(req) {
      const [prefix, ...rest] = decodeURIComponent(new URL(req.url).pathname).split("/").filter(Boolean);
      requests.push({ prefix, authorization: req.headers.get("authorization") });
      if (rest.at(-1) === "pkg.tgz") {
        return new Response(packageTarball(rest.slice(0, -1).join("/"), version, cli(prefix, version)));
      }
      const pkg = rest.join("/");
      return Response.json({
        name: pkg,
        "dist-tags": { latest: version },
        versions: {
          [version]: {
            name: pkg,
            version,
            bin: { [binName(pkg)]: "cli.js" },
            dist: { tarball: `${origin}/${prefix}/${pkg}/pkg.tgz` },
          },
        },
        ...(options.published ? { time: { [version]: options.published.toISOString() } } : {}),
      });
    },
  });
  const origin = `${options.tls ? "https" : "http"}://127.0.0.1:${server.port}`;
  return {
    requests,
    port: server.port,
    /** Publishes `next` as the only version. */
    publish(next: string) {
      version = next;
    },
    /** Registry URL for `prefix`, with the trailing slash. */
    url: (prefix: string) => `${origin}/${prefix}/`,
    /** The distinct registries and credentials that the requests so far used. */
    used(): RegistryRequest[] {
      const seen = new Map(requests.map(r => [`${r.prefix} ${r.authorization}`, r]));
      return [...seen.keys()].sort().map(key => seen.get(key)!);
    },
    [Symbol.dispose]: () => void server.stop(true),
  };
}

/**
 * Env for a bun process with its own home, temp and install cache directory,
 * so the bunx cache and the user config are the test's.
 */
export function isolatedEnv(home: string, tmp: string, extra: Record<string, string | undefined> = {}) {
  return {
    ...bunEnv,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    TEMP: tmp,
    TMP: tmp,
    TMPDIR: tmp,
    BUN_TMPDIR: tmp,
    BUN_INSTALL_CACHE_DIR: join(tmp, ".install-cache"),
    npm_config_registry: undefined,
    NPM_CONFIG_REGISTRY: undefined,
    BUN_CONFIG_REGISTRY: undefined,
    ...extra,
  };
}

/** Every file under `dir` with its bytes, to compare a tree before and after a command. */
export function snapshotTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, entry);
    files[entry.replaceAll("\\", "/")] = statSync(path).isDirectory() ? "<dir>" : readFileSync(path, "latin1");
  }
  return files;
}

/** The bunx cache directories in `tmp`, by name. */
export function bunxCacheDirs(tmp: string): string[] {
  return readdirSync(tmp)
    .filter(name => name.startsWith("bunx-"))
    .sort();
}
