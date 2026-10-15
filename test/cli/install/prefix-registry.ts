import { spawn } from "bun";
import { bunEnv, bunExe, type DirectoryTree, githubTarball, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function binName(pkg: string) {
  return pkg.slice(pkg.lastIndexOf("/") + 1);
}

export type RegistryRequest = { prefix: string; authorization: string | null };

export type PrefixRegistryOptions = {
  /** `time` of the published version, for `minimumReleaseAge`. */
  published?: Date;
  /** Body of the package's bin. Receives the prefix and the version that served it. */
  cli?: (prefix: string, version: string) => string;
};

/**
 * One server that is a registry under every first path segment.
 * `<origin>/<PREFIX>/<pkg>` serves one version of `<pkg>` (1.0.0 until
 * `publish`), and its bin prints `SERVED-BY-<PREFIX>`. So a test names several
 * registries (USER, PROJECT, ...) with one port and reads from `requests` which
 * of them an install used, and with which credentials.
 */
export function prefixRegistry(options: PrefixRegistryOptions = {}) {
  const requests: RegistryRequest[] = [];
  const cli = options.cli ?? (prefix => `console.log("SERVED-BY-${prefix}");`);
  let version = "1.0.0";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const [prefix, ...rest] = decodeURIComponent(new URL(req.url).pathname)
        .split("/")
        .filter(Boolean);
      requests.push({ prefix, authorization: req.headers.get("authorization") });
      const isTarball = rest.at(-1) === "pkg.tgz";
      const pkg = (isTarball ? rest.slice(0, -1) : rest).join("/");
      const packageJson = { name: pkg, version, bin: { [binName(pkg)]: "cli.js" } };
      if (isTarball) {
        return new Response(
          await githubTarball("package", {
            "package.json": JSON.stringify(packageJson),
            "cli.js": `#!/usr/bin/env node\n${cli(prefix, version)}\n`,
          }),
        );
      }
      return Response.json({
        name: pkg,
        "dist-tags": { latest: version },
        versions: { [version]: { ...packageJson, dist: { tarball: `${origin}/${prefix}/${pkg}/pkg.tgz` } } },
        time: { [version]: (options.published ?? new Date(0)).toISOString() },
      });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    requests,
    port: server.port,
    /** Registry URL for `prefix`, with the trailing slash. */
    url: (prefix: string) => `${origin}/${prefix}/`,
    /** Publishes `next` as the only version. */
    publish(next: string) {
      version = next;
    },
    /** The distinct registries and credentials that the requests so far used. */
    used(): RegistryRequest[] {
      const seen = new Map(requests.map(request => [`${request.prefix} ${request.authorization}`, request]));
      return [...seen.keys()].sort().map(key => seen.get(key)!);
    },
    [Symbol.dispose]: () => void server.stop(true),
  };
}

export type PrefixRegistry = ReturnType<typeof prefixRegistry>;

/**
 * A user of their own with a project. `home`, `tmp` and `project` are siblings,
 * as a home directory and /tmp are. `~/.npmrc` names the USER registry, and no
 * variable names a registry or the install cache, so the cache is
 * `home/.bun/install/cache`, as for a real user.
 */
export function configWorld(
  registry: PrefixRegistry,
  tree: { home?: Record<string, string>; project?: DirectoryTree } = {},
) {
  const dir = tempDir("install-config", {
    home: { ".npmrc": `registry=${registry.url("USER")}\n`, ...tree.home },
    tmp: {},
    project: tree.project ?? {},
  });
  const [home, tmp, project] = ["home", "tmp", "project"].map(name => join(String(dir), name));
  const env: Record<string, string | undefined> = {
    ...bunEnv,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    BUN_TMPDIR: tmp,
    XDG_CONFIG_HOME: undefined,
    XDG_CACHE_HOME: undefined,
    BUN_INSTALL: undefined,
    BUN_INSTALL_CACHE_DIR: undefined,
    BUN_OPTIONS: undefined,
    npm_config_registry: undefined,
    NPM_CONFIG_REGISTRY: undefined,
    BUN_CONFIG_REGISTRY: undefined,
  };
  return {
    dir: String(dir),
    home,
    tmp,
    project,
    /** Runs `bun ...cmd` in `cwd`, a path relative to the project. */
    async bun(
      cmd: string[],
      cwd = ".",
      options: { env?: Record<string, string | undefined>; uid?: number; gid?: number } = {},
    ) {
      await using proc = spawn({
        cmd: [bunExe(), ...cmd],
        cwd: join(project, cwd),
        ...options,
        env: { ...env, ...options.env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    },
    /** The directories bunx has installed into, as `uid`. The files beside them are their locks. */
    bunxTrees(uid = process.getuid?.()): string[] {
      const root = isWindows ? tmp : join(home, ".bun", "install", "cache", `.bunx-${uid}`);
      return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && (!isWindows || entry.name.startsWith("bunx-")))
        .map(entry => join(root, entry.name))
        .sort();
    },
    /** Every file of the project with its bytes, to compare before and after a command. */
    projectFiles(): Record<string, string> {
      const files: Record<string, string> = {};
      for (const entry of readdirSync(project, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name);
        files[path.slice(project.length + 1).replaceAll("\\", "/")] = entry.isDirectory()
          ? "<dir>"
          : readFileSync(path, "latin1");
      }
      return files;
    },
    [Symbol.dispose]() {
      dir[Symbol.dispose]();
    },
  };
}
